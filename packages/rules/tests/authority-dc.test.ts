import { describe, expect, it } from 'vitest';
import {
  createAguasQuietasInitialState,
  createRng,
  declareCheck,
  resolveCheck,
  resolveSave,
  transitionScene,
} from '../src/index.js';

function makeContext() {
  let i = 0;
  return {
    rng: createRng(7),
    createId: () => `auth_${++i}`,
    now: () => '2026-11-20T00:00:00.000Z',
  };
}

function campState(hybrid: boolean) {
  const initial = createAguasQuietasInitialState({ hybrid });
  const ctx = makeContext();
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

describe('authority enforcement & data-driven DC (P0 fixes 2 & 3)', () => {
  it('resolve_check / resolve_save reject player-declared actors with WRONG_MODE', () => {
    const state = createAguasQuietasInitialState({ hybrid: true });
    const ctx = makeContext();

    const check = resolveCheck(
      state,
      { sceneId: state.sceneId, actorId: 'pc_kael', skill: 'perception', dc: 12 },
      ctx,
    );
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.code).toBe('WRONG_MODE');
      expect(check.messageEs).toContain('declare_check');
    }

    const save = resolveSave(
      state,
      { sceneId: state.sceneId, actorId: 'pc_kael', ability: 'dex', dc: 12 },
      ctx,
    );
    expect(save.ok).toBe(false);
    if (!save.ok) {
      expect(save.code).toBe('WRONG_MODE');
      expect(save.messageEs).toContain('declare_check');
    }
  });

  it('declare_check rejects engine-rolled actors with WRONG_MODE', () => {
    const state = createAguasQuietasInitialState();
    const res = declareCheck(
      state,
      {
        sceneId: state.sceneId,
        actorId: 'pc_kael',
        skill: 'perception',
        dc: 12,
        dieResults: [11],
      },
      makeContext(),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe('WRONG_MODE');
      expect(res.messageEs).toContain('resolve_check');
    }
  });

  it('resolves DC from an existing scene clue via dcRef and ignores/audits the LLM number', () => {
    const state = campState(false);
    const res = resolveCheck(
      state,
      {
        sceneId: 'escena_04_campamento',
        actorId: 'pc_kael',
        skill: 'perception',
        dcRef: 'pista_camp_12',
        dc: 40,
      },
      makeContext(),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.dc).toBe(12);
    expect(res.event.payload.dc).toBe(12);
    expect(res.event.payload.dcSource).toBe('scene-clue');
    expect(res.event.payload.dcRef).toBe('pista_camp_12');
    expect(res.event.payload.dcDeclaredByModel).toBe(40);
  });

  it('returns DC_REQUIRED when neither dcRef nor dc is provided', () => {
    const digital = campState(false);
    const hybrid = campState(true);
    const ctx = makeContext();

    const check = resolveCheck(
      digital,
      {
        sceneId: 'escena_04_campamento',
        actorId: 'pc_kael',
        skill: 'perception',
      },
      ctx,
    );
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.code).toBe('DC_REQUIRED');

    const save = resolveSave(
      digital,
      {
        sceneId: 'escena_04_campamento',
        actorId: 'pc_kael',
        ability: 'wis',
      },
      ctx,
    );
    expect(save.ok).toBe(false);
    if (!save.ok) expect(save.code).toBe('DC_REQUIRED');

    const decl = declareCheck(
      hybrid,
      {
        sceneId: 'escena_04_campamento',
        actorId: 'pc_kael',
        skill: 'perception',
        dieResults: [11],
      },
      ctx,
    );
    expect(decl.ok).toBe(false);
    if (!decl.ok) expect(decl.code).toBe('DC_REQUIRED');
  });

  it('rejects an unknown dcRef instead of silently falling back to a free number', () => {
    const state = campState(false);
    const res = resolveCheck(
      state,
      {
        sceneId: 'escena_04_campamento',
        actorId: 'pc_kael',
        skill: 'perception',
        dcRef: 'pista_inexistente',
      },
      makeContext(),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('INVALID_INPUT');
  });

  it('falls back to numeric dc when LLM supplies a descriptive unknown dcRef alongside valid dc', () => {
    const digital = createAguasQuietasInitialState({ hybrid: false });
    const hybrid = createAguasQuietasInitialState({ hybrid: true });
    const ctx = makeContext();

    const check = resolveCheck(
      digital,
      {
        sceneId: 'escena_01_orilla',
        actorId: 'pc_kael',
        skill: 'survival',
        dc: 12,
        dcRef: 'rastrear columna de humo en la maleza',
      },
      ctx,
    );
    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.dc).toBe(12);
      expect(check.event.payload.dcSource).toBe('declared');
    }

    const decl = declareCheck(
      hybrid,
      {
        sceneId: 'escena_01_orilla',
        actorId: 'pc_kael',
        skill: 'survival',
        dc: 12,
        dcRef: 'rastrear columna de humo en la maleza',
        dieResults: [12],
      },
      ctx,
    );
    expect(decl.ok).toBe(true);
    if (decl.ok) {
      expect(decl.dc).toBe(12);
      expect(decl.event.payload.dcSource).toBe('declared');
    }
  });
});
