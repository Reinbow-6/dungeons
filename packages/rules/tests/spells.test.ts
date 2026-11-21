import { describe, expect, it } from 'vitest';
import {
  createAguasQuietasInitialState,
  createDefaultAuthority,
  getSpellcastingStats,
  reduceEvents,
  resolveCastSpell,
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
    now: () => '2026-11-21T18:00:00.000Z',
  };
}

function makeClericState(ruleset: '5e-full' | '5e-lite' = '5e-full'): GameState {
  const base = createAguasQuietasInitialState({
    campaignId: 'camp_magic',
    sessionId: 'sess_magic',
    ruleset,
  });

  const seraphina: Character = {
    id: 'pc_seraphina',
    name: 'Seraphina Voss',
    species: 'Humana',
    className: 'Clériga',
    level: 1,
    abilities: { str: 12, dex: 10, con: 14, int: 10, wis: 16, cha: 14 },
    skillProficiencies: {
      insight: 'proficient',
      medicine: 'proficient',
      persuasion: 'proficient',
      religion: 'proficient',
    },
    savingThrowProficiencies: ['wis', 'cha'],
    hp: { current: 10, max: 10, temp: 0 },
    ac: 16,
    speed: 30,
    conditions: [],
    exhaustionLevel: 0,
    inventory: [
      { itemId: 'mace', name: 'Maza', quantity: 1 },
      { itemId: 'potion-of-healing', name: 'Poción de curación', quantity: 1 },
    ],
    spellSlots: { '1': { current: 2, max: 2 } },
    spellcastingAbility: 'wis',
    knownSpells: [
      'sacred-flame',
      'guidance',
      'guiding-bolt',
      'cure-wounds',
      'healing-word',
      'bless',
      'burning-hands',
      'magic-missile',
    ],
    hitDice: { die: 'd8', current: 1, max: 1 },
    concentratingOn: null,
    authority: createDefaultAuthority('digital'),
    rollAuthority: 'engine-rolled',
  };

  return {
    ...base,
    characters: {
      pc_seraphina: seraphina,
      pc_kael: base.characters.pc_kael!,
    },
  };
}

const SCOUT_ENEMY: CombatEnemyDefinition = {
  id: 'enemy_scout_1',
  creatureId: 'explorador_espesura',
  name: 'Explorador de la Espesura',
  ac: 13,
  hp: 20,
  dexMod: 2,
  attacks: [
    {
      id: 'shortsword',
      nameEs: 'Espada corta',
      attackBonus: 4,
      damageDice: '1d6+2',
      damageType: 'piercing',
    },
  ],
  vulnerabilities: [],
  immunities: [],
};

describe('5e-full spellcasting (resolveCastSpell)', () => {
  it('computes spell attack bonus and save DC deterministically', () => {
    const state = makeClericState();
    const stats = getSpellcastingStats(state.characters.pc_seraphina!);
    expect(stats).toEqual({
      ability: 'wis',
      abilityMod: 3,
      proficiencyBonus: 2,
      spellAttackBonus: 5,
      spellSaveDc: 13,
    });
    expect(getSpellcastingStats(state.characters.pc_kael!)).toBeNull();
  });

  it('casts a cantrip without consuming spell slots and handles saving throws', () => {
    const initial = makeClericState();
    const startRes = startCombat(
      initial,
      { sceneId: initial.sceneId, enemies: [SCOUT_ENEMY] },
      makeFixedCtx([15, 10, 8]),
    );
    expect(startRes.ok).toBe(true);
    if (!startRes.ok) return;

    const enemyId = startRes.combat.combatants.find((c) => c.kind === 'enemy')!.id;
    // Target save d20=5 (< DC 13 -> fails), damage 1d8=6
    const castRes = resolveCastSpell(
      startRes.nextState,
      {
        sceneId: initial.sceneId,
        casterId: 'pc_seraphina',
        spellId: 'sacred-flame',
        targetId: enemyId,
      },
      makeFixedCtx([5, 6]),
    );

    expect(castRes.ok).toBe(true);
    if (!castRes.ok) return;
    expect(castRes.slotLevelUsed).toBe(0);
    expect(castRes.savingThrow?.saved).toBe(false);
    expect(castRes.damageApplied).toBe(6);
    expect(castRes.targetHpAfter).toBe(14);
    expect(castRes.nextState.characters.pc_seraphina?.spellSlots['1']?.current).toBe(2);
  });

  it('spends spell slot, doubles dice on nat 20 crit, rejects when slots are exhausted, and restores exact slots on rollback', () => {
    const initial = makeClericState();
    const events: GameEvent[] = [];

    const startRes = startCombat(
      initial,
      { sceneId: initial.sceneId, enemies: [{ ...SCOUT_ENEMY, hp: 60 }] },
      makeFixedCtx([15, 10, 8]),
    );
    expect(startRes.ok).toBe(true);
    if (!startRes.ok) return;
    events.push(startRes.event);
    const enemyId = startRes.combat.combatants.find((c) => c.kind === 'enemy')!.id;

    // 1st cast: guiding-bolt nat 20 crit -> 8d6 (all 3s = 24)
    const cast1 = resolveCastSpell(
      startRes.nextState,
      {
        sceneId: initial.sceneId,
        casterId: 'pc_seraphina',
        spellId: 'guiding-bolt',
        targetId: enemyId,
      },
      makeFixedCtx([20, 3, 3, 3, 3, 3, 3, 3, 3]),
    );
    expect(cast1.ok).toBe(true);
    if (!cast1.ok) return;
    events.push(cast1.event);

    expect(cast1.attackRoll?.isCritical).toBe(true);
    expect(cast1.damageApplied).toBe(24);
    expect(cast1.slotPoolAfter).toEqual({ current: 1, max: 2 });
    expect(cast1.nextState.characters.pc_seraphina?.spellSlots['1']?.current).toBe(1);

    // 2nd cast: magic-missile auto-hit (3 darts: 4+1, 2+1, 1+1 = 10 force)
    const cast2 = resolveCastSpell(
      cast1.nextState,
      {
        sceneId: initial.sceneId,
        casterId: 'pc_seraphina',
        spellId: 'magic-missile',
        targetId: enemyId,
      },
      makeFixedCtx([4, 2, 1]),
    );
    expect(cast2.ok).toBe(true);
    if (!cast2.ok) return;
    events.push(cast2.event);

    expect(cast2.damageApplied).toBe(10);
    expect(cast2.nextState.characters.pc_seraphina?.spellSlots['1']?.current).toBe(0);

    // 3rd cast: no level-1 slots remaining -> NO_SPELL_SLOTS
    const cast3 = resolveCastSpell(
      cast2.nextState,
      {
        sceneId: initial.sceneId,
        casterId: 'pc_seraphina',
        spellId: 'guiding-bolt',
        targetId: enemyId,
      },
      makeFixedCtx([15, 4, 4, 4, 4]),
    );
    expect(cast3.ok).toBe(false);
    if (!cast3.ok) {
      expect(cast3.code).toBe('NO_SPELL_SLOTS');
    }

    // Rollback to seq 1 (combat started, before casts) restores 2/2 slots and enemy 60 HP
    const rb = rollbackToSeq(initial, events, 1, {
      createId: () => 'evt_rb',
      now: () => '2026-11-21T18:05:00.000Z',
    });
    expect(rb.ok).toBe(true);
    if (!rb.ok) return;
    expect(rb.state.characters.pc_seraphina?.spellSlots['1']?.current).toBe(2);
    const enemyAfterRb = rb.state.combat?.combatants.find((c) => c.id === enemyId);
    expect(enemyAfterRb?.hp.current).toBe(60);
    expect(reduceEvents(initial, rb.events).characters.pc_seraphina?.spellSlots['1']?.current).toBe(2);
  });

  it('applies half damage on successful save for burning-hands and replaces concentration cleanly', () => {
    const initial = makeClericState();
    const startRes = startCombat(
      initial,
      { sceneId: initial.sceneId, enemies: [SCOUT_ENEMY] },
      makeFixedCtx([15, 10, 8]),
    );
    expect(startRes.ok).toBe(true);
    if (!startRes.ok) return;
    const enemyId = startRes.combat.combatants.find((c) => c.kind === 'enemy')!.id;

    // Cast bless (concentration)
    const bless = resolveCastSpell(
      startRes.nextState,
      { sceneId: initial.sceneId, casterId: 'pc_seraphina', spellId: 'bless' },
      makeFixedCtx([]),
    );
    expect(bless.ok).toBe(true);
    if (!bless.ok) return;
    expect(bless.nextState.characters.pc_seraphina?.concentratingOn).toBe('Bendición');

    // Cast guidance (replaces concentration)
    const guidance = resolveCastSpell(
      bless.nextState,
      { sceneId: initial.sceneId, casterId: 'pc_seraphina', spellId: 'guidance' },
      makeFixedCtx([]),
    );
    expect(guidance.ok).toBe(true);
    if (!guidance.ok) return;
    expect(guidance.nextState.characters.pc_seraphina?.concentratingOn).toBe('Guía');

    // Cast burning-hands: target rolls 15 >= DC 13 (saves), 3d6 = 5+4+2 = 11 -> half = 5
    const bh = resolveCastSpell(
      guidance.nextState,
      {
        sceneId: initial.sceneId,
        casterId: 'pc_seraphina',
        spellId: 'burning-hands',
        targetId: enemyId,
      },
      makeFixedCtx([15, 5, 4, 2]),
    );
    expect(bh.ok).toBe(true);
    if (!bh.ok) return;
    expect(bh.savingThrow?.saved).toBe(true);
    expect(bh.damageApplied).toBe(5);
    expect(bh.targetHpAfter).toBe(15);
  });

  it('revives a 0-HP unconscious PC with cure-wounds and clears deathSaves', () => {
    const initial = makeClericState();
    const downedKael: Character = {
      ...initial.characters.pc_kael!,
      hp: { current: 0, max: 11, temp: 0 },
      conditions: ['unconscious'],
      deathSaves: { successes: 1, failures: 2, stable: false },
    };
    const state: GameState = {
      ...initial,
      characters: {
        ...initial.characters,
        pc_kael: downedKael,
      },
    };

    // cure-wounds: 2d8 + 3 -> rolls 4 + 3 + 3 = 10 HP
    const res = resolveCastSpell(
      state,
      {
        sceneId: state.sceneId,
        casterId: 'pc_seraphina',
        spellId: 'cure-wounds',
        targetId: 'pc_kael',
      },
      makeFixedCtx([4, 3]),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.healingApplied).toBe(10);
    expect(res.nextState.characters.pc_kael?.hp.current).toBe(10);
    expect(res.nextState.characters.pc_kael?.conditions).not.toContain('unconscious');
    expect(res.nextState.characters.pc_kael?.deathSaves).toEqual({
      successes: 0,
      failures: 0,
      stable: false,
    });
  });
});
