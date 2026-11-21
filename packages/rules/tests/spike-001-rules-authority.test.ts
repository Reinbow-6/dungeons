import { describe, expect, it } from 'vitest';
import {
  createAguasQuietasInitialState,
  createRng,
  reduceEvents,
  resolveCheck,
  ResolveCheckInputSchema,
  resolveDamageRoll,
  ResolveDamageRollInputSchema,
  resolveSave,
  ResolveSaveInputSchema,
  transitionScene,
} from '../src/index.js';

describe('Spike 001 (rules-authority): engine calculates all numbers, never the LLM', () => {
  it('rejects any LLM-injected numeric roll, modifier, damage or total fields at tool schema boundary', () => {
    const checkWithTotal = ResolveCheckInputSchema.safeParse({
      sceneId: 'escena_01_orilla',
      actorId: 'pc_kael',
      skill: 'perception',
      dc: 12,
      total: 18,
    });
    expect(checkWithTotal.success).toBe(false);

    const checkWithModifier = ResolveCheckInputSchema.safeParse({
      sceneId: 'escena_01_orilla',
      actorId: 'pc_kael',
      skill: 'perception',
      dc: 12,
      modifier: 4,
    });
    expect(checkWithModifier.success).toBe(false);

    const saveWithRolls = ResolveSaveInputSchema.safeParse({
      sceneId: 'escena_01_orilla',
      actorId: 'pc_kael',
      ability: 'dex',
      dc: 13,
      rolls: [19],
    });
    expect(saveWithRolls.success).toBe(false);

    const damageWithNumber = ResolveDamageRollInputSchema.safeParse({
      sceneId: 'escena_01_orilla',
      sourceActorId: 'npc_scout',
      targetActorId: 'pc_kael',
      diceExpression: '1d6+2',
      damage: 7,
    });
    expect(damageWithNumber.success).toBe(false);
  });

  it('computes check, damage, and transition deterministically and records engine provenance', () => {
    const initial = createAguasQuietasInitialState({ ruleset: '5e-lite' });
    let idSeq = 0;
    const ctx = {
      rng: createRng('spike-001'),
      createId: () => `sp1_${++idSeq}`,
      now: () => '2026-11-18T20:10:00.000Z',
    };

    const checkRes = resolveCheck(
      initial,
      {
        sceneId: 'escena_01_orilla',
        actorId: 'pc_kael',
        skill: 'perception',
        dc: 12,
      },
      ctx,
    );
    expect(checkRes.ok).toBe(true);
    if (!checkRes.ok) return;

    expect(checkRes.event.source).toBe('engine');
    expect(checkRes.event.declaredTotal).toBeNull();
    expect(checkRes.modifier).toBe(4);
    expect(checkRes.total).toBe(checkRes.naturalRoll + 4);

    const dmgRes = resolveDamageRoll(
      checkRes.nextState,
      {
        sceneId: 'escena_01_orilla',
        sourceActorId: 'npc_scout',
        targetActorId: 'pc_kael',
        diceExpression: '1d6+1',
      },
      ctx,
    );
    expect(dmgRes.ok).toBe(true);
    if (!dmgRes.ok) return;
    expect(dmgRes.event.source).toBe('engine');
    expect(dmgRes.hpAfter).toBe(Math.max(0, 11 - dmgRes.damageRolled));

    const saveRes = resolveSave(
      dmgRes.nextState,
      {
        sceneId: 'escena_01_orilla',
        actorId: 'pc_kael',
        ability: 'dex',
        dc: 13,
      },
      ctx,
    );
    expect(saveRes.ok).toBe(true);
    if (!saveRes.ok) return;
    expect(saveRes.event.source).toBe('engine');

    const transRes = transitionScene(
      saveRes.nextState,
      {
        targetSceneId: 'escena_02_batalla_orilla',
        actorId: 'pc_kael',
        reason: 'Combate iniciado',
      },
      ctx,
    );
    expect(transRes.ok).toBe(true);
    if (!transRes.ok) return;

    const replayed = reduceEvents(initial, [
      checkRes.event,
      dmgRes.event,
      saveRes.event,
      transRes.event,
    ]);
    expect(replayed).toEqual(transRes.nextState);
  });

  it('switches between 5e-lite and 5e-full on the same Character schema without migration', () => {
    const liteState = createAguasQuietasInitialState({ ruleset: '5e-lite' });
    const fullState = { ...liteState, ruleset: '5e-full' as const };
    const ctxA = {
      rng: createRng(77),
      createId: () => 'id_a',
      now: () => '2026-11-18T20:10:00.000Z',
    };
    const ctxB = {
      rng: createRng(77),
      createId: () => 'id_a',
      now: () => '2026-11-18T20:10:00.000Z',
    };

    const resLite = resolveCheck(
      liteState,
      { sceneId: 'escena_01_orilla', actorId: 'pc_kael', skill: 'stealth', dc: 14 },
      ctxA,
    );
    const resFull = resolveCheck(
      fullState,
      { sceneId: 'escena_01_orilla', actorId: 'pc_kael', skill: 'stealth', dc: 14 },
      ctxB,
    );

    expect(resLite.ok).toBe(true);
    expect(resFull.ok).toBe(true);
    if (!resLite.ok || !resFull.ok) return;
    expect(resLite.total).toBe(resFull.total);
    expect(resLite.nextState.characters.pc_kael).toEqual(
      resFull.nextState.characters.pc_kael,
    );
  });
});
