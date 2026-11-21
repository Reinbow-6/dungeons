import { describe, expect, it } from 'vitest';
import {
  createAguasQuietasInitialState,
  createRng,
  declareCheck,
  resolveInvestigate,
  transitionScene,
  type GameEvent,
} from '../src/index.js';

function makeContext(seed = 2026) {
  let i = 0;
  return {
    rng: createRng(seed),
    createId: () => `sp6_${++i}`,
    now: () => '2026-11-18T20:20:00.000Z',
  };
}

describe('Spike 006 (trust-boundary): declare_check validation & state protection', () => {
  it('rejects impossible die values ([21], [0], [-3]) and wrong die count without mutating state', () => {
    const state = createAguasQuietasInitialState({ hybrid: true });
    const snapshot = structuredClone(state);
    const ctx = makeContext();
    const events: GameEvent[] = [];

    const badCases = [
      { dieResults: [21], declaredTotal: 25 },
      { dieResults: [0], declaredTotal: 4 },
      { dieResults: [-3], declaredTotal: 1 },
      { mode: 'normal' as const, dieResults: [10, 12], declaredTotal: 16 },
      { mode: 'advantage' as const, dieResults: [10], declaredTotal: 14 },
    ];

    for (const c of badCases) {
      const res = declareCheck(
        state,
        {
          sceneId: 'escena_01_orilla',
          actorId: 'pc_kael',
          skill: 'investigation',
          dc: 15,
          ...c,
        },
        ctx,
      );

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe('IMPOSSIBLE_DIE');
        expect(res.messageEs.length).toBeGreaterThan(0);
        expect(res.expectedRange).toEqual({ min: 1, max: 20 });
      }
    }

    expect(state).toEqual(snapshot);
    expect(events).toHaveLength(0);
  });

  it('rejects incoherent total vs mirrored/engine sheet modifier without mutating state', () => {
    const state = createAguasQuietasInitialState({ hybrid: true });
    const snapshot = structuredClone(state);
    const ctx = makeContext();

    // pc_kael investigation mod is +4; die 10 => expected 14, not 19
    const res = declareCheck(
      state,
      {
        sceneId: 'escena_01_orilla',
        actorId: 'pc_kael',
        skill: 'investigation',
        dc: 15,
        dieResults: [10],
        declaredTotal: 19,
      },
      ctx,
    );

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe('INCOHERENT_TOTAL');
      expect(res.messageEs.length).toBeGreaterThan(0);
      expect(res.expectedRange).toEqual({ min: 5, max: 24 });
    }
    expect(state).toEqual(snapshot);
  });

  it('rejects physically impossible totals even when sheet field authority is player', () => {
    const state = createAguasQuietasInitialState({ hybrid: true });
    state.characters.pc_kael!.authority.skills = 'player';
    const snapshot = structuredClone(state);
    const ctx = makeContext();

    for (const badTotal of [50, -15]) {
      const res = declareCheck(
        state,
        {
          sceneId: 'escena_01_orilla',
          actorId: 'pc_kael',
          skill: 'investigation',
          dc: 15,
          dieResults: [5],
          declaredTotal: badTotal,
        },
        ctx,
      );

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe('INCOHERENT_TOTAL');
        expect(res.messageEs.length).toBeGreaterThan(0);
        expect(res.expectedRange).toEqual({ min: 0, max: 19 });
      }
    }

    expect(state).toEqual(snapshot);
  });

  it('accepts valid player-declared check, updates state, and records provenance', () => {
    const state = createAguasQuietasInitialState({ hybrid: true });
    const ctx = makeContext();

    const res = declareCheck(
      state,
      {
        sceneId: 'escena_01_orilla',
        actorId: 'pc_kael',
        skill: 'investigation',
        dc: 15,
        dieResults: [14],
        declaredTotal: 18,
      },
      ctx,
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.success).toBe(true);
    expect(res.margin).toBe(3);
    expect(res.naturalRoll).toBe(14);
    expect(res.expectedModifier).toBe(4);
    expect(res.event.source).toBe('player-declared');
    expect(res.event.declaredTotal).toBe(18);
    expect(res.event.dieResults).toEqual([14]);
    expect(res.nextState.lastSeq).toBe(1);
    expect(state.lastSeq).toBe(0);
  });

  it('rejects incoherent declared roll inside resolveInvestigate and unlocks 0 clues', () => {
    const initial = createAguasQuietasInitialState({ hybrid: true });
    const ctx = makeContext();

    const s3 = transitionScene(
      initial,
      { targetSceneId: 'escena_03_parlamento', reason: 'Parlamento' },
      ctx,
    );
    if (!s3.ok) throw new Error(s3.messageEs);
    const s4 = transitionScene(
      s3.nextState,
      { targetSceneId: 'escena_04_campamento', reason: 'Campamento' },
      ctx,
    );
    if (!s4.ok) throw new Error(s4.messageEs);

    const campSnapshot = structuredClone(s4.nextState);
    const badInvestigate = resolveInvestigate(
      s4.nextState,
      {
        sceneId: 'escena_04_campamento',
        actorId: 'pc_kael',
        declared: { dieResults: [4], declaredTotal: 19 },
      },
      ctx,
    );

    expect(badInvestigate.ok).toBe(false);
    if (!badInvestigate.ok) {
      expect(badInvestigate.code).toBe('INCOHERENT_TOTAL');
      expect(badInvestigate.expectedRange).toEqual({ min: 5, max: 24 });
    }
    expect(s4.nextState).toEqual(campSnapshot);
    expect(s4.nextState.unlockedClues.escena_04_campamento ?? []).toHaveLength(0);
  });

  it('auto-computes total from sheet modifier when declaredTotal is omitted', () => {
    const state = createAguasQuietasInitialState({ hybrid: true });
    const snapshot = structuredClone(state);
    const ctx = makeContext();

    // pc_kael investigation mod is +4; die 14 => auto total 18 vs DC 15 (margin 3)
    const res = declareCheck(
      state,
      {
        sceneId: 'escena_01_orilla',
        actorId: 'pc_kael',
        skill: 'investigation',
        dc: 15,
        dieResults: [14],
      },
      ctx,
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.total).toBe(18);
    expect(res.declaredTotal).toBe(18);
    expect(res.success).toBe(true);
    expect(res.margin).toBe(3);
    expect(res.naturalRoll).toBe(14);
    expect(res.expectedModifier).toBe(4);
    expect(res.event.source).toBe('player-declared');
    expect(res.event.declaredTotal).toBe(18);
    expect(res.event.dieResults).toEqual([14]);
    expect(res.event.payload).toMatchObject({
      total: 18,
      success: true,
      margin: 3,
    });
    expect(res.nextState.lastSeq).toBe(1);
    expect(state).toEqual(snapshot);
  });

  it('auto-computes total with advantage and disadvantage when declaredTotal is omitted', () => {
    const state = createAguasQuietasInitialState({ hybrid: true });
    const ctx = makeContext();

    // Advantage: picks max(6, 17) = 17; +4 mod => 21 vs DC 15 (margin +6)
    const adv = declareCheck(
      state,
      {
        sceneId: 'escena_01_orilla',
        actorId: 'pc_kael',
        skill: 'investigation',
        dc: 15,
        mode: 'advantage',
        dieResults: [6, 17],
      },
      ctx,
    );

    expect(adv.ok).toBe(true);
    if (!adv.ok) return;

    expect(adv.naturalRoll).toBe(17);
    expect(adv.expectedModifier).toBe(4);
    expect(adv.total).toBe(21);
    expect(adv.declaredTotal).toBe(21);
    expect(adv.success).toBe(true);
    expect(adv.margin).toBe(6);
    expect(adv.event.declaredTotal).toBe(21);
    expect(adv.event.source).toBe('player-declared');
    expect(adv.event.dieResults).toEqual([6, 17]);

    // Disadvantage: picks min(6, 17) = 6; +4 mod => 10 vs DC 15 (margin -5)
    const dis = declareCheck(
      state,
      {
        sceneId: 'escena_01_orilla',
        actorId: 'pc_kael',
        skill: 'investigation',
        dc: 15,
        mode: 'disadvantage',
        dieResults: [6, 17],
      },
      ctx,
    );

    expect(dis.ok).toBe(true);
    if (!dis.ok) return;

    expect(dis.naturalRoll).toBe(6);
    expect(dis.expectedModifier).toBe(4);
    expect(dis.total).toBe(10);
    expect(dis.declaredTotal).toBe(10);
    expect(dis.success).toBe(false);
    expect(dis.margin).toBe(-5);
    expect(dis.event.declaredTotal).toBe(10);
    expect(dis.event.source).toBe('player-declared');
    expect(dis.event.dieResults).toEqual([6, 17]);
  });

  it('still rejects impossible dice and wrong die count with IMPOSSIBLE_DIE when declaredTotal is omitted', () => {
    const state = createAguasQuietasInitialState({ hybrid: true });
    const snapshot = structuredClone(state);
    const ctx = makeContext();

    const badCases = [
      { dieResults: [21] },
      { dieResults: [0] },
      { dieResults: [-3] },
      { mode: 'normal' as const, dieResults: [10, 12] },
      { mode: 'advantage' as const, dieResults: [10] },
      { mode: 'disadvantage' as const, dieResults: [10] },
    ];

    for (const c of badCases) {
      const res = declareCheck(
        state,
        {
          sceneId: 'escena_01_orilla',
          actorId: 'pc_kael',
          skill: 'investigation',
          dc: 15,
          ...c,
        },
        ctx,
      );

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe('IMPOSSIBLE_DIE');
        expect(res.messageEs.length).toBeGreaterThan(0);
        expect(res.expectedRange).toEqual({ min: 1, max: 20 });
      }
    }

    expect(state).toEqual(snapshot);
  });

  it('auto-computes total in resolveInvestigate when declared.declaredTotal is omitted', () => {
    const initial = createAguasQuietasInitialState({ hybrid: true });
    const ctx = makeContext();

    const s3 = transitionScene(
      initial,
      { targetSceneId: 'escena_03_parlamento', reason: 'Parlamento' },
      ctx,
    );
    if (!s3.ok) throw new Error(s3.messageEs);
    const s4 = transitionScene(
      s3.nextState,
      { targetSceneId: 'escena_04_campamento', reason: 'Campamento' },
      ctx,
    );
    if (!s4.ok) throw new Error(s4.messageEs);

    // pc_kael investigation +4; die 14 => auto total 18, unlocks all 4 campamento clues
    const res = resolveInvestigate(
      s4.nextState,
      {
        sceneId: 'escena_04_campamento',
        actorId: 'pc_kael',
        declared: { dieResults: [14] },
      },
      ctx,
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.total).toBe(18);
    expect(res.naturalRoll).toBe(14);
    expect(res.modifier).toBe(4);
    expect(res.event.source).toBe('player-declared');
    expect(res.event.declaredTotal).toBe(18);
    expect(res.event.dieResults).toEqual([14]);
    expect(res.unlockedClues.map((c) => c.id)).toEqual([
      'pista_camp_12',
      'pista_camp_14',
      'pista_camp_16',
      'pista_camp_18',
    ]);
  });
});
