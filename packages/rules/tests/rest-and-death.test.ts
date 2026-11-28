import { describe, expect, it } from 'vitest';
import {
  advanceCombatTurn,
  createAguasQuietasInitialState,
  createDefaultAuthority,
  reduceEvents,
  resolveCastSpell,
  resolveCombatAttack,
  resolveDeathSave,
  resolveHeal,
  resolveTakeRest,
  rollbackToSeq,
  startCombat,
  type Character,
  type CombatEnemyDefinition,
  type GameEvent,
  type GameState,
  type Rng,
} from '../src/index.js';

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

function makeFixedCtx(sequence: number[]) {
  let counter = 0;
  return {
    rng: makeFixedRng(sequence),
    createId: () => `evt_${++counter}`,
    now: () => '2026-11-21T18:10:00.000Z',
  };
}

function makeFullState(overrides?: Partial<Character>): GameState {
  const base = createAguasQuietasInitialState({
    campaignId: 'camp_rest',
    sessionId: 'sess_rest',
    ruleset: '5e-full',
  });
  const pc: Character = {
    ...base.characters.pc_kael!,
    hp: { current: 4, max: 11, temp: 2 },
    exhaustionLevel: 2,
    conditions: ['exhaustion'],
    spellSlots: { '1': { current: 0, max: 2 } },
    hitDice: { die: 'd10', current: 1, max: 1 },
    inventory: [
      ...base.characters.pc_kael!.inventory,
      { itemId: 'potion-of-healing', name: 'Poción de curación', quantity: 1 },
    ],
    concentratingOn: 'Bendición',
    authority: createDefaultAuthority('digital'),
    ...overrides,
  };
  return {
    ...base,
    characters: { pc_kael: pc },
  };
}

const STRONG_ENEMY: CombatEnemyDefinition = {
  id: 'enemy_ghoul_1',
  creatureId: 'necrofago_de_rio',
  name: 'Necrófago de río',
  ac: 12,
  hp: 22,
  dexMod: 2,
  attacks: [
    {
      id: 'claw',
      nameEs: 'Garras',
      attackBonus: 6,
      damageDice: '2d6+4',
      damageType: 'slashing',
    },
  ],
  vulnerabilities: [],
  immunities: [],
};

describe('5e-full rests (resolveTakeRest)', () => {
  it('blocks resting during active combat', () => {
    const state = makeFullState();
    const combat = startCombat(
      state,
      { sceneId: state.sceneId, enemies: [STRONG_ENEMY] },
      makeFixedCtx([12, 10]),
    );
    expect(combat.ok).toBe(true);
    if (!combat.ok) return;

    const rest = resolveTakeRest(
      combat.nextState,
      { sceneId: state.sceneId, actorId: 'pc_kael', restType: 'short' },
      makeFixedCtx([6]),
    );
    expect(rest.ok).toBe(false);
    if (!rest.ok) {
      expect(rest.code).toBe('IN_COMBAT');
    }
  });

  it('spends hit dice on short rest and restores HP + slots + hit dice + exhaustion -1 on long rest, cleanly reversible via rollback', () => {
    const initial = makeFullState();
    const events: GameEvent[] = [];

    // Short rest: 1d10 = 5 + CON(+1) = 6 HP healed -> 4 + 6 = 10/11 HP, hitDice 0/1
    const shortRes = resolveTakeRest(
      initial,
      { sceneId: initial.sceneId, actorId: 'pc_kael', restType: 'short', hitDiceToSpend: 1 },
      makeFixedCtx([5]),
    );
    expect(shortRes.ok).toBe(true);
    if (!shortRes.ok) return;
    events.push(shortRes.event);

    expect(shortRes.hpHealed).toBe(6);
    expect(shortRes.nextState.characters.pc_kael?.hp.current).toBe(10);
    expect(shortRes.nextState.characters.pc_kael?.hitDice?.current).toBe(0);
    expect(shortRes.nextState.characters.pc_kael?.spellSlots['1']?.current).toBe(0);

    // Long rest: restores 11/11 HP, 0 temp HP, 2/2 slots, 1/1 hit dice, exhaustion 2 -> 1, clears concentration
    const longRes = resolveTakeRest(
      shortRes.nextState,
      { sceneId: initial.sceneId, actorId: 'pc_kael', restType: 'long' },
      makeFixedCtx([]),
    );
    expect(longRes.ok).toBe(true);
    if (!longRes.ok) return;
    events.push(longRes.event);

    const pcAfterLong = longRes.nextState.characters.pc_kael!;
    expect(pcAfterLong.hp).toEqual({ current: 11, max: 11, temp: 0 });
    expect(pcAfterLong.spellSlots['1']).toEqual({ current: 2, max: 2 });
    expect(pcAfterLong.hitDice).toEqual({ die: 'd10', current: 1, max: 1 });
    expect(pcAfterLong.exhaustionLevel).toBe(1);
    expect(pcAfterLong.concentratingOn).toBeNull();

    // Rollback to seq 0 restores injured/exhausted state identically
    const rb = rollbackToSeq(initial, events, 0, {
      createId: () => 'evt_rb',
      now: () => '2026-11-21T18:15:00.000Z',
    });
    expect(rb.ok).toBe(true);
    if (!rb.ok) return;
    expect(rb.state.characters.pc_kael?.hp).toEqual({ current: 4, max: 11, temp: 2 });
    expect(rb.state.characters.pc_kael?.hitDice?.current).toBe(1);
    expect(rb.state.characters.pc_kael?.spellSlots['1']?.current).toBe(0);
    expect(rb.state.characters.pc_kael?.exhaustionLevel).toBe(2);
    expect(reduceEvents(initial, rb.events).characters.pc_kael?.hp.current).toBe(4);
  });
});

describe('5e-full 0 HP, death saves (resolveDeathSave) and deterministic healing (resolveHeal)', () => {
  it('puts a 5e-full PC into unconscious/dying state at 0 HP and keeps their combat turn for death saves', () => {
    const state = makeFullState({ hp: { current: 5, max: 11, temp: 0 }, exhaustionLevel: 0, conditions: [] });
    const started = startCombat(
      state,
      { sceneId: state.sceneId, enemies: [STRONG_ENEMY] },
      makeFixedCtx([5, 18]), // enemy goes first (20), kael second (8)
    );
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const enemyId = started.combat.combatants.find((c) => c.kind === 'enemy')!.id;

    // Enemy hits Kael for 6 + 6 + 4 = 16 -> drops to 0 HP
    const atk = resolveCombatAttack(
      started.nextState,
      { sceneId: state.sceneId, attackerId: enemyId, targetId: 'pc_kael' },
      makeFixedCtx([18, 6, 6]),
    );
    expect(atk.ok).toBe(true);
    if (!atk.ok) return;

    const pcDown = atk.nextState.characters.pc_kael!;
    expect(pcDown.hp.current).toBe(0);
    expect(pcDown.conditions).toContain('unconscious');
    expect(pcDown.deathSaves).toEqual({ successes: 0, failures: 0, stable: false });
    // Still gets their turn in 5e-full!
    const nextTurn = advanceCombatTurn(
      atk.nextState,
      { sceneId: state.sceneId },
      makeFixedCtx([]),
    );
    expect(nextTurn.ok).toBe(true);
    if (!nextTurn.ok) return;
    expect(nextTurn.activeCombatant.id).toBe('pc_kael');

    // Nat 20 death save revives with 1 HP and removes unconscious
    const nat20 = resolveDeathSave(
      nextTurn.nextState,
      { sceneId: state.sceneId, actorId: 'pc_kael' },
      makeFixedCtx([20]),
    );
    expect(nat20.ok).toBe(true);
    if (!nat20.ok) return;
    expect(nat20.outcome).toBe('critical_recovery');
    expect(nat20.nextState.characters.pc_kael?.hp.current).toBe(1);
    expect(nat20.nextState.characters.pc_kael?.conditions).not.toContain('unconscious');
  });

  it('handles death save failures (nat 1 = 2 failures, 3rd failure = dead) and stabilization', () => {
    const downState = makeFullState({
      hp: { current: 0, max: 11, temp: 0 },
      conditions: ['unconscious'],
      exhaustionLevel: 0,
      deathSaves: { successes: 0, failures: 0, stable: false },
    });

    // Nat 1 -> 2 failures
    const f1 = resolveDeathSave(
      downState,
      { sceneId: downState.sceneId, actorId: 'pc_kael' },
      makeFixedCtx([1]),
    );
    expect(f1.ok).toBe(true);
    if (!f1.ok) return;
    expect(f1.outcome).toBe('critical_failure');
    expect(f1.deathSavesAfter.failures).toBe(2);

    // Roll 5 -> 3rd failure -> dead
    const f2 = resolveDeathSave(
      f1.nextState,
      { sceneId: downState.sceneId, actorId: 'pc_kael' },
      makeFixedCtx([5]),
    );
    expect(f2.ok).toBe(true);
    if (!f2.ok) return;
    expect(f2.outcome).toBe('dead');
    expect(f2.nextState.flags['pc:pc_kael:dead']).toBe(true);

    // Stabilizing path: 3 successes >= 10
    const s1 = resolveDeathSave(downState, { sceneId: downState.sceneId, actorId: 'pc_kael' }, makeFixedCtx([10]));
    expect(s1.ok).toBe(true);
    if (!s1.ok) return;
    const s2 = resolveDeathSave(s1.nextState, { sceneId: downState.sceneId, actorId: 'pc_kael' }, makeFixedCtx([14]));
    expect(s2.ok).toBe(true);
    if (!s2.ok) return;
    const s3 = resolveDeathSave(s2.nextState, { sceneId: downState.sceneId, actorId: 'pc_kael' }, makeFixedCtx([12]));
    expect(s3.ok).toBe(true);
    if (!s3.ok) return;
    expect(s3.outcome).toBe('stabilized');
    expect(s3.deathSavesAfter.stable).toBe(true);
  });

  it('heals via potion (consuming inventory) and stabilizes via Medicine DC 10', () => {
    const base = makeFullState({
      hp: { current: 0, max: 11, temp: 0 },
      conditions: ['unconscious'],
      exhaustionLevel: 0,
      deathSaves: { successes: 0, failures: 1, stable: false },
    });

    // Medicine stabilize (d20=12 + WIS(+2) = 14 >= 10)
    const medRes = resolveHeal(
      base,
      {
        sceneId: base.sceneId,
        actorId: 'pc_kael',
        targetId: 'pc_kael',
        source: 'medicine_stabilize',
        reason: 'Primeros auxilios',
      },
      makeFixedCtx([12]),
    );
    expect(medRes.ok).toBe(true);
    if (!medRes.ok) return;
    expect(medRes.stabilized).toBe(true);
    expect(medRes.nextState.characters.pc_kael?.deathSaves?.stable).toBe(true);

    // Potion healing: 2d4 + 2 (rolls 3, 4 -> 9 HP), consumes potion, clears unconscious & resets deathSaves
    const potRes = resolveHeal(
      medRes.nextState,
      {
        sceneId: base.sceneId,
        actorId: 'pc_kael',
        targetId: 'pc_kael',
        source: 'potion',
        reason: 'Poción de curación tras combate',
      },
      makeFixedCtx([3, 4]),
    );
    expect(potRes.ok).toBe(true);
    if (!potRes.ok) return;
    expect(potRes.hpHealed).toBe(9);
    expect(potRes.nextState.characters.pc_kael?.hp.current).toBe(9);
    expect(potRes.nextState.characters.pc_kael?.conditions).not.toContain('unconscious');
    expect(
      potRes.nextState.characters.pc_kael?.inventory.find((i) => i.itemId === 'potion-of-healing'),
    ).toBeUndefined();
  });

  it('blocks healing/spells on dead PCs (3 death save failures) and skips them during rests', () => {
    const deadPc = makeFullState({
      hp: { current: 0, max: 11, temp: 0 },
      conditions: ['unconscious'],
      exhaustionLevel: 0,
      deathSaves: { successes: 1, failures: 3, stable: false },
      spellSlots: { '1': { current: 1, max: 2 } },
      knownSpells: ['cure-wounds'],
    });
    const cleric: Character = {
      ...deadPc.characters.pc_kael!,
      id: 'pc_cleric',
      name: 'Seraphina',
      hp: { current: 8, max: 10, temp: 0 },
      conditions: [],
      deathSaves: undefined,
      spellcastingAbility: 'wis',
      spellSlots: { '1': { current: 2, max: 2 } },
      knownSpells: ['cure-wounds'],
    };
    const state: GameState = {
      ...deadPc,
      characters: {
        pc_kael: deadPc.characters.pc_kael!,
        pc_cleric: cleric,
      },
    };

    const healPotion = resolveHeal(
      state,
      {
        sceneId: state.sceneId,
        actorId: 'pc_cleric',
        targetId: 'pc_kael',
        source: 'potion',
        reason: 'Intentar revivir con poción',
      },
      makeFixedCtx([4, 4]),
    );
    expect(healPotion.ok).toBe(false);
    if (!healPotion.ok) expect(healPotion.code).toBe('ALREADY_DEAD');

    const castHeal = resolveCastSpell(
      state,
      {
        sceneId: state.sceneId,
        casterId: 'pc_cleric',
        spellId: 'cure-wounds',
        targetId: 'pc_kael',
      },
      makeFixedCtx([6]),
    );
    expect(castHeal.ok).toBe(false);
    if (!castHeal.ok) expect(castHeal.code).toBe('ALREADY_DEAD');

    const longRest = resolveTakeRest(
      state,
      { sceneId: state.sceneId, actorId: 'pc_kael', restType: 'long' },
      makeFixedCtx([]),
    );
    expect(longRest.ok).toBe(true);
    if (!longRest.ok) return;
    expect(longRest.nextState.characters.pc_kael?.hp.current).toBe(0);
    expect(longRest.nextState.characters.pc_kael?.deathSaves?.failures).toBe(3);
  });
});
