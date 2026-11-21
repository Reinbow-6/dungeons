import { describe, expect, it } from 'vitest';
import {
  createAguasQuietasInitialState,
  createRng,
  resolveInvestigate,
  transitionScene,
  type GameState,
} from '../src/index.js';

function makeCtx() {
  let i = 0;
  return {
    rng: createRng('preconditions'),
    createId: () => `pre_${++i}`,
    now: () => '2026-11-20T00:00:00.000Z',
  };
}

function campState(hybrid: boolean): GameState {
  const initial = createAguasQuietasInitialState({ hybrid });
  const ctx = makeCtx();
  const toParlamento = transitionScene(
    initial,
    { targetSceneId: 'escena_03_parlamento', reason: 'Parlamento' },
    ctx,
  );
  if (!toParlamento.ok) throw new Error(toParlamento.messageEs);
  const toCamp = transitionScene(
    toParlamento.nextState,
    { targetSceneId: 'escena_04_campamento', reason: 'Campamento' },
    ctx,
  );
  if (!toCamp.ok) throw new Error(toCamp.messageEs);
  return toCamp.nextState;
}

describe('precondiciones de transición (P0)', () => {
  it('rechaza el atajo directo escena_04 -> escena_06 sin la pista del campamento', () => {
    const state = campState(false);
    const res = transitionScene(
      state,
      { targetSceneId: 'escena_06_comandante', reason: 'Interrogatorio' },
      makeCtx(),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe('MISSING_PRECONDITION');
      expect(res.messageEs).toContain('pista_camp_14');
    }
  });

  it('permite escena_04 -> escena_06 cuando la pista ya fue desbloqueada con investigate', () => {
    const state = campState(true);
    const investigated = resolveInvestigate(
      state,
      {
        sceneId: 'escena_04_campamento',
        actorId: 'pc_kael',
        skill: 'investigation',
        declared: { dieResults: [10] }, // 10 + +4 = 14 => DC 12 y 14
      },
      makeCtx(),
    );
    expect(investigated.ok).toBe(true);
    if (!investigated.ok) return;
    expect(
      investigated.nextState.unlockedClues['escena_04_campamento'],
    ).toContain('pista_camp_14');

    const res = transitionScene(
      investigated.nextState,
      { targetSceneId: 'escena_06_comandante', reason: 'Interrogatorio' },
      makeCtx(),
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.toSceneId).toBe('escena_06_comandante');
  });

  it('evita soft-lock: permite avanzar sin pistas opcionales vía reparar portón o asalto', () => {
    const base = campState(false);

    const toAssault = transitionScene(
      base,
      { targetSceneId: 'escena_05_asalto_campamento', reason: 'Estalla combate' },
      makeCtx(),
    );
    expect(toAssault.ok).toBe(true);

    const toRepair = transitionScene(
      base,
      { targetSceneId: 'escena_04b_reparar_porton', reason: 'Reparar el portón' },
      makeCtx(),
    );
    expect(toRepair.ok).toBe(true);
    if (!toRepair.ok) return;

    const toCommander = transitionScene(
      toRepair.nextState,
      { targetSceneId: 'escena_06_comandante', reason: 'Portón reparado' },
      makeCtx(),
    );
    expect(toCommander.ok).toBe(true);
  });

  it('enforcea requiredFlags en transitionRequirements cuando están declaradas en la escena', () => {
    const base = campState(false);
    const customState: GameState = {
      ...base,
      scenes: {
        ...base.scenes,
        escena_04_campamento: {
          ...base.scenes['escena_04_campamento']!,
          transitionRequirements: {
            'escena_04_campamento>escena_04b_reparar_porton': {
              requiredFlags: ['gate_tools_received'],
            },
          },
        },
      },
    };

    const blocked = transitionScene(
      customState,
      { targetSceneId: 'escena_04b_reparar_porton', reason: 'Reparar' },
      makeCtx(),
    );
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.code).toBe('MISSING_PRECONDITION');
      expect(blocked.messageEs).toContain('gate_tools_received');
    }

    const withFlag: GameState = {
      ...customState,
      flags: { ...customState.flags, gate_tools_received: true },
    };
    const allowed = transitionScene(
      withFlag,
      { targetSceneId: 'escena_04b_reparar_porton', reason: 'Reparar' },
      makeCtx(),
    );
    expect(allowed.ok).toBe(true);
  });
});
