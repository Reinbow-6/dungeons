import { z } from 'zod';
import { doubleDiceExpression } from './combat.js';
import {
  buildRollTags,
  buildSpellActiveEffect,
  collectConcentrationPurge,
  getEffectiveAc,
  resolveModifiers,
} from './effects.js';
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
  getSavingThrowModifier,
  resolveDamageRelation,
  resolveRollMode,
  type ConcentrationCheckOutcome,
  type DamageRelation,
} from './modifiers.js';
import type { ResolverContext } from './resolvers.js';
import {
  RollModeSchema,
  rollD20,
  rollDice,
  type RollMode,
} from './rng.js';
import {
  AbilitySchema,
  VisibilitySchema,
  type Ability,
  type ActiveEffect,
  type Character,
  type CombatState,
  type Condition5e,
  type GameState,
} from './types.js';

export type SpellResolutionKind =
  | 'attack'
  | 'save'
  | 'auto_hit'
  | 'heal'
  | 'utility';

export interface CoreSpellSpec {
  id: string;
  nameEs: string;
  level: number;
  kind: SpellResolutionKind;
  concentration: boolean;
  attackType?: 'melee' | 'ranged';
  saveAbility?: Ability;
  halfOnSave?: boolean;
  /** Base dice expression (e.g. '1d10', '4d6', '2d8', '1d4+1'). */
  baseDice?: string;
  /** Dice added per slot level above base (e.g. '1d6', '2d8'). */
  upcastDicePerLevel?: string;
  /** Fixed number of projectiles/rays at base level (e.g. 3 for magic-missile / scorching-ray). */
  baseProjectiles?: number;
  projectilesPerUpcast?: number;
  /** Adds spellcasting modifier to healing or damage. */
  addsSpellMod?: boolean;
  /** Flat healing/HP bonus (e.g. Aid +5). */
  flatBonus?: number;
  damageType?: string;
  appliedConditionOnFail?: Condition5e;
  cantripScales?: boolean;
  summaryEs: string;
}

export const CORE_SPELLS_521: Record<string, CoreSpellSpec> = {
  'fire-bolt': {
    id: 'fire-bolt',
    nameEs: 'Descarga de fuego',
    level: 0,
    kind: 'attack',
    attackType: 'ranged',
    concentration: false,
    baseDice: '1d10',
    damageType: 'fire',
    cantripScales: true,
    summaryEs: 'Ataque mágico a distancia que inflige daño por fuego.',
  },
  'ray-of-frost': {
    id: 'ray-of-frost',
    nameEs: 'Rayo de escarcha',
    level: 0,
    kind: 'attack',
    attackType: 'ranged',
    concentration: false,
    baseDice: '1d8',
    damageType: 'cold',
    cantripScales: true,
    summaryEs: 'Ataque mágico a distancia de frío (-10 pies de velocidad hasta tu próximo turno).',
  },
  'chill-touch': {
    id: 'chill-touch',
    nameEs: 'Toque helado',
    level: 0,
    kind: 'attack',
    attackType: 'melee',
    concentration: false,
    baseDice: '1d10',
    damageType: 'necrotic',
    cantripScales: true,
    summaryEs: 'Ataque mágico cuerpo a cuerpo necrótico que impide curarse.',
  },
  'sacred-flame': {
    id: 'sacred-flame',
    nameEs: 'Llama sagrada',
    level: 0,
    kind: 'save',
    saveAbility: 'dex',
    halfOnSave: false,
    concentration: false,
    baseDice: '1d8',
    damageType: 'radiant',
    cantripScales: true,
    summaryEs: 'Llama divina (salvación de DES o daño radiante).',
  },
  'acid-splash': {
    id: 'acid-splash',
    nameEs: 'Salpicadura de ácido',
    level: 0,
    kind: 'save',
    saveAbility: 'dex',
    halfOnSave: false,
    concentration: false,
    baseDice: '1d6',
    damageType: 'acid',
    cantripScales: true,
    summaryEs: 'Burbuja ácida (salvación de DES o daño ácido).',
  },
  guidance: {
    id: 'guidance',
    nameEs: 'Guía',
    level: 0,
    kind: 'utility',
    concentration: true,
    summaryEs: 'Concentración: otorga +1d4 a la próxima prueba de habilidad elegida.',
  },
  'guiding-bolt': {
    id: 'guiding-bolt',
    nameEs: 'Saeta guía',
    level: 1,
    kind: 'attack',
    attackType: 'ranged',
    concentration: false,
    baseDice: '4d6',
    upcastDicePerLevel: '1d6',
    damageType: 'radiant',
    summaryEs: 'Ataque mágico radiante; el siguiente ataque contra el objetivo tiene ventaja.',
  },
  'magic-missile': {
    id: 'magic-missile',
    nameEs: 'Proyectil mágico',
    level: 1,
    kind: 'auto_hit',
    concentration: false,
    baseDice: '1d4+1',
    baseProjectiles: 3,
    projectilesPerUpcast: 1,
    damageType: 'force',
    summaryEs: 'Dardos de fuerza que impactan automáticamente (3 dardos en Nv. 1, +1 por nivel superior).',
  },
  'burning-hands': {
    id: 'burning-hands',
    nameEs: 'Manos ardientes',
    level: 1,
    kind: 'save',
    saveAbility: 'dex',
    halfOnSave: true,
    concentration: false,
    baseDice: '3d6',
    upcastDicePerLevel: '1d6',
    damageType: 'fire',
    summaryEs: 'Cono de fuego (salvación de DES para recibir mitad de daño).',
  },
  thunderwave: {
    id: 'thunderwave',
    nameEs: 'Onda atronadora',
    level: 1,
    kind: 'save',
    saveAbility: 'con',
    halfOnSave: true,
    concentration: false,
    baseDice: '2d8',
    upcastDicePerLevel: '1d8',
    damageType: 'thunder',
    summaryEs: 'Onda de choque (salvación de CON mitad; empuja 10 pies si falla).',
  },
  'inflict-wounds': {
    id: 'inflict-wounds',
    nameEs: 'Infligir heridas',
    level: 1,
    kind: 'save',
    saveAbility: 'con',
    halfOnSave: true,
    concentration: false,
    baseDice: '2d10',
    upcastDicePerLevel: '1d10',
    damageType: 'necrotic',
    summaryEs: 'Toque necrótico SRD 5.2.1 (salvación de CON mitad).',
  },
  'cure-wounds': {
    id: 'cure-wounds',
    nameEs: 'Curar heridas',
    level: 1,
    kind: 'heal',
    concentration: false,
    baseDice: '2d8',
    upcastDicePerLevel: '2d8',
    addsSpellMod: true,
    summaryEs: 'Curación de toque SRD 5.2.1 (2d8 + mod de lanzamiento).',
  },
  'healing-word': {
    id: 'healing-word',
    nameEs: 'Palabra de curación',
    level: 1,
    kind: 'heal',
    concentration: false,
    baseDice: '2d4',
    upcastDicePerLevel: '2d4',
    addsSpellMod: true,
    summaryEs: 'Curación a distancia como Acción Adicional SRD 5.2.1 (2d4 + mod).',
  },
  bless: {
    id: 'bless',
    nameEs: 'Bendición',
    level: 1,
    kind: 'utility',
    concentration: true,
    summaryEs: 'Concentración: hasta 3 aliados suman +1d4 a ataques y salvaciones.',
  },
  bane: {
    id: 'bane',
    nameEs: 'Perdición',
    level: 1,
    kind: 'save',
    saveAbility: 'cha',
    halfOnSave: false,
    concentration: true,
    summaryEs: 'Concentración (salvación de CAR): enemigos restan 1d4 a ataques y salvaciones.',
  },
  'shield-of-faith': {
    id: 'shield-of-faith',
    nameEs: 'Escudo de la fe',
    level: 1,
    kind: 'utility',
    concentration: true,
    summaryEs: 'Concentración: +2 a la CA de una criatura a 60 pies.',
  },
  shield: {
    id: 'shield',
    nameEs: 'Escudo arcano',
    level: 1,
    kind: 'utility',
    concentration: false,
    summaryEs: 'Reacción: +5 a la CA hasta el inicio de tu próximo turno y bloquea Proyectil mágico.',
  },
  sleep: {
    id: 'sleep',
    nameEs: 'Dormir',
    level: 1,
    kind: 'save',
    saveAbility: 'wis',
    halfOnSave: false,
    concentration: true,
    appliedConditionOnFail: 'incapacitated',
    summaryEs: 'Concentración SRD 5.2.1 (salvación de SAB): incapacita y duerme al objetivo.',
  },
  'faerie-fire': {
    id: 'faerie-fire',
    nameEs: 'Fuego feérico',
    level: 1,
    kind: 'save',
    saveAbility: 'dex',
    halfOnSave: false,
    concentration: true,
    summaryEs: 'Concentración (salvación de DES): los objetivos brillan y los ataques contra ellos tienen ventaja.',
  },
  'scorching-ray': {
    id: 'scorching-ray',
    nameEs: 'Rayo abrasador',
    level: 2,
    kind: 'attack',
    attackType: 'ranged',
    concentration: false,
    baseDice: '2d6',
    baseProjectiles: 3,
    projectilesPerUpcast: 1,
    damageType: 'fire',
    summaryEs: 'Tres rayos de fuego a distancia (2d6 fuego cada uno).',
  },
  'hold-person': {
    id: 'hold-person',
    nameEs: 'Inmovilizar persona',
    level: 2,
    kind: 'save',
    saveAbility: 'wis',
    halfOnSave: false,
    concentration: true,
    appliedConditionOnFail: 'paralyzed',
    summaryEs: 'Concentración (salvación de SAB): paraliza a un humanoide.',
  },
  aid: {
    id: 'aid',
    nameEs: 'Auxilio',
    level: 2,
    kind: 'heal',
    concentration: false,
    flatBonus: 5,
    summaryEs: 'Aumenta los PG actuales en 5 (+5 por nivel de espacio superior).',
  },
};

export interface SpellcastingStats {
  ability: Ability;
  abilityMod: number;
  proficiencyBonus: number;
  spellAttackBonus: number;
  spellSaveDc: number;
}

export function getSpellcastingStats(
  character: Character,
): SpellcastingStats | null {
  let ability: Ability | undefined = character.spellcastingAbility;
  if (!ability) {
    const hasSlotsOrSpells =
      Object.keys(character.spellSlots).length > 0 ||
      (character.knownSpells && character.knownSpells.length > 0);
    if (!hasSlotsOrSpells) {
      return null;
    }
    const cls = character.className.toLowerCase();
    if (cls.includes('mag') || cls.includes('wiz') || cls.includes('artif')) {
      ability = 'int';
    } else if (
      cls.includes('clér') ||
      cls.includes('cler') ||
      cls.includes('druid') ||
      cls.includes('explor') ||
      cls.includes('rang')
    ) {
      ability = 'wis';
    } else {
      ability = 'cha';
    }
  }

  const abilityMod = getAbilityModifier(character.abilities[ability]);
  const proficiencyBonus = getProficiencyBonus(character.level);
  return {
    ability,
    abilityMod,
    proficiencyBonus,
    spellAttackBonus: proficiencyBonus + abilityMod,
    spellSaveDc: 8 + proficiencyBonus + abilityMod,
  };
}

function scaleCantripDice(baseDice: string, casterLevel: number): string {
  const tier =
    casterLevel >= 17 ? 4 : casterLevel >= 11 ? 3 : casterLevel >= 5 ? 2 : 1;
  if (tier === 1) return baseDice;
  const match = /^(\d+)d(\d+)([+-]\d+)?$/i.exec(baseDice.trim());
  if (!match) return baseDice;
  const count = Number(match[1]) * tier;
  return `${count}d${match[2]}${match[3] ?? ''}`;
}

function addUpcastDice(
  baseDice: string,
  upcastDicePerLevel: string | undefined,
  extraLevels: number,
): string {
  if (!upcastDicePerLevel || extraLevels <= 0) return baseDice;
  const baseMatch = /^(\d+)d(\d+)([+-]\d+)?$/i.exec(baseDice.trim());
  const upMatch = /^(\d+)d(\d+)$/i.exec(upcastDicePerLevel.trim());
  if (baseMatch && upMatch && baseMatch[2] === upMatch[2]) {
    const totalCount = Number(baseMatch[1]) + Number(upMatch[1]) * extraLevels;
    return `${totalCount}d${baseMatch[2]}${baseMatch[3] ?? ''}`;
  }
  return baseDice;
}

function cloneCombatLocal(combat: CombatState): CombatState {
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

export const SpellFallbackMetaSchema = z.object({
  id: z.string().min(1),
  nameEs: z.string().min(1),
  level: z.number().int().min(0).max(9),
  concentration: z.boolean(),
  attackType: z.enum(['melee', 'ranged']).nullable().optional(),
  damageType: z.string().nullable().optional(),
  damageDice: z.string().nullable().optional(),
  saveAbility: AbilitySchema.optional(),
});

export const ResolveCastSpellInputSchema = z
  .object({
    sceneId: z.string().min(1),
    casterId: z.string().min(1),
    spellId: z.string().min(1),
    slotLevel: z.number().int().min(0).max(9).optional(),
    targetId: z.string().min(1).optional(),
    mode: RollModeSchema.optional(),
    visibility: VisibilitySchema.optional(),
    spellMetaFallback: SpellFallbackMetaSchema.optional(),
  })
  .strict();
export type ResolveCastSpellInput = z.infer<typeof ResolveCastSpellInputSchema>;

export type CastSpellErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_SCENE'
  | 'UNKNOWN_ACTOR'
  | 'INCAPACITATED'
  | 'NOT_A_SPELLCASTER'
  | 'UNKNOWN_SPELL'
  | 'SPELL_NOT_KNOWN'
  | 'INVALID_SLOT_LEVEL'
  | 'NO_SPELL_SLOTS'
  | 'TARGET_REQUIRED'
  | 'UNKNOWN_TARGET';

export type ResolveCastSpellResult =
  | {
      ok: true;
      spellId: string;
      spellNameEs: string;
      spellLevel: number;
      slotLevelUsed: number;
      kind: SpellResolutionKind;
      concentration: boolean;
      spellAttackBonus: number;
      spellSaveDc: number;
      targetId?: string;
      targetName?: string;
      attackRoll?: {
        rolls: number[];
        naturalRoll: number;
        total: number;
        targetAc: number;
        hit: boolean;
        isCritical: boolean;
        effectiveMode: RollMode;
      };
      savingThrow?: {
        ability: Ability;
        dc: number;
        rolls: number[];
        naturalRoll: number;
        modifier: number;
        total: number;
        saved: boolean;
      };
      damageRolls?: number[];
      damageDiceUsed?: string;
      damageType?: string;
      rawDamage?: number;
      damageApplied?: number;
      damageRelation?: DamageRelation;
      healingRolls?: number[];
      healingDiceUsed?: string;
      healingApplied?: number;
      targetHpBefore?: number;
      targetHpAfter?: number;
      targetConditionApplied?: Condition5e;
      targetConcentrationCheck?: ConcentrationCheckOutcome;
      slotPoolAfter?: { current: number; max: number };
      summaryEs: string;
      event: GameEvent;
      nextState: GameState;
    }
  | {
      ok: false;
      code: CastSpellErrorCode;
      messageEs: string;
    };

function resolveSpellSpec(
  spellId: string,
  slotLevel: number | undefined,
  fallback?: z.infer<typeof SpellFallbackMetaSchema>,
): CoreSpellSpec | null {
  const normalized = spellId.trim().toLowerCase().replace(/\s+/g, '-');
  const core = CORE_SPELLS_521[normalized];
  if (core) return core;

  if (!fallback) return null;

  let kind: SpellResolutionKind = 'utility';
  if (fallback.attackType) {
    kind = 'attack';
  } else if (fallback.saveAbility) {
    kind = 'save';
  } else if (fallback.damageDice) {
    kind = 'save';
  }

  return {
    id: fallback.id,
    nameEs: fallback.nameEs,
    level: fallback.level,
    kind,
    concentration: fallback.concentration,
    attackType: fallback.attackType ?? undefined,
    saveAbility: fallback.saveAbility ?? (kind === 'save' ? 'dex' : undefined),
    halfOnSave: fallback.level >= 1,
    baseDice: fallback.damageDice ?? undefined,
    damageType: fallback.damageType ?? undefined,
    cantripScales: fallback.level === 0,
    summaryEs: `Conjuro SRD 5.2.1 (${fallback.nameEs}, nivel ${slotLevel ?? fallback.level}).`,
  };
}

export function resolveCastSpell(
  state: GameState,
  rawInput: unknown,
  ctx: ResolverContext,
): ResolveCastSpellResult {
  const parsed = ResolveCastSpellInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      messageEs: `Parámetros inválidos en cast_spell: ${parsed.error.issues[0]?.message ?? 'formato incorrecto'}.`,
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

  const caster = state.characters[input.casterId];
  if (!caster) {
    return {
      ok: false,
      code: 'UNKNOWN_ACTOR',
      messageEs: `No existe el personaje lanzador "${input.casterId}".`,
    };
  }

  const casterEffects = getConditionPenalty(caster, state.ruleset);
  if (casterEffects.isIncapacitated || caster.hp.current <= 0) {
    return {
      ok: false,
      code: 'INCAPACITATED',
      messageEs: `${caster.name} está incapacitado o en 0 PG y no puede lanzar conjuros.`,
    };
  }

  const stats = getSpellcastingStats(caster);
  if (!stats) {
    return {
      ok: false,
      code: 'NOT_A_SPELLCASTER',
      messageEs: `${caster.name} (${caster.className}) no posee capacidad de lanzamiento de conjuros.`,
    };
  }

  const spec = resolveSpellSpec(
    input.spellId,
    input.slotLevel,
    input.spellMetaFallback,
  );
  if (!spec) {
    return {
      ok: false,
      code: 'UNKNOWN_SPELL',
      messageEs: `No se reconoce el conjuro "${input.spellId}". Consultá primero lookup_rules o revisá los conjuros conocidos del personaje.`,
    };
  }

  if (
    caster.knownSpells &&
    caster.knownSpells.length > 0 &&
    !caster.knownSpells.includes(spec.id)
  ) {
    return {
      ok: false,
      code: 'SPELL_NOT_KNOWN',
      messageEs: `${caster.name} no tiene preparado/conocido el conjuro "${spec.nameEs}" (${spec.id}). Conjuros disponibles: ${caster.knownSpells.join(', ')}.`,
    };
  }

  const slotLevelUsed = spec.level === 0 ? 0 : (input.slotLevel ?? spec.level);
  if (spec.level > 0 && slotLevelUsed < spec.level) {
    return {
      ok: false,
      code: 'INVALID_SLOT_LEVEL',
      messageEs: `${spec.nameEs} requiere al menos un espacio de conjuro de nivel ${spec.level}.`,
    };
  }

  let slotPoolBefore: { current: number; max: number } | undefined;
  let slotPoolAfter: { current: number; max: number } | undefined;
  if (slotLevelUsed >= 1) {
    const pool = caster.spellSlots[String(slotLevelUsed)];
    if (!pool || pool.current < 1) {
      return {
        ok: false,
        code: 'NO_SPELL_SLOTS',
        messageEs: `${caster.name} no tiene espacios de conjuro de nivel ${slotLevelUsed} disponibles.`,
      };
    }
    slotPoolBefore = { ...pool };
    slotPoolAfter = { current: pool.current - 1, max: pool.max };
  }

  // Resolve target (character or combatant)
  const resolvedTargetId =
    input.targetId ?? (spec.kind === 'heal' ? caster.id : undefined);
  let targetChar: Character | undefined;
  let targetCombatantIdx = -1;
  const activeCombat = state.combat?.active ? state.combat : null;

  if (resolvedTargetId) {
    targetChar = state.characters[resolvedTargetId];
    if (activeCombat) {
      targetCombatantIdx = activeCombat.combatants.findIndex(
        (c) => c.id === resolvedTargetId || c.actorId === resolvedTargetId,
      );
      if (!targetChar && targetCombatantIdx >= 0) {
        const comb = activeCombat.combatants[targetCombatantIdx];
        if (comb?.actorId && state.characters[comb.actorId]) {
          targetChar = state.characters[comb.actorId];
        }
      }
    }
    if (!targetChar && targetCombatantIdx < 0) {
      return {
        ok: false,
        code: 'UNKNOWN_TARGET',
        messageEs: `El objetivo "${resolvedTargetId}" no existe en la escena ni en el combate activo.`,
      };
    }
  } else if (
    spec.kind === 'attack' ||
    spec.kind === 'save' ||
    spec.kind === 'auto_hit'
  ) {
    return {
      ok: false,
      code: 'TARGET_REQUIRED',
      messageEs: `${spec.nameEs} requiere especificar un objetivo (targetId).`,
    };
  }

  const targetCombatant =
    activeCombat && targetCombatantIdx >= 0
      ? activeCombat.combatants[targetCombatantIdx]
      : undefined;
  const targetName = targetChar?.name ?? targetCombatant?.name;
  const targetActiveEffects =
    targetChar?.activeEffects ?? targetCombatant?.activeEffects ?? [];
  const targetBaseAc = targetChar?.ac ?? targetCombatant?.ac ?? 12;
  const effectiveTargetAc = getEffectiveAc(
    { ac: targetBaseAc, activeEffects: targetActiveEffects },
    buildRollTags({
      kind: 'ac',
      attackKind: spec.attackType,
      conditions: targetChar?.conditions ?? targetCombatant?.conditions ?? [],
      inCombat: Boolean(activeCombat),
      sceneId: input.sceneId,
    }),
  ).effectiveAc;

  const extraUpcastLevels =
    spec.level >= 1 ? Math.max(0, slotLevelUsed - spec.level) : 0;

  let attackRollSummary:
    | {
        rolls: number[];
        naturalRoll: number;
        total: number;
        targetAc: number;
        hit: boolean;
        isCritical: boolean;
        effectiveMode: RollMode;
      }
    | undefined;
  let savingThrowSummary:
    | {
        ability: Ability;
        dc: number;
        rolls: number[];
        naturalRoll: number;
        modifier: number;
        total: number;
        saved: boolean;
      }
    | undefined;
  let damageRolls: number[] | undefined;
  let damageDiceUsed: string | undefined;
  let rawDamage: number | undefined;
  let damageApplied: number | undefined;
  let damageRelation: DamageRelation | undefined;
  let healingRolls: number[] | undefined;
  let healingDiceUsed: string | undefined;
  let healingApplied: number | undefined;
  let targetConditionApplied: Condition5e | undefined;
  let dieResults: number[] | null = null;
  const consumedAttackEffects: Array<{ targetId: string; effectId: string }> = [];

  const computeEffectiveDice = (): string | undefined => {
    if (!spec.baseDice) return undefined;
    if (spec.level === 0 && spec.cantripScales) {
      return scaleCantripDice(spec.baseDice, caster.level);
    }
    return addUpcastDice(
      spec.baseDice,
      spec.upcastDicePerLevel,
      extraUpcastLevels,
    );
  };

  if (spec.kind === 'attack') {
    const targetEffects = targetChar
      ? getConditionPenalty(targetChar, state.ruleset)
      : getConditionsEffects(targetCombatant?.conditions ?? [], 0);
    const spellAttackTags = buildRollTags({
      kind: 'attack',
      attackKind: spec.attackType,
      conditions: caster.conditions,
      inCombat: Boolean(activeCombat),
      sceneId: input.sceneId,
    });
    const spellAttackRes = resolveModifiers({
      baseModifiers: [
        {
          slug: 'spell:attack',
          labelEs: 'Atq. conjuro',
          target: 'attack',
          value: stats.spellAttackBonus,
          type: 'untyped',
        },
        ...(casterEffects.effectiveExhaustionLevel > 0
          ? [
              {
                slug: 'exhaustion',
                labelEs: `Agotamiento Nv.${casterEffects.effectiveExhaustionLevel}`,
                target: 'attack' as const,
                value: casterEffects.d20Modifier,
                type: 'status' as const,
              },
            ]
          : []),
      ],
      activeEffects: caster.activeEffects,
      opponentEffects: targetActiveEffects,
      target: 'attack',
      tags: spellAttackTags,
      rng: ctx.rng,
    });
    for (const effId of spellAttackRes.consumedEffectIds) {
      if ((caster.activeEffects ?? []).some((e) => e.id === effId)) {
        consumedAttackEffects.push({ targetId: caster.id, effectId: effId });
      } else if (targetActiveEffects.some((e) => e.id === effId)) {
        consumedAttackEffects.push({
          targetId: targetChar?.id ?? targetCombatant?.id ?? resolvedTargetId!,
          effectId: effId,
        });
      }
    }

    const effectiveMode = resolveRollMode({
      requested: input.mode ?? 'normal',
      hasAdvantage:
        casterEffects.grantsAdvantageOnAttacks ||
        targetEffects.grantsAdvantageToAttackers ||
        spellAttackRes.grantsAdvantage,
      hasDisadvantage:
        casterEffects.imposesDisadvantageOnAttacks ||
        targetEffects.imposesDisadvantageToAttackers ||
        spellAttackRes.imposesDisadvantage,
    });
    const roll = rollD20(ctx.rng, effectiveMode);
    dieResults = roll.rolls;
    const isCritical = roll.chosen === 20;
    const isAutoMiss = roll.chosen === 1;
    const total = roll.chosen + spellAttackRes.totalMod;
    const hit = !isAutoMiss && (isCritical || total >= effectiveTargetAc);

    attackRollSummary = {
      rolls: roll.rolls,
      naturalRoll: roll.chosen,
      total,
      targetAc: effectiveTargetAc,
      hit,
      isCritical,
      effectiveMode,
    };

    if (hit && spec.baseDice) {
      const baseExpr = computeEffectiveDice()!;
      const projectiles =
        (spec.baseProjectiles ?? 1) +
        (spec.projectilesPerUpcast ?? 0) * extraUpcastLevels;
      damageDiceUsed =
        projectiles > 1
          ? `${projectiles}×(${isCritical ? doubleDiceExpression(baseExpr) : baseExpr})`
          : isCritical
            ? doubleDiceExpression(baseExpr)
            : baseExpr;
      const rollsCollected: number[] = [];
      let sum = 0;
      const singleExpr = isCritical ? doubleDiceExpression(baseExpr) : baseExpr;
      for (let i = 0; i < projectiles; i += 1) {
        const res = rollDice(singleExpr, ctx.rng);
        rollsCollected.push(...res.rolls);
        sum += Math.max(0, res.total);
      }
      if (spec.addsSpellMod) {
        sum += stats.abilityMod;
      }
      damageRolls = rollsCollected;
      rawDamage = Math.max(0, sum);
    }
  } else if (spec.kind === 'auto_hit') {
    const projectiles =
      (spec.baseProjectiles ?? 1) +
      (spec.projectilesPerUpcast ?? 0) * extraUpcastLevels;
    const singleExpr = spec.baseDice ?? '1d4+1';
    damageDiceUsed = `${projectiles}×(${singleExpr})`;
    const rollsCollected: number[] = [];
    let sum = 0;
    for (let i = 0; i < projectiles; i += 1) {
      const res = rollDice(singleExpr, ctx.rng);
      rollsCollected.push(...res.rolls);
      sum += Math.max(0, res.total);
    }
    damageRolls = rollsCollected;
    rawDamage = Math.max(0, sum);
  } else if (spec.kind === 'save') {
    const saveAbility: Ability = spec.saveAbility ?? 'dex';
    const targetEffects = targetChar
      ? getConditionPenalty(targetChar, state.ruleset)
      : getConditionsEffects(targetCombatant?.conditions ?? [], 0);
    const targetSaveTags = buildRollTags({
      kind: 'save',
      ability: saveAbility,
      conditions: targetChar?.conditions ?? targetCombatant?.conditions ?? [],
      inCombat: Boolean(activeCombat),
      sceneId: input.sceneId,
    });
    const targetSaveRes = targetChar
      ? getSavingThrowModifier(targetChar, saveAbility, state.ruleset, {
          rng: ctx.rng,
          tags: targetSaveTags,
        })
      : resolveModifiers({
          activeEffects: targetCombatant?.activeEffects,
          target: 'save',
          tags: targetSaveTags,
          rng: ctx.rng,
        });
    const saveMod = targetSaveRes.totalMod;
    for (const effId of targetSaveRes.consumedEffectIds) {
      consumedAttackEffects.push({
        targetId: targetChar?.id ?? targetCombatant?.id ?? resolvedTargetId!,
        effectId: effId,
      });
    }
    const autoFail =
      targetEffects.autoFailStrDexSaves &&
      (saveAbility === 'str' || saveAbility === 'dex');
    const effectiveSaveMode = resolveRollMode({
      requested: input.mode ?? 'normal',
      hasAdvantage: targetSaveRes.grantsAdvantage,
      hasDisadvantage:
        targetSaveRes.imposesDisadvantage ||
        (saveAbility === 'dex' && targetEffects.disadvantageOnDexSaves),
    });
    const roll = autoFail
      ? { rolls: [1], chosen: 1 }
      : rollD20(ctx.rng, effectiveSaveMode);
    dieResults = roll.rolls;
    const total = autoFail ? 0 : roll.chosen + saveMod;
    const saved = !autoFail && total >= stats.spellSaveDc;

    savingThrowSummary = {
      ability: saveAbility,
      dc: stats.spellSaveDc,
      rolls: roll.rolls,
      naturalRoll: roll.chosen,
      modifier: saveMod,
      total,
      saved,
    };

    if (spec.baseDice) {
      damageDiceUsed = computeEffectiveDice()!;
      const dmgRes = rollDice(damageDiceUsed, ctx.rng);
      damageRolls = dmgRes.rolls;
      const rolled = Math.max(0, dmgRes.total);
      if (!saved) {
        rawDamage = rolled;
      } else if (spec.halfOnSave) {
        rawDamage = Math.floor(rolled / 2);
      } else {
        rawDamage = 0;
      }
    }

    if (!saved && spec.appliedConditionOnFail) {
      targetConditionApplied = spec.appliedConditionOnFail;
    }
  } else if (spec.kind === 'heal') {
    const baseExpr = computeEffectiveDice();
    let totalHeal = 0;
    if (baseExpr) {
      healingDiceUsed = spec.addsSpellMod
        ? `${baseExpr}+${stats.abilityMod}`
        : baseExpr;
      const healRes = rollDice(baseExpr, ctx.rng);
      healingRolls = healRes.rolls;
      totalHeal += healRes.total + (spec.addsSpellMod ? stats.abilityMod : 0);
    }
    if (spec.flatBonus) {
      totalHeal += spec.flatBonus + 5 * extraUpcastLevels;
      if (!healingDiceUsed) {
        healingDiceUsed = `+${totalHeal}`;
      }
    }
    healingApplied = Math.max(1, totalHeal);
  }

  // Apply damage/healing & build reversible stateDelta
  const stateDelta: GameStateDelta = {};
  if (slotLevelUsed >= 1 && slotPoolBefore && slotPoolAfter) {
    stateDelta.spellSlotChanges = [
      {
        actorId: caster.id,
        level: String(slotLevelUsed),
        before: slotPoolBefore.current,
        after: slotPoolAfter.current,
      },
    ];
  }

  const effectsRemovedAcc: Array<{ targetId: string; effectId: string }> = [
    ...consumedAttackEffects,
  ];
  const conditionsRemovedAcc: Array<{ actorId: string; condition: Condition5e }> =
    [];

  if (spec.concentration && caster.concentratingOn !== spec.nameEs) {
    if (caster.concentratingOn) {
      const prevPurge = collectConcentrationPurge(
        state,
        caster.id,
        caster.concentratingOn,
      );
      effectsRemovedAcc.push(...prevPurge.effectsRemoved);
      conditionsRemovedAcc.push(...prevPurge.conditionsRemoved);
    }
    stateDelta.concentrationChanges = [
      {
        actorId: caster.id,
        before: caster.concentratingOn,
        after: spec.nameEs,
      },
    ];
  }

  // Attach tactical ActiveEffect when spell hits / target fails save / utility buff
  const shouldApplySpellEffect =
    (spec.kind === 'utility' && Boolean(targetChar || targetCombatant || !resolvedTargetId)) ||
    (spec.kind === 'attack' && Boolean(attackRollSummary?.hit)) ||
    (spec.kind === 'save' && Boolean(savingThrowSummary && !savingThrowSummary.saved));
  const effectsAddedAcc: Array<{ targetId: string; effect: ActiveEffect }> = [];

  if (shouldApplySpellEffect) {
    const effectTargetId =
      targetChar?.id ?? targetCombatant?.id ?? resolvedTargetId ?? caster.id;
    const builtEffect = buildSpellActiveEffect({
      spellId: spec.id,
      effectId: ctx.createId(),
      sourceActorId: caster.id,
      targetNameEs: targetName ?? caster.name,
    });
    if (builtEffect) {
      effectsAddedAcc.push({
        targetId: effectTargetId,
        effect: builtEffect,
      });
    }
  }

  let targetHpBefore: number | undefined;
  let targetHpAfter: number | undefined;
  let targetConcentrationCheck: ConcentrationCheckOutcome | undefined;

  const nextCombat = activeCombat ? cloneCombatLocal(activeCombat) : undefined;
  const updatedCombatant =
    nextCombat && targetCombatantIdx >= 0
      ? nextCombat.combatants[targetCombatantIdx]
      : undefined;

  if (rawDamage !== undefined && rawDamage > 0 && (targetChar || targetCombatant)) {
    const dmgRel = resolveDamageRelation(rawDamage, spec.damageType ?? 'force', {
      immunities: targetCombatant?.immunities ?? [],
      vulnerabilities: targetCombatant?.vulnerabilities ?? [],
      resistances: [
        ...(targetCombatant?.resistances ?? []),
        ...(targetChar?.resistances ?? []),
      ],
    });
    damageRelation = dmgRel.relation;
    damageApplied = dmgRel.damageApplied;

    if (targetChar) {
      const absorbed = Math.min(targetChar.hp.temp, damageApplied);
      const remaining = damageApplied - absorbed;
      targetHpBefore = targetChar.hp.current;
      targetHpAfter = Math.max(0, targetHpBefore - remaining);

      stateDelta.hpChanges = [
        { actorId: targetChar.id, before: targetHpBefore, after: targetHpAfter },
      ];
      if (absorbed > 0) {
        stateDelta.tempHpChanges = [
          {
            actorId: targetChar.id,
            before: targetChar.hp.temp,
            after: Math.max(0, targetChar.hp.temp - absorbed),
          },
        ];
      }

      if (state.ruleset === '5e-full' && targetHpAfter <= 0) {
        const existingDs = targetChar.deathSaves ?? {
          successes: 0,
          failures: 0,
          stable: false,
        };
        if (targetHpBefore > 0) {
          if (!targetChar.conditions.includes('unconscious')) {
            stateDelta.conditionsAdded = [
              ...(stateDelta.conditionsAdded ?? []),
              { actorId: targetChar.id, condition: 'unconscious' },
            ];
          }
          stateDelta.deathSaveChanges = [
            {
              actorId: targetChar.id,
              before: existingDs,
              after: { successes: 0, failures: 0, stable: false },
            },
          ];
        } else if (damageApplied > 0) {
          const added = attackRollSummary?.isCritical ? 2 : 1;
          const failures = Math.min(3, existingDs.failures + added);
          stateDelta.deathSaveChanges = [
            {
              actorId: targetChar.id,
              before: existingDs,
              after: {
                successes: existingDs.successes,
                failures,
                stable: false,
              },
            },
          ];
          if (failures >= 3) {
            stateDelta.flagsSet = {
              ...(stateDelta.flagsSet ?? {}),
              [`pc:${targetChar.id}:dead`]: true,
            };
          }
        }
      }

      targetConcentrationCheck = evaluateConcentrationCheck({
        character: targetChar,
        damageApplied,
        hpAfter: targetHpAfter,
        ruleset: state.ruleset,
        rng: ctx.rng,
      });
      if (
        targetConcentrationCheck &&
        !targetConcentrationCheck.maintained &&
        targetChar.concentratingOn
      ) {
        const tgtPurge = collectConcentrationPurge(
          state,
          targetChar.id,
          targetChar.concentratingOn,
        );
        effectsRemovedAcc.push(...tgtPurge.effectsRemoved);
        conditionsRemovedAcc.push(...tgtPurge.conditionsRemoved);
        stateDelta.concentrationChanges = [
          ...(stateDelta.concentrationChanges ?? []),
          {
            actorId: targetChar.id,
            before: targetChar.concentratingOn,
            after: null,
          },
        ];
      }
    } else if (updatedCombatant) {
      targetHpBefore = updatedCombatant.hp.current;
      targetHpAfter = Math.max(0, targetHpBefore - damageApplied);
      updatedCombatant.hp.current = targetHpAfter;
      updatedCombatant.defeated = targetHpAfter <= 0;
      stateDelta.combat = nextCombat;
    }

    if (updatedCombatant && targetChar && targetHpAfter !== undefined) {
      updatedCombatant.hp.current = targetHpAfter;
      if (state.ruleset === '5e-full') {
        const failuresAfter =
          stateDelta.deathSaveChanges?.[0]?.after.failures ??
          targetChar.deathSaves?.failures ??
          0;
        updatedCombatant.defeated = targetHpAfter <= 0 && failuresAfter >= 3;
      } else {
        updatedCombatant.defeated = targetHpAfter <= 0;
      }
      stateDelta.combat = nextCombat;
    }
  } else if (rawDamage === 0) {
    damageApplied = 0;
  }

  if (healingApplied !== undefined && healingApplied > 0) {
    if (targetChar) {
      targetHpBefore = targetChar.hp.current;
      targetHpAfter = Math.min(targetChar.hp.max, targetHpBefore + healingApplied);
      stateDelta.hpChanges = [
        { actorId: targetChar.id, before: targetHpBefore, after: targetHpAfter },
      ];
      if (targetHpBefore === 0 && targetHpAfter > 0) {
        if (targetChar.conditions.includes('unconscious')) {
          stateDelta.conditionsRemoved = [
            ...(stateDelta.conditionsRemoved ?? []),
            { actorId: targetChar.id, condition: 'unconscious' },
          ];
        }
        if (targetChar.deathSaves) {
          stateDelta.deathSaveChanges = [
            {
              actorId: targetChar.id,
              before: targetChar.deathSaves,
              after: { successes: 0, failures: 0, stable: false },
            },
          ];
        }
      }
      if (updatedCombatant) {
        updatedCombatant.hp.current = targetHpAfter;
        updatedCombatant.defeated = false;
        if (targetHpBefore === 0 && targetHpAfter > 0 && updatedCombatant.conditions) {
          updatedCombatant.conditions = updatedCombatant.conditions.filter(
            (c) => c !== 'unconscious',
          );
        }
        stateDelta.combat = nextCombat;
      }
    } else if (updatedCombatant) {
      targetHpBefore = updatedCombatant.hp.current;
      targetHpAfter = Math.min(
        updatedCombatant.hp.max,
        targetHpBefore + healingApplied,
      );
      updatedCombatant.hp.current = targetHpAfter;
      updatedCombatant.defeated = false;
      stateDelta.combat = nextCombat;
    }
  }

  if (targetConditionApplied) {
    if (targetChar && !targetChar.conditions.includes(targetConditionApplied)) {
      stateDelta.conditionsAdded = [
        ...(stateDelta.conditionsAdded ?? []),
        { actorId: targetChar.id, condition: targetConditionApplied },
      ];
    }
    if (updatedCombatant) {
      const conds = new Set(updatedCombatant.conditions ?? []);
      conds.add(targetConditionApplied);
      updatedCombatant.conditions = Array.from(conds);
      stateDelta.combat = nextCombat;
    }
  }

  if (effectsAddedAcc.length > 0) {
    stateDelta.effectsAdded = effectsAddedAcc;
  }
  if (effectsRemovedAcc.length > 0) {
    stateDelta.effectsRemoved = effectsRemovedAcc;
  }
  if (conditionsRemovedAcc.length > 0) {
    stateDelta.conditionsRemoved = [
      ...(stateDelta.conditionsRemoved ?? []),
      ...conditionsRemovedAcc,
    ];
  }

  const nextSeq = state.lastSeq + 1;
  const event: GameEvent = {
    id: ctx.createId(),
    campaignId: state.campaignId,
    sessionId: state.sessionId,
    seq: nextSeq,
    type: 'SPELL_CAST',
    source: 'engine',
    visibility: input.visibility ?? 'public',
    actor: caster.id,
    checkId: null,
    declaredTotal: null,
    dieResults,
    payload: {
      sceneId: input.sceneId,
      casterId: caster.id,
      casterName: caster.name,
      spellId: spec.id,
      spellNameEs: spec.nameEs,
      spellLevel: spec.level,
      slotLevelUsed,
      kind: spec.kind,
      concentration: spec.concentration,
      spellAttackBonus: stats.spellAttackBonus,
      spellSaveDc: stats.spellSaveDc,
      ...(resolvedTargetId ? { targetId: resolvedTargetId } : {}),
      ...(targetName ? { targetName } : {}),
      ...(attackRollSummary ? { attackRoll: attackRollSummary } : {}),
      ...(savingThrowSummary ? { savingThrow: savingThrowSummary } : {}),
      ...(damageApplied !== undefined ? { damageApplied, damageType: spec.damageType } : {}),
      ...(healingApplied !== undefined ? { healingApplied } : {}),
      ...(targetHpBefore !== undefined ? { targetHpBefore, targetHpAfter } : {}),
      ...(targetConditionApplied ? { targetConditionApplied } : {}),
      ...(slotPoolAfter ? { slotPoolAfter } : {}),
    },
    stateDelta,
    revertedByEventId: null,
    createdAt: ctx.now(),
  };

  const nextState = applyDelta(state, stateDelta, nextSeq);

  return {
    ok: true,
    spellId: spec.id,
    spellNameEs: spec.nameEs,
    spellLevel: spec.level,
    slotLevelUsed,
    kind: spec.kind,
    concentration: spec.concentration,
    spellAttackBonus: stats.spellAttackBonus,
    spellSaveDc: stats.spellSaveDc,
    ...(resolvedTargetId ? { targetId: resolvedTargetId } : {}),
    ...(targetName ? { targetName } : {}),
    ...(attackRollSummary ? { attackRoll: attackRollSummary } : {}),
    ...(savingThrowSummary ? { savingThrow: savingThrowSummary } : {}),
    ...(damageRolls ? { damageRolls } : {}),
    ...(damageDiceUsed ? { damageDiceUsed } : {}),
    ...(spec.damageType ? { damageType: spec.damageType } : {}),
    ...(rawDamage !== undefined ? { rawDamage } : {}),
    ...(damageApplied !== undefined ? { damageApplied } : {}),
    ...(damageRelation ? { damageRelation } : {}),
    ...(healingRolls ? { healingRolls } : {}),
    ...(healingDiceUsed ? { healingDiceUsed } : {}),
    ...(healingApplied !== undefined ? { healingApplied } : {}),
    ...(targetHpBefore !== undefined ? { targetHpBefore, targetHpAfter } : {}),
    ...(targetConditionApplied ? { targetConditionApplied } : {}),
    ...(targetConcentrationCheck ? { targetConcentrationCheck } : {}),
    ...(slotPoolAfter ? { slotPoolAfter } : {}),
    summaryEs: spec.summaryEs,
    event,
    nextState,
  };
}
