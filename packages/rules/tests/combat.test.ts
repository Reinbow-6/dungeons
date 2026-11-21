import { describe, expect, it } from 'vitest';
import {
  advanceCombatTurn,
  createAguasQuietasInitialState,
  createDefaultAuthority,
  createRng,
  deriveCharacterAttacks,
  doubleDiceExpression,
  endCombat,
  reduceEvents,
  resolveCombatAttack,
  rollbackToSeq,
  startCombat,
  type Character,
  type CombatEnemyDefinition,
  type GameEvent,
  type Rng,
} from '../src/index.js';

function makeContext(seed: number | string = 42) {
  let idCounter = 0;
  return {
    rng: createRng(seed),
    createId: () => `evt_${++idCounter}`,
    now: () => '2026-11-19T12:00:00.000Z',
  };
}

function makeFixedRng(sequence: number[]): Rng {
  let cursor = 0;
  return {
    next: () => 0.5,
    nextInt: (min: number, max: number) => {
      const value = sequence[cursor] ?? min;
      cursor += 1;
      if (value < min || value > max) {
        throw new Error(`Fixed RNG value ${value} out of bounds [${min}, ${max}]`);
      }
      return value;
    },
  };
}

function makeFixedContext(sequence: number[]) {
  let idCounter = 0;
  return {
    rng: makeFixedRng(sequence),
    createId: () => `fix_${++idCounter}`,
    now: () => '2026-11-19T12:00:00.000Z',
  };
}

const EXPLORADOR_ENEMY: CombatEnemyDefinition = {
  id: 'explorador_1',
  name: 'Explorador de la Espesura #1',
  creatureId: 'explorador_espesura',
  hp: 16,
  ac: 13,
  dexMod: 2,
  attacks: [
    {
      id: 'arco_largo',
      nameEs: 'Arco largo',
      attackBonus: 4,
      damageDice: '1d8+2',
      damageType: 'piercing',
    },
    {
      id: 'espada_corta',
      nameEs: 'Espada corta',
      attackBonus: 4,
      damageDice: '1d6+2',
      damageType: 'piercing',
    },
  ],
  vulnerabilities: [],
  immunities: [],
};

const NECROFAGO_ENEMY: CombatEnemyDefinition = {
  id: 'necrofago_1',
  name: 'Necrófago de río',
  creatureId: 'necrofago_de_rio',
  hp: 18,
  ac: 12,
  dexMod: 2,
  attacks: [
    {
      id: 'garras_fangosas',
      nameEs: 'Garras fangosas',
      attackBonus: 4,
      damageDice: '1d6+2',
      damageType: 'slashing',
    },
  ],
  vulnerabilities: ['fire'],
  immunities: ['poison'],
};

describe('5e-lite combat engine', () => {
  it('derives deterministic 5e weapon attacks for Kael, Brenna, Lira, and unarmed fallback', () => {
    const kael = createAguasQuietasInitialState().characters.pc_kael!;
    expect(deriveCharacterAttacks(kael)).toEqual([
      {
        id: 'shortbow',
        nameEs: 'Arco corto',
        attackBonus: 5,
        damageDice: '1d6+3',
        damageType: 'piercing',
      },
      {
        id: 'shortsword',
        nameEs: 'Espada corta',
        attackBonus: 5,
        damageDice: '1d6+3',
        damageType: 'piercing',
      },
    ]);

    const brenna: Character = {
      id: 'pc_brenna',
      name: 'Brenna de Piedrafría',
      species: 'Enana de las Colinas',
      className: 'Guerrera',
      level: 1,
      abilities: { str: 16, dex: 12, con: 16, int: 10, wis: 12, cha: 8 },
      skillProficiencies: {},
      savingThrowProficiencies: ['str', 'con'],
      hp: { current: 13, max: 13, temp: 0 },
      ac: 16,
      speed: 25,
      conditions: [],
      exhaustionLevel: 0,
      inventory: [{ itemId: 'longsword', name: 'Espada larga', quantity: 1 }],
      spellSlots: {},
      concentratingOn: null,
      authority: createDefaultAuthority('digital'),
      rollAuthority: 'engine-rolled',
    };
    expect(deriveCharacterAttacks(brenna)).toEqual([
      {
        id: 'longsword',
        nameEs: 'Espada larga',
        attackBonus: 5,
        damageDice: '1d8+3',
        damageType: 'slashing',
      },
    ]);

    const lira: Character = {
      ...brenna,
      id: 'pc_lira',
      name: 'Lira Vael',
      abilities: { str: 8, dex: 16, con: 12, int: 14, wis: 12, cha: 14 },
      inventory: [{ itemId: 'dagger', name: 'Daga', quantity: 2 }],
    };
    expect(deriveCharacterAttacks(lira)).toEqual([
      {
        id: 'dagger',
        nameEs: 'Daga',
        attackBonus: 5,
        damageDice: '1d4+3',
        damageType: 'piercing',
      },
    ]);

    const unarmedChar: Character = {
      ...brenna,
      inventory: [{ itemId: 'rations', name: 'Raciones', quantity: 2 }],
    };
    expect(deriveCharacterAttacks(unarmedChar)).toEqual([
      {
        id: 'unarmed',
        nameEs: 'Golpe desarmado',
        attackBonus: 5,
        damageDice: '1d4+3',
        damageType: 'bludgeoning',
      },
    ]);
  });

  it('doubles dice count without doubling flat modifier on critical hits', () => {
    expect(doubleDiceExpression('1d8+3')).toBe('2d8+3');
    expect(doubleDiceExpression('1d6')).toBe('2d6');
    expect(doubleDiceExpression('2d6-1')).toBe('4d6-1');
  });

  it('rolls initiative, sorts turn order deterministically (including tie-breakers), and blocks double start', () => {
    const state = createAguasQuietasInitialState();
    // Kael has DEX 16 (+3), Explorador has dexMod +2, Necrofago has dexMod +2
    // Fixed d20 rolls: Kael rolls 10 (total 13), Explorador rolls 11 (total 13), Necrofago rolls 15 (total 17)
    const ctx = makeFixedContext([10, 11, 15]);

    const started = startCombat(
      state,
      {
        sceneId: 'escena_01_orilla',
        enemies: [EXPLORADOR_ENEMY, NECROFAGO_ENEMY],
      },
      ctx,
    );
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    expect(started.event.type).toBe('COMBAT_STARTED');
    expect(started.event.source).toBe('engine');
    expect(started.combat.active).toBe(true);
    expect(started.combat.round).toBe(1);
    expect(started.combat.turnIndex).toBe(0);

    // Necrofago (17) first, then tie at 13 broken by higher dexMod (Kael +3 > Explorador +2)
    expect(started.combat.combatants.map((c) => c.id)).toEqual([
      'necrofago_1',
      'pc_kael',
      'explorador_1',
    ]);
    expect(started.combat.combatants.map((c) => c.initiative)).toEqual([
      17, 13, 13,
    ]);
    expect(started.activeCombatant.id).toBe('necrofago_1');

    // Starting combat again while active must fail with zero mutation
    const duplicate = startCombat(
      started.nextState,
      {
        sceneId: 'escena_01_orilla',
        enemies: [EXPLORADOR_ENEMY],
      },
      makeContext(99),
    );
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) {
      expect(duplicate.code).toBe('COMBAT_ALREADY_ACTIVE');
    }
  });

  it('handles normal hit, normal miss, natural 20 critical hit (doubled dice), and natural 1 auto-miss', () => {
    const initial = createAguasQuietasInitialState();
    // Start combat: Kael init 15 (+3=18), high-AC armored boss init 5 (+2=7)
    const tankEnemy: CombatEnemyDefinition = {
      id: 'tank_1',
      name: 'Centinela acorazado',
      hp: 30,
      ac: 25,
      dexMod: 0,
      attacks: [
        {
          id: 'halberd',
          nameEs: 'Alabarda',
          attackBonus: 20, // huge bonus to prove nat 1 still misses AC 14!
          damageDice: '1d10+4',
          damageType: 'slashing',
        },
      ],
    };

    const startRes = startCombat(
      initial,
      { sceneId: 'escena_01_orilla', enemies: [tankEnemy] },
      makeFixedContext([15, 5]),
    );
    expect(startRes.ok).toBe(true);
    if (!startRes.ok) return;

    // 1. Kael rolls 10 (+5 = 15 vs AC 25) -> normal miss
    const missRes = resolveCombatAttack(
      startRes.nextState,
      {
        sceneId: 'escena_01_orilla',
        attackerId: 'pc_kael',
        targetId: 'tank_1',
        attackId: 'shortbow',
      },
      makeFixedContext([10]),
    );
    expect(missRes.ok).toBe(true);
    if (!missRes.ok) return;
    expect(missRes.hit).toBe(false);
    expect(missRes.isCritical).toBe(false);
    expect(missRes.isCriticalMiss).toBe(false);
    expect(missRes.damageApplied).toBe(0);
    expect(missRes.damageRolls).toEqual([]);
    expect(missRes.targetHpAfter).toBe(30);

    // 2. Kael rolls natural 20 (auto-hit even vs AC 25!) -> shortbow 1d6+3 becomes 2d6+3
    // Fixed rolls: d20=20, 2d6=[5, 6] => 5 + 6 + 3 = 14 damage
    const critRes = resolveCombatAttack(
      missRes.nextState,
      {
        sceneId: 'escena_01_orilla',
        attackerId: 'pc_kael',
        targetId: 'tank_1',
        attackId: 'shortbow',
      },
      makeFixedContext([20, 5, 6]),
    );
    expect(critRes.ok).toBe(true);
    if (!critRes.ok) return;
    expect(critRes.hit).toBe(true);
    expect(critRes.isCritical).toBe(true);
    expect(critRes.damageExpressionUsed).toBe('2d6+3');
    expect(critRes.damageRolls).toEqual([5, 6]);
    expect(critRes.damageApplied).toBe(14);
    expect(critRes.targetHpBefore).toBe(30);
    expect(critRes.targetHpAfter).toBe(16);

    // 3. Tank attacks Kael (AC 14) with +20 bonus, rolls natural 1 -> auto-miss!
    const nat1Res = resolveCombatAttack(
      critRes.nextState,
      {
        sceneId: 'escena_01_orilla',
        attackerId: 'tank_1',
        targetId: 'pc_kael',
      },
      makeFixedContext([1]),
    );
    expect(nat1Res.ok).toBe(true);
    if (!nat1Res.ok) return;
    expect(nat1Res.hit).toBe(false);
    expect(nat1Res.isCriticalMiss).toBe(true);
    expect(nat1Res.damageApplied).toBe(0);
    expect(nat1Res.nextState.characters.pc_kael!.hp.current).toBe(11);
  });

  it('applies 5e vulnerability (x2 fire) and immunity (0 poison) against necrofago_de_rio', () => {
    const initial = createAguasQuietasInitialState();
    const startRes = startCombat(
      initial,
      { sceneId: 'escena_01_orilla', enemies: [NECROFAGO_ENEMY] },
      makeFixedContext([15, 5]),
    );
    expect(startRes.ok).toBe(true);
    if (!startRes.ok) return;

    // Attack with fire (standard weapon 'torch' -> 1d4 fire, Kael STR +1, PB +2 => +3 attack)
    // d20=12 (+3 = 15 >= AC 12 hit), 1d4=3 raw -> x2 vulnerability = 6 damage!
    const fireHit = resolveCombatAttack(
      startRes.nextState,
      {
        sceneId: 'escena_01_orilla',
        attackerId: 'pc_kael',
        targetId: 'necrofago_1',
        weaponId: 'torch',
      },
      makeFixedContext([12, 3]),
    );
    expect(fireHit.ok).toBe(true);
    if (!fireHit.ok) return;
    expect(fireHit.hit).toBe(true);
    expect(fireHit.damageType).toBe('fire');
    expect(fireHit.rawDamage).toBe(3);
    expect(fireHit.damageRelation).toBe('vulnerable');
    expect(fireHit.damageApplied).toBe(6);
    expect(fireHit.targetHpAfter).toBe(12);

    // Add a poison attack directly onto an ally to verify immunity -> 0 damage
    const stateWithPoisonAlly = startCombat(
      initial,
      {
        sceneId: 'escena_01_orilla',
        enemies: [NECROFAGO_ENEMY],
        allies: [
          {
            id: 'ally_alchemist',
            name: 'Alquimista',
            hp: 10,
            ac: 12,
            dexMod: 1,
            attacks: [
              {
                id: 'vial_veneno',
                nameEs: 'Frasco de veneno',
                attackBonus: 5,
                damageDice: '2d6',
                damageType: 'poison',
              },
            ],
          },
        ],
      },
      makeFixedContext([15, 14, 5]),
    );
    expect(stateWithPoisonAlly.ok).toBe(true);
    if (!stateWithPoisonAlly.ok) return;

    // d20=14 (+5=19 >= 12 hit), 2d6=[4, 5]=9 raw -> immune -> 0 applied!
    const poisonHit = resolveCombatAttack(
      stateWithPoisonAlly.nextState,
      {
        sceneId: 'escena_01_orilla',
        attackerId: 'ally_alchemist',
        targetId: 'necrofago_1',
        attackId: 'vial_veneno',
      },
      makeFixedContext([14, 4, 5]),
    );
    expect(poisonHit.ok).toBe(true);
    if (!poisonHit.ok) return;
    expect(poisonHit.hit).toBe(true);
    expect(poisonHit.rawDamage).toBe(9);
    expect(poisonHit.damageRelation).toBe('immune');
    expect(poisonHit.damageApplied).toBe(0);
    expect(poisonHit.targetHpAfter).toBe(18);
  });

  it('syncs PC HP changes to character sheet, skips defeated combatants on turn advance, increments rounds, and supports full replay + rollback', () => {
    const initial = createAguasQuietasInitialState();
    const events: GameEvent[] = [];

    const weakScout1: CombatEnemyDefinition = {
      ...EXPLORADOR_ENEMY,
      id: 'scout_1',
      name: 'Explorador #1',
      hp: 6,
    };
    const weakScout2: CombatEnemyDefinition = {
      ...EXPLORADOR_ENEMY,
      id: 'scout_2',
      name: 'Explorador #2',
      hp: 8,
    };

    // Initiative rolls: Kael 16 (+3=19), scout_1 12 (+2=14), scout_2 8 (+2=10)
    const startRes = startCombat(
      initial,
      {
        sceneId: 'escena_01_orilla',
        enemies: [weakScout1, weakScout2],
      },
      makeFixedContext([16, 12, 8]),
    );
    expect(startRes.ok).toBe(true);
    if (!startRes.ok) return;
    events.push(startRes.event); // seq 1
    expect(startRes.combat.combatants.map((c) => c.id)).toEqual([
      'pc_kael',
      'scout_1',
      'scout_2',
    ]);

    // seq 2: Kael kills scout_1 (d20=15+5=20 >= 13; 1d6+3 => 4+3=7 >= 6 HP)
    const killScout1 = resolveCombatAttack(
      startRes.nextState,
      {
        sceneId: 'escena_01_orilla',
        attackerId: 'pc_kael',
        targetId: 'scout_1',
        attackId: 'shortbow',
      },
      makeFixedContext([15, 4]),
    );
    expect(killScout1.ok).toBe(true);
    if (!killScout1.ok) return;
    events.push(killScout1.event);
    expect(killScout1.targetDefeated).toBe(true);
    expect(killScout1.targetHpAfter).toBe(0);
    expect(killScout1.allEnemiesDefeated).toBe(false);

    // seq 3: Advance turn from pc_kael (idx 0) -> MUST skip defeated scout_1 (idx 1) and land on scout_2 (idx 2), still Round 1!
    const turnToScout2 = advanceCombatTurn(
      killScout1.nextState,
      { sceneId: 'escena_01_orilla' },
      makeFixedContext([]),
    );
    expect(turnToScout2.ok).toBe(true);
    if (!turnToScout2.ok) return;
    events.push(turnToScout2.event);
    expect(turnToScout2.activeCombatant.id).toBe('scout_2');
    expect(turnToScout2.round).toBe(1);
    expect(turnToScout2.roundAdvanced).toBe(false);

    // seq 4: scout_2 hits Kael (AC 14) with espada_corta (+4, 1d6+2): d20=12 (+4=16 hit), 1d6=3 => 5 dmg
    const hitKael = resolveCombatAttack(
      turnToScout2.nextState,
      {
        sceneId: 'escena_01_orilla',
        attackerId: 'scout_2',
        targetId: 'pc_kael',
        attackId: 'espada_corta',
      },
      makeFixedContext([12, 3]),
    );
    expect(hitKael.ok).toBe(true);
    if (!hitKael.ok) return;
    events.push(hitKael.event);
    expect(hitKael.hit).toBe(true);
    expect(hitKael.damageApplied).toBe(5);
    expect(hitKael.nextState.characters.pc_kael!.hp.current).toBe(6);
    expect(
      hitKael.nextState.combat?.combatants.find((c) => c.id === 'pc_kael')?.hp
        .current,
    ).toBe(6);
    expect(hitKael.event.stateDelta.hpChanges).toEqual([
      { actorId: 'pc_kael', before: 11, after: 6 },
    ]);

    // seq 5: Advance turn from scout_2 (idx 2) -> wraps around to pc_kael (idx 0) and increments Round to 2!
    const turnToRound2 = advanceCombatTurn(
      hitKael.nextState,
      { sceneId: 'escena_01_orilla' },
      makeFixedContext([]),
    );
    expect(turnToRound2.ok).toBe(true);
    if (!turnToRound2.ok) return;
    events.push(turnToRound2.event);
    expect(turnToRound2.activeCombatant.id).toBe('pc_kael');
    expect(turnToRound2.round).toBe(2);
    expect(turnToRound2.roundAdvanced).toBe(true);

    // seq 6: Kael finishes scout_2 (d20=14+5=19, 1d6+3 => 6+3=9 >= 8 HP)
    const killScout2 = resolveCombatAttack(
      turnToRound2.nextState,
      {
        sceneId: 'escena_01_orilla',
        attackerId: 'pc_kael',
        targetId: 'scout_2',
      },
      makeFixedContext([14, 6]),
    );
    expect(killScout2.ok).toBe(true);
    if (!killScout2.ok) return;
    events.push(killScout2.event);
    expect(killScout2.targetDefeated).toBe(true);
    expect(killScout2.allEnemiesDefeated).toBe(true);

    // seq 7: End combat with victory
    const ended = endCombat(
      killScout2.nextState,
      {
        sceneId: 'escena_01_orilla',
        outcome: 'victory',
        reason: 'Todos los exploradores cayeron en la orilla.',
      },
      makeFixedContext([]),
    );
    expect(ended.ok).toBe(true);
    if (!ended.ok) return;
    events.push(ended.event);
    expect(ended.nextState.combat).toBeNull();
    expect(ended.nextState.flags['combat:lastOutcome']).toBe('victory');
    expect(ended.roundsElapsed).toBe(2);

    // Deterministic replay parity
    expect(reduceEvents(initial, events)).toEqual(ended.nextState);

    // Rollback to seq 3 (mid-combat, before scout_2 hit Kael):
    // Combat must be active again at Round 1, scout_2's turn, Kael back to 11/11 HP, scout_1 still defeated!
    const rbMid = rollbackToSeq(initial, events, 3, {
      createId: () => 'rb_1',
      now: () => '2026-11-19T12:10:00.000Z',
      actor: 'pc_kael',
    });
    expect(rbMid.ok).toBe(true);
    if (!rbMid.ok) return;
    expect(rbMid.state.combat?.active).toBe(true);
    expect(rbMid.state.combat?.round).toBe(1);
    expect(rbMid.state.combat?.turnIndex).toBe(2);
    expect(rbMid.state.characters.pc_kael!.hp.current).toBe(11);
    expect(
      rbMid.state.combat?.combatants.find((c) => c.id === 'pc_kael')?.hp
        .current,
    ).toBe(11);
    expect(
      rbMid.state.combat?.combatants.find((c) => c.id === 'scout_1')?.defeated,
    ).toBe(true);
    expect(rbMid.state.flags['combat:lastOutcome']).toBeUndefined();

    // Rollback to seq 0 (before combat even started)
    const rbZero = rollbackToSeq(initial, rbMid.events, 0, {
      createId: () => 'rb_2',
      now: () => '2026-11-19T12:11:00.000Z',
      actor: 'pc_kael',
    });
    expect(rbZero.ok).toBe(true);
    if (!rbZero.ok) return;
    expect(rbZero.state).toEqual(initial);
  });

  it('rejects strict schema violations and invalid combat operations without mutating state', () => {
    const initial = createAguasQuietasInitialState();
    const ctx = makeContext(7);

    // Attack without active combat
    const noCombatAtk = resolveCombatAttack(
      initial,
      {
        sceneId: 'escena_01_orilla',
        attackerId: 'pc_kael',
        targetId: 'explorador_1',
      },
      ctx,
    );
    expect(noCombatAtk.ok).toBe(false);
    if (!noCombatAtk.ok) expect(noCombatAtk.code).toBe('NO_ACTIVE_COMBAT');

    const started = startCombat(
      initial,
      { sceneId: 'escena_01_orilla', enemies: [EXPLORADOR_ENEMY] },
      ctx,
    );
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    // LLM sneaking damage/roll numbers must be rejected by strict schema
    const injectedDamage = resolveCombatAttack(
      started.nextState,
      {
        sceneId: 'escena_01_orilla',
        attackerId: 'pc_kael',
        targetId: 'explorador_1',
        damage: 99,
      },
      ctx,
    );
    expect(injectedDamage.ok).toBe(false);
    if (!injectedDamage.ok) expect(injectedDamage.code).toBe('INVALID_INPUT');

    const injectedRoll = resolveCombatAttack(
      started.nextState,
      {
        sceneId: 'escena_01_orilla',
        attackerId: 'pc_kael',
        targetId: 'explorador_1',
        attackTotal: 25,
      },
      ctx,
    );
    expect(injectedRoll.ok).toBe(false);
    if (!injectedRoll.ok) expect(injectedRoll.code).toBe('INVALID_INPUT');

    // Self-attack rejected
    const selfAtk = resolveCombatAttack(
      started.nextState,
      {
        sceneId: 'escena_01_orilla',
        attackerId: 'pc_kael',
        targetId: 'pc_kael',
      },
      ctx,
    );
    expect(selfAtk.ok).toBe(false);
    if (!selfAtk.ok) expect(selfAtk.code).toBe('INVALID_TARGET');
  });
});
