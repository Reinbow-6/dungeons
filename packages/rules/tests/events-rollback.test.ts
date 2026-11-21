import { describe, expect, it } from 'vitest';
import {
  createAguasQuietasInitialState,
  createRng,
  reduceEvents,
  resolveCheck,
  resolveDamageRoll,
  resolveInventoryChange,
  rollbackToSeq,
  transitionScene,
  type GameEvent,
} from '../src/index.js';

function makeContext(seed = 99) {
  let idCounter = 0;
  return {
    rng: createRng(seed),
    createId: () => `evt_${++idCounter}`,
    now: () => '2026-11-18T20:00:00.000Z',
  };
}

describe('event_log replay & rollback', () => {
  it('reconstructs identical GameState deterministically via reduceEvents', () => {
    const initial = createAguasQuietasInitialState();
    const ctx = makeContext(11);
    const events: GameEvent[] = [];

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
    events.push(checkRes.event);

    const transRes = transitionScene(
      checkRes.nextState,
      {
        targetSceneId: 'escena_03_parlamento',
        actorId: 'pc_kael',
        reason: 'Decidió parlamentar con los exploradores.',
      },
      ctx,
    );
    expect(transRes.ok).toBe(true);
    if (!transRes.ok) return;
    events.push(transRes.event);

    const dmgRes = resolveDamageRoll(
      transRes.nextState,
      {
        sceneId: 'escena_03_parlamento',
        sourceActorId: 'npc_scout',
        targetActorId: 'pc_kael',
        diceExpression: '1d4',
      },
      ctx,
    );
    expect(dmgRes.ok).toBe(true);
    if (!dmgRes.ok) return;
    events.push(dmgRes.event);

    // Shuffle event array order before reducing to verify seq sorting
    const replayed = reduceEvents(initial, [events[2]!, events[0]!, events[1]!]);
    expect(replayed).toEqual(dmgRes.nextState);

    // Ensure initial state was never mutated
    expect(initial.sceneId).toBe('escena_01_orilla');
    expect(initial.lastSeq).toBe(0);
    expect(initial.characters.pc_kael!.hp.current).toBe(11);
  });

  it('rolls back to an earlier seq, marks reverted events, and records ROLLBACK audit event', () => {
    const initial = createAguasQuietasInitialState();
    const ctx = makeContext(5);
    const events: GameEvent[] = [];

    const step1 = transitionScene(
      initial,
      { targetSceneId: 'escena_03_parlamento', reason: 'Parlamento' },
      ctx,
    );
    if (!step1.ok) throw new Error(step1.messageEs);
    events.push(step1.event); // seq 1

    const step2 = transitionScene(
      step1.nextState,
      { targetSceneId: 'escena_04_campamento', reason: 'Acuerdo' },
      ctx,
    );
    if (!step2.ok) throw new Error(step2.messageEs);
    events.push(step2.event); // seq 2

    const step3 = resolveDamageRoll(
      step2.nextState,
      {
        sceneId: 'escena_04_campamento',
        sourceActorId: 'trap',
        targetActorId: 'pc_kael',
        diceExpression: '1d6+1',
      },
      ctx,
    );
    if (!step3.ok) throw new Error(step3.messageEs);
    events.push(step3.event); // seq 3

    const rb = rollbackToSeq(initial, events, 1, {
      createId: ctx.createId,
      now: ctx.now,
      actor: 'pc_kael',
    });

    expect(rb.ok).toBe(true);
    if (!rb.ok) return;

    expect(rb.state.sceneId).toBe('escena_03_parlamento');
    expect(rb.state.lastSeq).toBe(1);
    expect(rb.state.characters.pc_kael!.hp.current).toBe(11);

    expect(rb.rollbackEvent.type).toBe('ROLLBACK');
    expect(rb.rollbackEvent.seq).toBe(4);
    expect(rb.events.find((e) => e.seq === 1)?.revertedByEventId).toBeNull();
    expect(rb.events.find((e) => e.seq === 2)?.revertedByEventId).toBe(
      rb.rollbackEvent.id,
    );
    expect(rb.events.find((e) => e.seq === 3)?.revertedByEventId).toBe(
      rb.rollbackEvent.id,
    );

    // Invalid target seqs must fail cleanly
    const badNeg = rollbackToSeq(initial, rb.events, -1, {
      createId: ctx.createId,
      now: ctx.now,
    });
    expect(badNeg.ok).toBe(false);

    const badFuture = rollbackToSeq(initial, rb.events, 2, {
      createId: ctx.createId,
      now: ctx.now,
    });
    expect(badFuture.ok).toBe(false);
  });

  it('adds, decrements, removes at zero, and restores inventory on rollback', () => {
    const initial = createAguasQuietasInitialState();
    const ctx = makeContext(17);
    const events: GameEvent[] = [];

    const addPotion = resolveInventoryChange(
      initial,
      {
        sceneId: 'escena_01_orilla',
        actorId: 'pc_kael',
        itemId: 'potion-of-healing',
        itemName: 'Poción de curación',
        qtyDelta: 2,
        reason: 'Suministros iniciales',
      },
      ctx,
    );
    expect(addPotion.ok).toBe(true);
    if (!addPotion.ok) return;
    events.push(addPotion.event);
    expect(
      addPotion.nextState.characters.pc_kael!.inventory.find(
        (i) => i.itemId === 'potion-of-healing',
      ),
    ).toEqual({
      itemId: 'potion-of-healing',
      name: 'Poción de curación',
      quantity: 2,
    });

    const useOne = resolveInventoryChange(
      addPotion.nextState,
      {
        sceneId: 'escena_01_orilla',
        actorId: 'pc_kael',
        itemId: 'potion-of-healing',
        qtyDelta: -1,
        reason: 'Bebió una poción',
      },
      ctx,
    );
    expect(useOne.ok).toBe(true);
    if (!useOne.ok) return;
    events.push(useOne.event);
    expect(useOne.quantityAfter).toBe(1);

    const dropRations = resolveInventoryChange(
      useOne.nextState,
      {
        sceneId: 'escena_01_orilla',
        actorId: 'pc_kael',
        itemId: 'rations',
        qtyDelta: -3,
        reason: 'Compartió las raciones',
      },
      ctx,
    );
    expect(dropRations.ok).toBe(true);
    if (!dropRations.ok) return;
    events.push(dropRations.event);
    expect(
      dropRations.nextState.characters.pc_kael!.inventory.some(
        (i) => i.itemId === 'rations',
      ),
    ).toBe(false);

    const rb = rollbackToSeq(initial, events, 1, {
      createId: ctx.createId,
      now: ctx.now,
    });
    expect(rb.ok).toBe(true);
    if (!rb.ok) return;
    expect(
      rb.state.characters.pc_kael!.inventory.find(
        (i) => i.itemId === 'potion-of-healing',
      )?.quantity,
    ).toBe(2);
    expect(
      rb.state.characters.pc_kael!.inventory.find((i) => i.itemId === 'rations')
        ?.quantity,
    ).toBe(3);
  });
});
