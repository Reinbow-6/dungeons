import { describe, expect, it } from 'vitest';
import {
  createAguasQuietasInitialState,
  reduceEvents,
  resolveCombatAttack,
  resolveDamageRoll,
  startCombat,
  type GameState,
  type Rng,
} from '../src/index.js';

function makeContext(sequence: number[]) {
  let cursor = 0;
  let idCounter = 0;
  const rng: Rng = {
    next: () => 0.5,
    nextInt: (min, max) => {
      const value = sequence[cursor] ?? min;
      cursor += 1;
      if (value < min || value > max) {
        throw new Error(`Fixed RNG value ${value} out of bounds [${min}, ${max}]`);
      }
      return value;
    },
  };
  return {
    rng,
    createId: () => `evt_${++idCounter}`,
    now: () => '2026-11-20T00:00:00.000Z',
  };
}

function stateWithTemp5(): GameState {
  const state = createAguasQuietasInitialState();
  state.characters.pc_kael!.hp.temp = 5;
  return state;
}

describe('temp HP reduction survives event replay (P0 replay/rollback fix)', () => {
  it('resolve_damage_roll: temp=5 + absorbed 5 => nextState and reduceEvents both have temp=0', () => {
    const initial = stateWithTemp5();
    const ctx = makeContext([4]); // 1d4+1 = 5
    const res = resolveDamageRoll(
      initial,
      {
        sceneId: 'escena_01_orilla',
        sourceActorId: 'npc_scout',
        targetActorId: 'pc_kael',
        diceExpression: '1d4+1',
      },
      ctx,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.damageRolled).toBe(5);
    expect(res.event.payload.absorbedByTemp).toBe(5);
    expect(res.event.stateDelta.tempHpChanges).toEqual([
      { actorId: 'pc_kael', before: 5, after: 0 },
    ]);
    expect(res.nextState.characters.pc_kael!.hp.temp).toBe(0);

    const replayed = reduceEvents(initial, [res.event]);
    expect(replayed.characters.pc_kael!.hp.temp).toBe(0);
    expect(replayed).toEqual(res.nextState);
  });

  it('combat attack: temp=5 + absorbed 5 => nextState and reduceEvents both have temp=0', () => {
    const initial = stateWithTemp5();
    const ctx = makeContext([15, 10, 19, 3]); // initiative x2, attack 19, damage 1d6+2 = 5
    const started = startCombat(
      initial,
      {
        sceneId: 'escena_01_orilla',
        enemies: [
          {
            id: 'explorador_1',
            name: 'Explorador',
            hp: 16,
            ac: 13,
            dexMod: 2,
            attacks: [
              {
                id: 'arco_largo',
                nameEs: 'Arco largo',
                attackBonus: 4,
                damageDice: '1d6+2',
                damageType: 'piercing',
              },
            ],
            vulnerabilities: [],
            immunities: [],
          },
        ],
      },
      ctx,
    );
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const attacked = resolveCombatAttack(
      started.nextState,
      {
        sceneId: 'escena_01_orilla',
        attackerId: 'explorador_1',
        targetId: 'pc_kael',
        attackId: 'arco_largo',
      },
      ctx,
    );
    expect(attacked.ok).toBe(true);
    if (!attacked.ok) return;

    expect(attacked.hit).toBe(true);
    expect(attacked.damageApplied).toBe(5);
    expect(attacked.event.stateDelta.tempHpChanges).toEqual([
      { actorId: 'pc_kael', before: 5, after: 0 },
    ]);
    expect(attacked.nextState.characters.pc_kael!.hp.temp).toBe(0);

    const replayed = reduceEvents(started.nextState, [attacked.event]);
    expect(replayed.characters.pc_kael!.hp.temp).toBe(0);
    expect(replayed).toEqual(attacked.nextState);
  });
});
