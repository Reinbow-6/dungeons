import { describe, expect, it } from 'vitest';
import {
  createAguasQuietasInitialState,
  createRng,
  resolveInvestigate,
  transitionScene,
  type GameState,
} from '../src/index.js';

function makeContext(seed = 1) {
  let i = 0;
  return {
    rng: createRng(seed),
    createId: () => `aq_${++i}`,
    now: () => '2026-11-18T20:00:00.000Z',
  };
}

describe('Aguas Quietas scene graph & investigate clues', () => {
  it('enforces allowedTransitions across the 9-node graph', () => {
    const initial = createAguasQuietasInitialState();
    const ctx = makeContext();

    // Cannot jump straight from E1 to E8
    const forbidden = transitionScene(
      initial,
      { targetSceneId: 'escena_08_otra_orilla', reason: 'Salto inválido' },
      ctx,
    );
    expect(forbidden.ok).toBe(false);
    if (!forbidden.ok) {
      expect(forbidden.code).toBe('FORBIDDEN_TRANSITION');
    }

    // Valid path: E1 -> E3 -> E4 -> E4b -> E6 -> E7 -> E8
    const route = [
      'escena_03_parlamento',
      'escena_04_campamento',
      'escena_04b_reparar_porton',
      'escena_06_comandante',
      'escena_07_travesia_barcaza',
      'escena_08_otra_orilla',
    ];

    let state: GameState = {
      ...initial,
      // Estas aristas tienen precondiciones de pista; el test verifica el grafo.
      unlockedClues: {
        escena_04_campamento: ['pista_camp_12', 'pista_camp_14'],
        escena_04b_reparar_porton: ['pista_porton_14'],
      },
    };
    for (const targetSceneId of route) {
      const res = transitionScene(
        state,
        { targetSceneId, reason: 'Progresión válida' },
        ctx,
      );
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      state = res.nextState;
    }

    expect(state.sceneId).toBe('escena_08_otra_orilla');
  });

  it('unlocks stepped clues on E4 (DC 12/14/16/18) and keeps unlocking idempotent', () => {
    const initial = createAguasQuietasInitialState({ hybrid: true });
    const ctx = makeContext();

    // Move to E4 via E1 -> E3 -> E4
    const s3 = transitionScene(
      initial,
      { targetSceneId: 'escena_03_parlamento', reason: 'Diálogo' },
      ctx,
    );
    if (!s3.ok) throw new Error(s3.messageEs);
    const s4 = transitionScene(
      s3.nextState,
      { targetSceneId: 'escena_04_campamento', reason: 'Acceso al campamento' },
      ctx,
    );
    if (!s4.ok) throw new Error(s4.messageEs);
    const campState = s4.nextState;

    // Kael has investigation +4. Roll 7 => total 11 (< 12): 0 clues
    const res11 = resolveInvestigate(
      campState,
      {
        sceneId: 'escena_04_campamento',
        actorId: 'pc_kael',
        declared: { dieResults: [7], declaredTotal: 11 },
      },
      ctx,
    );
    expect(res11.ok).toBe(true);
    if (!res11.ok) return;
    expect(res11.unlockedClues).toHaveLength(0);

    // Roll 8 => total 12: 1 clue (DC 12)
    const res12 = resolveInvestigate(
      res11.nextState,
      {
        sceneId: 'escena_04_campamento',
        actorId: 'pc_kael',
        declared: { dieResults: [8], declaredTotal: 12 },
      },
      ctx,
    );
    expect(res12.ok).toBe(true);
    if (!res12.ok) return;
    expect(res12.unlockedClues.map((c) => c.id)).toEqual(['pista_camp_12']);

    // Roll 11 => total 15: adds only DC 14 (DC 12 already unlocked)
    const res15 = resolveInvestigate(
      res12.nextState,
      {
        sceneId: 'escena_04_campamento',
        actorId: 'pc_kael',
        declared: { dieResults: [11], declaredTotal: 15 },
      },
      ctx,
    );
    expect(res15.ok).toBe(true);
    if (!res15.ok) return;
    expect(res15.unlockedClues.map((c) => c.id)).toEqual(['pista_camp_14']);

    // Roll 14 => total 18: unlocks remaining DC 16 & DC 18
    const res18 = resolveInvestigate(
      res15.nextState,
      {
        sceneId: 'escena_04_campamento',
        actorId: 'pc_kael',
        declared: { dieResults: [14], declaredTotal: 18 },
      },
      ctx,
    );
    expect(res18.ok).toBe(true);
    if (!res18.ok) return;
    expect(res18.unlockedClues.map((c) => c.id)).toEqual([
      'pista_camp_16',
      'pista_camp_18',
    ]);
    expect(res18.allUnlockedClueIds).toEqual([
      'pista_camp_12',
      'pista_camp_14',
      'pista_camp_16',
      'pista_camp_18',
    ]);

    // Re-investigating with 20 unlocks 0 duplicate clues
    const resAgain = resolveInvestigate(
      res18.nextState,
      {
        sceneId: 'escena_04_campamento',
        actorId: 'pc_kael',
        declared: { dieResults: [16], declaredTotal: 20 },
      },
      ctx,
    );
    expect(resAgain.ok).toBe(true);
    if (!resAgain.ok) return;
    expect(resAgain.unlockedClues).toHaveLength(0);
    expect(resAgain.allUnlockedClueIds).toHaveLength(4);
  });
});
