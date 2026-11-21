import { z } from 'zod';
import {
  applyDelta,
  type GameEvent,
  type GameStateDelta,
} from './events.js';
import {
  evaluateConcentrationCheck,
  getAbilityModifier,
  getConditionPenalty,
  getConditionsEffects,
  getProficiencyBonus,
  resolveDamageRelation,
  resolveRollMode,
  type ConcentrationCheckOutcome,
  type DamageRelation,
} from './modifiers.js';
import type { ResolverContext } from './resolvers.js';
import {
  parseDiceExpression,
  RollModeSchema,
  rollD20,
  rollDice,
  RulesError,
  type RollMode,
} from './rng.js';
import {
  CombatantAttackSchema,
  Condition5eSchema,
  VisibilitySchema,
  type Character,
  type Combatant,
  type CombatantAttack,
  type CombatantKind,
  type CombatState,
  type GameState,
} from './types.js';

export type { DamageRelation } from './modifiers.js';

// ---------- Standard 5e-lite weapons & PC attack derivation ----------

interface StandardWeaponSpec {
  nameEs: string;
  damageBase: string;
  damageType: string;
  abilityMode: 'str' | 'dex' | 'finesse';
  addAbilityToDamage?: boolean;
}

const STANDARD_5E_WEAPONS = {
  shortbow: {
    nameEs: 'Arco corto',
    damageBase: '1d6',
    damageType: 'piercing',
    abilityMode: 'dex',
  },
  shortsword: {
    nameEs: 'Espada corta',
    damageBase: '1d6',
    damageType: 'piercing',
    abilityMode: 'finesse',
  },
  longsword: {
    nameEs: 'Espada larga',
    damageBase: '1d8',
    damageType: 'slashing',
    abilityMode: 'str',
  },
  dagger: {
    nameEs: 'Daga',
    damageBase: '1d4',
    damageType: 'piercing',
    abilityMode: 'finesse',
  },
  longbow: {
    nameEs: 'Arco largo',
    damageBase: '1d8',
    damageType: 'piercing',
    abilityMode: 'dex',
  },
  rapier: {
    nameEs: 'Estoque',
    damageBase: '1d8',
    damageType: 'piercing',
    abilityMode: 'finesse',
  },
  greatsword: {
    nameEs: 'Espadón',
    damageBase: '2d6',
    damageType: 'slashing',
    abilityMode: 'str',
  },
  battleaxe: {
    nameEs: 'Hacha de batalla',
    damageBase: '1d8',
    damageType: 'slashing',
    abilityMode: 'str',
  },
  handaxe: {
    nameEs: 'Hacha de mano',
    damageBase: '1d6',
    damageType: 'slashing',
    abilityMode: 'str',
  },
  mace: {
    nameEs: 'Maza',
    damageBase: '1d6',
    damageType: 'bludgeoning',
    abilityMode: 'str',
  },
  quarterstaff: {
    nameEs: 'Bastón',
    damageBase: '1d6',
    damageType: 'bludgeoning',
    abilityMode: 'str',
  },
  spear: {
    nameEs: 'Lanza',
    damageBase: '1d6',
    damageType: 'piercing',
    abilityMode: 'str',
  },
  'light-crossbow': {
    nameEs: 'Ballesta ligera',
    damageBase: '1d8',
    damageType: 'piercing',
    abilityMode: 'dex',
  },
  torch: {
    nameEs: 'Antorcha encendida',
    damageBase: '1d4',
    damageType: 'fire',
    abilityMode: 'str',
    addAbilityToDamage: false,
  },
  unarmed: {
    nameEs: 'Golpe desarmado',
    damageBase: '1d4',
    damageType: 'bludgeoning',
    abilityMode: 'str',
  },
} as const satisfies Record<string, StandardWeaponSpec>;

export type StandardWeaponId = keyof typeof STANDARD_5E_WEAPONS;

export const StandardWeaponIdSchema = z.enum([
  'shortbow',
  'shortsword',
  'longsword',
  'dagger',
  'longbow',
  'rapier',
  'greatsword',
  'battleaxe',
  'handaxe',
  'mace',
  'quarterstaff',
  'spear',
  'light-crossbow',
  'torch',
  'unarmed',
]);

function isStandardWeaponId(value: string): value is StandardWeaponId {
  return Object.prototype.hasOwnProperty.call(STANDARD_5E_WEAPONS, value);
}

function formatDamageExpression(baseDice: string, modifier: number): string {
  if (modifier === 0) return baseDice;
  return modifier > 0 ? `${baseDice}+${modifier}` : `${baseDice}${modifier}`;
}

/**
 * Doubles the number of damage dice in a dice expression per 5e critical hit rules,
 * keeping the flat modifier added only once (e.g. `1d8+3` -> `2d8+3`).
 */
export function doubleDiceExpression(expr: string): string {
  const parsed = parseDiceExpression(expr);
  const doubledCount = Math.min(100, parsed.count * 2);
  return formatDamageExpression(`${doubledCount}d${parsed.sides}`, parsed.modifier);
}

/**
 * Computes a deterministic 5e-lite attack profile for a PC using a validated SRD weapon.
 */
export function buildWeaponAttack(
  character: Character,
  weaponId: StandardWeaponId,
  customNameEs?: string,
): CombatantAttack {
  const spec: StandardWeaponSpec = STANDARD_5E_WEAPONS[weaponId];
  const strMod = getAbilityModifier(character.abilities.str);
  const dexMod = getAbilityModifier(character.abilities.dex);
  const pb = getProficiencyBonus(character.level);

  let abilityMod: number;
  if (spec.abilityMode === 'dex') {
    abilityMod = dexMod;
  } else if (spec.abilityMode === 'finesse') {
    abilityMod = Math.max(strMod, dexMod);
  } else {
    abilityMod = strMod;
  }

  const damageMod = spec.addAbilityToDamage === false ? 0 : abilityMod;

  return {
    id: weaponId,
    nameEs: customNameEs ?? spec.nameEs,
    attackBonus: abilityMod + pb,
    damageDice: formatDamageExpression(spec.damageBase, damageMod),
    damageType: spec.damageType,
  };
}

/**
 * Derives deterministic 5e-lite attacks from a character's equipped inventory and abilities.
 */
export function deriveCharacterAttacks(character: Character): CombatantAttack[] {
  const derived: CombatantAttack[] = [];
  const seen = new Set<string>();

  for (const item of character.inventory) {
    if (item.quantity <= 0) continue;
    const normalizedId = item.itemId.trim().toLowerCase();
    if (isStandardWeaponId(normalizedId) && !seen.has(normalizedId)) {
      seen.add(normalizedId);
      derived.push(buildWeaponAttack(character, normalizedId, item.name));
    }
  }

  if (derived.length === 0) {
    derived.push(buildWeaponAttack(character, 'unarmed'));
  }

  return derived;
}

function cloneCombatStateLocal(combat: CombatState): CombatState {
  return {
    active: combat.active,
    round: combat.round,
    turnIndex: combat.turnIndex,
    combatants: combat.combatants.map((c) => ({
      ...c,
      hp: { ...c.hp },
      attacks: c.attacks.map((a) => ({ ...a })),
      vulnerabilities: [...c.vulnerabilities],
      immunities: [...c.immunities],
      ...(c.resistances ? { resistances: [...c.resistances] } : {}),
      ...(c.conditions ? { conditions: [...c.conditions] } : {}),
    })),
  };
}

function kindTieRank(kind: CombatantKind): number {
  if (kind === 'pc') return 0;
  if (kind === 'ally') return 1;
  return 2;
}

// ---------- startCombat ----------

export const CombatEnemyDefinitionSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    creatureId: z.string().min(1).optional(),
    hp: z.number().int().min(1),
    ac: z.number().int().min(1).max(40),
    dexMod: z.number().int().min(-10).max(20),
    attacks: z.array(CombatantAttackSchema).min(1),
    vulnerabilities: z.array(z.string().min(1)).optional(),
    immunities: z.array(z.string().min(1)).optional(),
    resistances: z.array(z.string().min(1)).optional(),
    conditions: z.array(Condition5eSchema).optional(),
  })
  .strict();
export type CombatEnemyDefinition = z.infer<typeof CombatEnemyDefinitionSchema>;

export const StartCombatInputSchema = z
  .object({
    sceneId: z.string().min(1),
    enemies: z.array(CombatEnemyDefinitionSchema).min(1).max(12),
    allies: z.array(CombatEnemyDefinitionSchema).max(6).optional(),
    visibility: VisibilitySchema.optional(),
  })
  .strict();
export type StartCombatInput = z.infer<typeof StartCombatInputSchema>;

export interface InitiativeRollEntry {
  combatantId: string;
  name: string;
  kind: CombatantKind;
  naturalRoll: number;
  dexMod: number;
  total: number;
}

export type StartCombatResult =
  | {
      ok: true;
      combat: CombatState;
      activeCombatant: Combatant;
      initiativeRolls: InitiativeRollEntry[];
      event: GameEvent;
      nextState: GameState;
    }
  | {
      ok: false;
      code: 'INVALID_INPUT' | 'INVALID_SCENE' | 'COMBAT_ALREADY_ACTIVE';
      messageEs: string;
    };

export function startCombat(
  state: GameState,
  rawInput: unknown,
  ctx: ResolverContext,
): StartCombatResult {
  const parsed = StartCombatInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      messageEs: `Parámetros inválidos en start_combat: ${parsed.error.issues[0]?.message ?? 'formato incorrecto'}.`,
    };
  }

  const input = parsed.data;
  if (input.sceneId !== state.sceneId || !state.scenes[input.sceneId]) {
    return {
      ok: false,
      code: 'INVALID_SCENE',
      messageEs: `La escena "${input.sceneId}" no coincide con la escena activa ("${state.sceneId}").`,
    };
  }

  if (state.combat?.active) {
    return {
      ok: false,
      code: 'COMBAT_ALREADY_ACTIVE',
      messageEs: 'Ya hay un combate activo en curso. Finalizalo antes de iniciar otro.',
    };
  }

  // Validate damage dice expressions on all enemy/ally attacks before mutating anything
  const allNonPcDefs = [...input.enemies, ...(input.allies ?? [])];
  for (const def of allNonPcDefs) {
    for (const atk of def.attacks) {
      try {
        parseDiceExpression(atk.damageDice);
      } catch (err) {
        if (err instanceof RulesError) {
          return {
            ok: false,
            code: 'INVALID_INPUT',
            messageEs: `Expresión de daño inválida en ataque "${atk.nameEs}" de "${def.name}": ${err.message}`,
          };
        }
        throw err;
      }
    }
  }

  const seenIds = new Set<string>();
  const pcChars = Object.values(state.characters).sort((a, b) =>
    a.id.localeCompare(b.id, 'en'),
  );

  for (const pc of pcChars) {
    seenIds.add(pc.id);
  }
  for (const def of allNonPcDefs) {
    if (seenIds.has(def.id)) {
      return {
        ok: false,
        code: 'INVALID_INPUT',
        messageEs: `ID de combatiente duplicado al iniciar combate: "${def.id}".`,
      };
    }
    seenIds.add(def.id);
  }

  const rolledEntries: Array<{
    combatant: Combatant;
    dexMod: number;
    entry: InitiativeRollEntry;
  }> = [];

  for (const char of pcChars) {
    const dexMod = getAbilityModifier(char.abilities.dex);
    const roll = rollD20(ctx.rng, 'normal');
    const initiative = roll.chosen + dexMod;
    const combatant: Combatant = {
      id: char.id,
      name: char.name,
      kind: 'pc',
      actorId: char.id,
      initiative,
      hp: {
        current: char.hp.current,
        max: char.hp.max,
      },
      ac: char.ac,
      attacks: deriveCharacterAttacks(char),
      vulnerabilities: [],
      immunities: [],
      ...(char.resistances && char.resistances.length > 0
        ? { resistances: [...char.resistances] }
        : {}),
      ...(char.conditions.length > 0
        ? { conditions: [...char.conditions] }
        : {}),
      defeated: char.hp.current <= 0,
    };
    rolledEntries.push({
      combatant,
      dexMod,
      entry: {
        combatantId: combatant.id,
        name: combatant.name,
        kind: 'pc',
        naturalRoll: roll.chosen,
        dexMod,
        total: initiative,
      },
    });
  }

  for (const ally of input.allies ?? []) {
    const roll = rollD20(ctx.rng, 'normal');
    const initiative = roll.chosen + ally.dexMod;
    const combatant: Combatant = {
      id: ally.id,
      name: ally.name,
      kind: 'ally',
      ...(ally.creatureId ? { creatureId: ally.creatureId } : {}),
      initiative,
      hp: {
        current: ally.hp,
        max: ally.hp,
      },
      ac: ally.ac,
      attacks: ally.attacks.map((a) => ({ ...a })),
      vulnerabilities: [...(ally.vulnerabilities ?? [])],
      immunities: [...(ally.immunities ?? [])],
      ...(ally.resistances && ally.resistances.length > 0
        ? { resistances: [...ally.resistances] }
        : {}),
      ...(ally.conditions && ally.conditions.length > 0
        ? { conditions: [...ally.conditions] }
        : {}),
      defeated: false,
    };
    rolledEntries.push({
      combatant,
      dexMod: ally.dexMod,
      entry: {
        combatantId: combatant.id,
        name: combatant.name,
        kind: 'ally',
        naturalRoll: roll.chosen,
        dexMod: ally.dexMod,
        total: initiative,
      },
    });
  }

  for (const enemy of input.enemies) {
    const roll = rollD20(ctx.rng, 'normal');
    const initiative = roll.chosen + enemy.dexMod;
    const combatant: Combatant = {
      id: enemy.id,
      name: enemy.name,
      kind: 'enemy',
      ...(enemy.creatureId ? { creatureId: enemy.creatureId } : {}),
      initiative,
      hp: {
        current: enemy.hp,
        max: enemy.hp,
      },
      ac: enemy.ac,
      attacks: enemy.attacks.map((a) => ({ ...a })),
      vulnerabilities: [...(enemy.vulnerabilities ?? [])],
      immunities: [...(enemy.immunities ?? [])],
      ...(enemy.resistances && enemy.resistances.length > 0
        ? { resistances: [...enemy.resistances] }
        : {}),
      ...(enemy.conditions && enemy.conditions.length > 0
        ? { conditions: [...enemy.conditions] }
        : {}),
      defeated: false,
    };
    rolledEntries.push({
      combatant,
      dexMod: enemy.dexMod,
      entry: {
        combatantId: combatant.id,
        name: combatant.name,
        kind: 'enemy',
        naturalRoll: roll.chosen,
        dexMod: enemy.dexMod,
        total: initiative,
      },
    });
  }

  // Deterministic 5e initiative sort: initiative desc -> dexMod desc -> PC/ally/enemy -> id asc
  rolledEntries.sort((a, b) => {
    if (b.combatant.initiative !== a.combatant.initiative) {
      return b.combatant.initiative - a.combatant.initiative;
    }
    if (b.dexMod !== a.dexMod) {
      return b.dexMod - a.dexMod;
    }
    const kindDiff = kindTieRank(a.combatant.kind) - kindTieRank(b.combatant.kind);
    if (kindDiff !== 0) {
      return kindDiff;
    }
    return a.combatant.id.localeCompare(b.combatant.id, 'en');
  });

  const combatants = rolledEntries.map((r) => r.combatant);
  const initiativeRolls = rolledEntries.map((r) => r.entry);
  const firstAliveIdx = combatants.findIndex((c) => !c.defeated);
  const turnIndex = firstAliveIdx >= 0 ? firstAliveIdx : 0;
  const activeCombatant = combatants[turnIndex]!;

  const combat: CombatState = {
    active: true,
    round: 1,
    turnIndex,
    combatants,
  };

  const nextSeq = state.lastSeq + 1;
  const stateDelta: GameStateDelta = {
    combat,
  };

  const event: GameEvent = {
    id: ctx.createId(),
    campaignId: state.campaignId,
    sessionId: state.sessionId,
    seq: nextSeq,
    type: 'COMBAT_STARTED',
    source: 'engine',
    visibility: input.visibility ?? 'public',
    actor: pcChars[0]?.id ?? activeCombatant.id,
    checkId: null,
    declaredTotal: null,
    dieResults: initiativeRolls.map((r) => r.naturalRoll),
    payload: {
      sceneId: input.sceneId,
      round: 1,
      turnIndex,
      activeCombatantId: activeCombatant.id,
      initiativeOrder: initiativeRolls,
    },
    stateDelta,
    revertedByEventId: null,
    createdAt: ctx.now(),
  };

  const nextState = applyDelta(state, stateDelta, nextSeq);

  return {
    ok: true,
    combat: nextState.combat!,
    activeCombatant,
    initiativeRolls,
    event,
    nextState,
  };
}

// ---------- resolveCombatAttack ----------

export const ResolveCombatAttackInputSchema = z
  .object({
    sceneId: z.string().min(1),
    attackerId: z.string().min(1),
    targetId: z.string().min(1),
    attackId: z.string().min(1).optional(),
    weaponId: StandardWeaponIdSchema.optional(),
    mode: RollModeSchema.optional(),
    visibility: VisibilitySchema.optional(),
  })
  .strict();
export type ResolveCombatAttackInput = z.infer<
  typeof ResolveCombatAttackInputSchema
>;

export type ResolveCombatAttackResult =
  | {
      ok: true;
      attackerId: string;
      attackerName: string;
      targetId: string;
      targetName: string;
      attackId: string;
      attackNameEs: string;
      effectiveMode: RollMode;
      attackRolls: number[];
      naturalRoll: number;
      attackBonus: number;
      attackTotal: number;
      targetAc: number;
      hit: boolean;
      isCritical: boolean;
      isCriticalMiss: boolean;
      damageType: string;
      damageExpressionUsed: string | null;
      damageRolls: number[];
      rawDamage: number;
      damageRelation: DamageRelation;
      damageApplied: number;
      targetHpBefore: number;
      targetHpAfter: number;
      targetDefeated: boolean;
      allEnemiesDefeated: boolean;
      allPcsDefeated: boolean;
      concentrationCheck?: ConcentrationCheckOutcome;
      combat: CombatState;
      event: GameEvent;
      nextState: GameState;
    }
  | {
      ok: false;
      code:
        | 'INVALID_INPUT'
        | 'INVALID_SCENE'
        | 'NO_ACTIVE_COMBAT'
        | 'UNKNOWN_COMBATANT'
        | 'INVALID_TARGET'
        | 'COMBATANT_DEFEATED'
        | 'ATTACKER_INCAPACITATED'
        | 'UNKNOWN_ATTACK'
        | 'INVALID_DICE_EXPRESSION';
      messageEs: string;
    };

function isRangedAttack(attack: CombatantAttack): boolean {
  return /bow|arco|crossbow|ballesta|sling|honda/i.test(
    `${attack.id} ${attack.nameEs}`,
  );
}

function findCombatantIndex(
  combatants: readonly Combatant[],
  idOrActorId: string,
): number {
  return combatants.findIndex(
    (c) => c.id === idOrActorId || c.actorId === idOrActorId,
  );
}

function selectCombatantAttack(
  state: GameState,
  attacker: Combatant,
  attackId: string | undefined,
  weaponId: StandardWeaponId | undefined,
): CombatantAttack | null {
  const pcChar =
    attacker.kind === 'pc' && attacker.actorId
      ? state.characters[attacker.actorId]
      : undefined;

  if (attackId) {
    const exact = attacker.attacks.find((a) => a.id === attackId);
    if (exact) return exact;

    if (pcChar && isStandardWeaponId(attackId.trim().toLowerCase())) {
      return buildWeaponAttack(
        pcChar,
        attackId.trim().toLowerCase() as StandardWeaponId,
      );
    }
    return null;
  }

  if (weaponId && pcChar) {
    return buildWeaponAttack(pcChar, weaponId);
  }

  if (attacker.attacks.length > 0) {
    return attacker.attacks[0]!;
  }

  if (pcChar) {
    return deriveCharacterAttacks(pcChar)[0] ?? null;
  }

  return null;
}

export function resolveCombatAttack(
  state: GameState,
  rawInput: unknown,
  ctx: ResolverContext,
): ResolveCombatAttackResult {
  const parsed = ResolveCombatAttackInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      messageEs: `Parámetros inválidos en combat_attack: ${parsed.error.issues[0]?.message ?? 'formato incorrecto'}.`,
    };
  }

  const input = parsed.data;
  if (input.sceneId !== state.sceneId || !state.scenes[input.sceneId]) {
    return {
      ok: false,
      code: 'INVALID_SCENE',
      messageEs: `La escena "${input.sceneId}" no coincide con la escena activa ("${state.sceneId}").`,
    };
  }

  if (!state.combat || !state.combat.active) {
    return {
      ok: false,
      code: 'NO_ACTIVE_COMBAT',
      messageEs: 'No hay ningún combate activo. Iniciá un combate antes de atacar.',
    };
  }

  const attackerIdx = findCombatantIndex(
    state.combat.combatants,
    input.attackerId,
  );
  if (attackerIdx < 0) {
    return {
      ok: false,
      code: 'UNKNOWN_COMBATANT',
      messageEs: `El atacante "${input.attackerId}" no participa en el combate actual.`,
    };
  }

  const targetIdx = findCombatantIndex(state.combat.combatants, input.targetId);
  if (targetIdx < 0) {
    return {
      ok: false,
      code: 'UNKNOWN_COMBATANT',
      messageEs: `El objetivo "${input.targetId}" no participa en el combate actual.`,
    };
  }

  const attacker = state.combat.combatants[attackerIdx]!;
  const target = state.combat.combatants[targetIdx]!;

  if (attacker.id === target.id) {
    return {
      ok: false,
      code: 'INVALID_TARGET',
      messageEs: `"${attacker.name}" no puede atacarse a sí mismo.`,
    };
  }

  if (attacker.defeated) {
    return {
      ok: false,
      code: 'COMBATANT_DEFEATED',
      messageEs: `"${attacker.name}" está derrotado y no puede realizar ataques.`,
    };
  }

  if (target.defeated) {
    return {
      ok: false,
      code: 'COMBATANT_DEFEATED',
      messageEs: `"${target.name}" ya está derrotado.`,
    };
  }

  const attack = selectCombatantAttack(
    state,
    attacker,
    input.attackId,
    input.weaponId,
  );
  if (!attack) {
    return {
      ok: false,
      code: 'UNKNOWN_ATTACK',
      messageEs: `No se encontró el ataque "${input.attackId ?? ''}" para "${attacker.name}".`,
    };
  }

  const attackerChar =
    attacker.kind === 'pc' && attacker.actorId
      ? state.characters[attacker.actorId]
      : undefined;
  const targetChar =
    target.kind === 'pc' && target.actorId
      ? state.characters[target.actorId]
      : undefined;

  const attackerEffects = attackerChar
    ? getConditionPenalty(attackerChar, state.ruleset)
    : getConditionsEffects(attacker.conditions ?? [], 0);
  if (attackerEffects.isIncapacitated) {
    return {
      ok: false,
      code: 'ATTACKER_INCAPACITATED',
      messageEs: `"${attacker.name}" está incapacitado y no puede realizar ataques.`,
    };
  }

  const targetConditions = targetChar
    ? targetChar.conditions
    : (target.conditions ?? []);
  const targetEffects = targetChar
    ? getConditionPenalty(targetChar, state.ruleset)
    : getConditionsEffects(targetConditions, 0);

  const ranged = isRangedAttack(attack);
  const hasAdvantage =
    attackerEffects.grantsAdvantageOnAttacks ||
    targetEffects.grantsAdvantageToAttackers ||
    (!ranged && targetConditions.includes('prone'));
  const hasDisadvantage =
    attackerEffects.imposesDisadvantageOnAttacks ||
    targetEffects.imposesDisadvantageToAttackers ||
    (ranged && targetConditions.includes('prone'));

  const effectiveMode = resolveRollMode({
    requested: input.mode ?? 'normal',
    hasAdvantage,
    hasDisadvantage,
  });
  const effectiveAttackBonus = attack.attackBonus + attackerEffects.d20Modifier;
  const attackRoll = rollD20(ctx.rng, effectiveMode);
  const isCriticalMiss = attackRoll.isNatural1;
  const attackTotal = attackRoll.chosen + effectiveAttackBonus;
  const hit =
    attackRoll.isNatural20 || (!isCriticalMiss && attackTotal >= target.ac);
  const isCritical =
    attackRoll.isNatural20 ||
    (!isCriticalMiss && hit && !ranged && targetEffects.autoCritFromMelee);

  let damageExpressionUsed: string | null = null;
  let damageRolls: number[] = [];
  let rawDamage = 0;
  let damageRelation: DamageRelation = 'normal';
  let damageApplied = 0;

  if (hit) {
    try {
      damageExpressionUsed = isCritical
        ? doubleDiceExpression(attack.damageDice)
        : attack.damageDice;
      const dmgResult = rollDice(damageExpressionUsed, ctx.rng);
      damageRolls = dmgResult.rolls;
      rawDamage = Math.max(0, dmgResult.total);
    } catch (err) {
      if (err instanceof RulesError) {
        return {
          ok: false,
          code: 'INVALID_DICE_EXPRESSION',
          messageEs: err.message,
        };
      }
      throw err;
    }

    const dmgRel = resolveDamageRelation(rawDamage, attack.damageType, {
      immunities: target.immunities,
      vulnerabilities: target.vulnerabilities,
      resistances: [
        ...(target.resistances ?? []),
        ...(targetChar?.resistances ?? []),
      ],
    });
    damageRelation = dmgRel.relation;
    damageApplied = dmgRel.damageApplied;
  }

  const nextCombat = cloneCombatStateLocal(state.combat);
  const updatedTargetCombatant = nextCombat.combatants[targetIdx]!;

  let absorbedByTemp = 0;
  let targetHpBefore: number;
  let targetHpAfter: number;

  if (targetChar) {
    absorbedByTemp = Math.min(targetChar.hp.temp, damageApplied);
    const remainingDamage = damageApplied - absorbedByTemp;
    targetHpBefore = targetChar.hp.current;
    targetHpAfter = Math.max(0, targetHpBefore - remainingDamage);
  } else {
    targetHpBefore = target.hp.current;
    targetHpAfter = Math.max(0, targetHpBefore - damageApplied);
  }

  const targetDefeated = targetHpAfter <= 0;
  updatedTargetCombatant.hp.current = targetHpAfter;
  updatedTargetCombatant.defeated = targetDefeated;

  const concentrationCheck =
    targetChar && hit
      ? evaluateConcentrationCheck({
          character: targetChar,
          damageApplied,
          hpAfter: targetHpAfter,
          ruleset: state.ruleset,
          rng: ctx.rng,
        })
      : undefined;

  const allEnemiesDefeated = nextCombat.combatants
    .filter((c) => c.kind === 'enemy')
    .every((c) => c.defeated);
  const allPcsDefeated = nextCombat.combatants
    .filter((c) => c.kind === 'pc')
    .every((c) => c.defeated);

  const nextSeq = state.lastSeq + 1;
  const stateDelta: GameStateDelta = {
    combat: nextCombat,
    ...(targetChar && hit && (damageApplied > 0 || targetHpAfter !== targetHpBefore)
      ? {
          hpChanges: [
            {
              actorId: targetChar.id,
              before: targetHpBefore,
              after: targetHpAfter,
            },
          ],
          ...(absorbedByTemp > 0
            ? {
                tempHpChanges: [
                  {
                    actorId: targetChar.id,
                    before: targetChar.hp.temp,
                    after: Math.max(0, targetChar.hp.temp - absorbedByTemp),
                  },
                ],
              }
            : {}),
        }
      : {}),
    ...(targetChar &&
    concentrationCheck &&
    !concentrationCheck.maintained &&
    targetChar.concentratingOn
      ? {
          concentrationChanges: [
            {
              actorId: targetChar.id,
              before: targetChar.concentratingOn,
              after: null,
            },
          ],
        }
      : {}),
  };

  const event: GameEvent = {
    id: ctx.createId(),
    campaignId: state.campaignId,
    sessionId: state.sessionId,
    seq: nextSeq,
    type: 'COMBAT_ATTACK',
    source: 'engine',
    visibility: input.visibility ?? 'public',
    actor: attacker.id,
    checkId: null,
    declaredTotal: null,
    dieResults: attackRoll.rolls,
    payload: {
      sceneId: input.sceneId,
      round: state.combat.round,
      attackerId: attacker.id,
      attackerName: attacker.name,
      targetId: target.id,
      targetName: target.name,
      attackId: attack.id,
      attackNameEs: attack.nameEs,
      mode: effectiveMode,
      attackBonus: effectiveAttackBonus,
      naturalRoll: attackRoll.chosen,
      attackTotal,
      targetAc: target.ac,
      hit,
      isCritical,
      isCriticalMiss,
      damageType: attack.damageType,
      damageExpressionUsed,
      damageRolls,
      rawDamage,
      damageRelation,
      damageApplied,
      absorbedByTemp,
      targetHpBefore,
      targetHpAfter,
      targetDefeated,
      allEnemiesDefeated,
      allPcsDefeated,
      concentrationCheck: concentrationCheck ?? null,
    },
    stateDelta,
    revertedByEventId: null,
    createdAt: ctx.now(),
  };

  const nextState = applyDelta(state, stateDelta, nextSeq);

  return {
    ok: true,
    attackerId: attacker.id,
    attackerName: attacker.name,
    targetId: target.id,
    targetName: target.name,
    attackId: attack.id,
    attackNameEs: attack.nameEs,
    effectiveMode,
    attackRolls: attackRoll.rolls,
    naturalRoll: attackRoll.chosen,
    attackBonus: effectiveAttackBonus,
    attackTotal,
    targetAc: target.ac,
    hit,
    isCritical,
    isCriticalMiss,
    damageType: attack.damageType,
    damageExpressionUsed,
    damageRolls,
    rawDamage,
    damageRelation,
    damageApplied,
    targetHpBefore,
    targetHpAfter,
    targetDefeated,
    allEnemiesDefeated,
    allPcsDefeated,
    ...(concentrationCheck ? { concentrationCheck } : {}),
    combat: nextState.combat!,
    event,
    nextState,
  };
}

// ---------- advanceCombatTurn ----------

export const AdvanceCombatTurnInputSchema = z
  .object({
    sceneId: z.string().min(1),
    visibility: VisibilitySchema.optional(),
  })
  .strict();
export type AdvanceCombatTurnInput = z.infer<
  typeof AdvanceCombatTurnInputSchema
>;

export type AdvanceCombatTurnResult =
  | {
      ok: true;
      combat: CombatState;
      previousCombatant: Combatant;
      activeCombatant: Combatant;
      round: number;
      roundAdvanced: boolean;
      event: GameEvent;
      nextState: GameState;
    }
  | {
      ok: false;
      code:
        | 'INVALID_INPUT'
        | 'INVALID_SCENE'
        | 'NO_ACTIVE_COMBAT'
        | 'NO_ACTIVE_COMBATANTS';
      messageEs: string;
    };

export function advanceCombatTurn(
  state: GameState,
  rawInput: unknown,
  ctx: ResolverContext,
): AdvanceCombatTurnResult {
  const parsed = AdvanceCombatTurnInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      messageEs: `Parámetros inválidos en combat_next_turn: ${parsed.error.issues[0]?.message ?? 'formato incorrecto'}.`,
    };
  }

  const input = parsed.data;
  if (input.sceneId !== state.sceneId || !state.scenes[input.sceneId]) {
    return {
      ok: false,
      code: 'INVALID_SCENE',
      messageEs: `La escena "${input.sceneId}" no coincide con la escena activa ("${state.sceneId}").`,
    };
  }

  if (!state.combat || !state.combat.active) {
    return {
      ok: false,
      code: 'NO_ACTIVE_COMBAT',
      messageEs: 'No hay ningún combate activo para avanzar el turno.',
    };
  }

  const count = state.combat.combatants.length;
  if (count === 0) {
    return {
      ok: false,
      code: 'NO_ACTIVE_COMBATANTS',
      messageEs: 'No hay combatientes en el combate actual.',
    };
  }

  const currentIdx = state.combat.turnIndex;
  const previousCombatant = state.combat.combatants[currentIdx]!;

  let nextIdx = -1;
  for (let step = 1; step <= count; step += 1) {
    const candidateIdx = (currentIdx + step) % count;
    const candidate = state.combat.combatants[candidateIdx];
    if (candidate && !candidate.defeated) {
      nextIdx = candidateIdx;
      break;
    }
  }

  if (nextIdx < 0) {
    return {
      ok: false,
      code: 'NO_ACTIVE_COMBATANTS',
      messageEs: 'Todos los combatientes están derrotados. Finalizá el combate con combat_end.',
    };
  }

  const roundAdvanced = nextIdx <= currentIdx;
  const nextRound = roundAdvanced ? state.combat.round + 1 : state.combat.round;

  const nextCombat = cloneCombatStateLocal(state.combat);
  nextCombat.turnIndex = nextIdx;
  nextCombat.round = nextRound;

  const activeCombatant = nextCombat.combatants[nextIdx]!;
  const nextSeq = state.lastSeq + 1;
  const stateDelta: GameStateDelta = {
    combat: nextCombat,
  };

  const event: GameEvent = {
    id: ctx.createId(),
    campaignId: state.campaignId,
    sessionId: state.sessionId,
    seq: nextSeq,
    type: 'COMBAT_TURN_ADVANCED',
    source: 'engine',
    visibility: input.visibility ?? 'public',
    actor: activeCombatant.id,
    checkId: null,
    declaredTotal: null,
    dieResults: null,
    payload: {
      sceneId: input.sceneId,
      previousCombatantId: previousCombatant.id,
      activeCombatantId: activeCombatant.id,
      activeCombatantName: activeCombatant.name,
      turnIndex: nextIdx,
      round: nextRound,
      roundAdvanced,
    },
    stateDelta,
    revertedByEventId: null,
    createdAt: ctx.now(),
  };

  const nextState = applyDelta(state, stateDelta, nextSeq);

  return {
    ok: true,
    combat: nextState.combat!,
    previousCombatant,
    activeCombatant,
    round: nextRound,
    roundAdvanced,
    event,
    nextState,
  };
}

// ---------- endCombat ----------

export const CombatOutcomeSchema = z.enum(['victory', 'fled', 'truce']);
export type CombatOutcome = z.infer<typeof CombatOutcomeSchema>;

export const EndCombatInputSchema = z
  .object({
    sceneId: z.string().min(1),
    outcome: CombatOutcomeSchema.optional(),
    reason: z.string().min(1).optional(),
    visibility: VisibilitySchema.optional(),
  })
  .strict();
export type EndCombatInput = z.infer<typeof EndCombatInputSchema>;

export type EndCombatResult =
  | {
      ok: true;
      outcome: CombatOutcome | null;
      reason: string | null;
      roundsElapsed: number;
      event: GameEvent;
      nextState: GameState;
    }
  | {
      ok: false;
      code: 'INVALID_INPUT' | 'INVALID_SCENE' | 'NO_ACTIVE_COMBAT';
      messageEs: string;
    };

export function endCombat(
  state: GameState,
  rawInput: unknown,
  ctx: ResolverContext,
): EndCombatResult {
  const parsed = EndCombatInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      messageEs: `Parámetros inválidos en combat_end: ${parsed.error.issues[0]?.message ?? 'formato incorrecto'}.`,
    };
  }

  const input = parsed.data;
  if (input.sceneId !== state.sceneId || !state.scenes[input.sceneId]) {
    return {
      ok: false,
      code: 'INVALID_SCENE',
      messageEs: `La escena "${input.sceneId}" no coincide con la escena activa ("${state.sceneId}").`,
    };
  }

  if (!state.combat || !state.combat.active) {
    return {
      ok: false,
      code: 'NO_ACTIVE_COMBAT',
      messageEs: 'No hay ningún combate activo para finalizar.',
    };
  }

  const roundsElapsed = state.combat.round;
  const nextSeq = state.lastSeq + 1;
  const stateDelta: GameStateDelta = {
    combat: null,
    ...(input.outcome
      ? {
          flagsSet: {
            'combat:lastOutcome': input.outcome,
            [`combat:${input.sceneId}:outcome`]: input.outcome,
          },
        }
      : {}),
  };

  const firstPcId = Object.keys(state.characters)[0] ?? 'system';
  const event: GameEvent = {
    id: ctx.createId(),
    campaignId: state.campaignId,
    sessionId: state.sessionId,
    seq: nextSeq,
    type: 'COMBAT_ENDED',
    source: 'engine',
    visibility: input.visibility ?? 'public',
    actor: firstPcId,
    checkId: null,
    declaredTotal: null,
    dieResults: null,
    payload: {
      sceneId: input.sceneId,
      outcome: input.outcome ?? null,
      reason: input.reason ?? null,
      roundsElapsed,
    },
    stateDelta,
    revertedByEventId: null,
    createdAt: ctx.now(),
  };

  const nextState = applyDelta(state, stateDelta, nextSeq);

  return {
    ok: true,
    outcome: input.outcome ?? null,
    reason: input.reason ?? null,
    roundsElapsed,
    event,
    nextState,
  };
}
