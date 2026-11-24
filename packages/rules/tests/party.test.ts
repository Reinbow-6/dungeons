import { describe, expect, it } from 'vitest';
import {
  addPartyMember,
  computeTensionMeter,
  createAguasQuietasInitialState,
  createDefaultAuthority,
  createRng,
  deriveTurnContext,
  removePartyMember,
  resolvePartyRest,
  rollbackToSeq,
  startCombat,
  type Character,
  type GameEvent,
} from '../src/index.js';

function makeContext(seed = 11) {
  let i = 0;
  return {
    rng: createRng(seed),
    createId: () => `p_ev_${++i}`,
    now: () => '2026-11-24T11:30:00.000Z',
  };
}

function makeExtraPc(
  id: string,
  name: string,
  playerName?: string,
): Character {
  return {
    id,
    name,
    ...(playerName ? { playerName } : {}),
    species: 'Humana',
    className: 'Guerrera',
    level: 1,
    abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 12, cha: 10 },
    skillProficiencies: { athletics: 'proficient' },
    savingThrowProficiencies: ['str', 'con'],
    hp: { current: 12, max: 12, temp: 0 },
    ac: 16,
    speed: 30,
    conditions: [],
    exhaustionLevel: 0,
    inventory: [{ itemId: 'longsword', name: 'Espada larga', quantity: 1 }],
    spellSlots: { '1': { current: 2, max: 2 } },
    hitDice: { die: 'd10', current: 1, max: 1 },
    concentratingOn: null,
    authority: createDefaultAuthority('digital'),
    rollAuthority: 'engine-rolled',
  };
}

describe('Local Multiplayer Party & Group Rules', () => {
  it('adds up to 4 PCs, aligns rollAuthority to table mode, and reverses cleanly on rollback', () => {
    const initial = createAguasQuietasInitialState({ hybrid: true });
    const ctx = makeContext();

    const brenna = makeExtraPc('pc_brenna', 'Brenna de Piedrafría', 'Mati');
    const r1 = addPartyMember(initial, { character: brenna }, ctx);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;

    expect(Object.keys(r1.nextState.characters)).toEqual(['pc_kael', 'pc_brenna']);
    // Inherited hybrid mode from initial party
    expect(r1.nextState.characters.pc_brenna?.rollAuthority).toBe(
      'player-declared',
    );
    expect(r1.nextState.characters.pc_brenna?.playerName).toBe('Mati');

    // Duplicate ID rejected
    const dup = addPartyMember(r1.nextState, { character: brenna }, ctx);
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.code).toBe('DUPLICATE_ACTOR');

    // Add 3rd and 4th PCs
    const r2 = addPartyMember(
      r1.nextState,
      { character: makeExtraPc('pc_seraphina', 'Seraphina Voss', 'Sofi') },
      ctx,
    );
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;

    const r3 = addPartyMember(
      r2.nextState,
      { character: makeExtraPc('pc_theron', 'Theron Ashveil') },
      ctx,
    );
    expect(r3.ok).toBe(true);
    if (!r3.ok) return;

    // 5th PC rejected cleanly
    const fifth = addPartyMember(
      r3.nextState,
      { character: makeExtraPc('pc_lira', 'Lira Vael') },
      ctx,
    );
    expect(fifth.ok).toBe(false);
    if (!fifth.ok) expect(fifth.code).toBe('PARTY_FULL');

    // Rollback to seq 1 removes pc_seraphina & pc_theron while keeping pc_brenna
    const events: GameEvent[] = [r1.event, r2.event, r3.event];
    const rb = rollbackToSeq(initial, events, 1, {
      createId: () => 'rb_1',
      now: () => '2026-11-24T11:31:00.000Z',
    });
    expect(rb.ok).toBe(true);
    if (!rb.ok) return;
    expect(Object.keys(rb.state.characters)).toEqual(['pc_kael', 'pc_brenna']);
  });

  it('prevents removing last PC or mutating party during active combat and supports rollback of removal', () => {
    const initial = createAguasQuietasInitialState();
    const ctx = makeContext();

    // Cannot remove when only 1 PC exists
    const lastErr = removePartyMember(
      initial,
      { actorId: 'pc_kael' },
      ctx,
    );
    expect(lastErr.ok).toBe(false);
    if (!lastErr.ok) expect(lastErr.code).toBe('LAST_MEMBER_REQUIRED');

    const added = addPartyMember(
      initial,
      { character: makeExtraPc('pc_brenna', 'Brenna') },
      ctx,
    );
    if (!added.ok) throw new Error(added.messageEs);

    // Cannot remove or add while combat is active
    const combat = startCombat(
      added.nextState,
      {
        sceneId: 'escena_01_orilla',
        enemies: [
          {
            id: 'exp_1',
            name: 'Explorador',
            hp: 12,
            ac: 13,
            dexMod: 2,
            attacks: [
              {
                id: 'bow',
                nameEs: 'Arco',
                attackBonus: 4,
                damageDice: '1d8+2',
                damageType: 'piercing',
              },
            ],
          },
        ],
      },
      ctx,
    );
    if (!combat.ok) throw new Error(combat.messageEs);
    const blockedRemove = removePartyMember(
      combat.nextState,
      { actorId: 'pc_brenna' },
      ctx,
    );
    expect(blockedRemove.ok).toBe(false);
    if (!blockedRemove.ok) expect(blockedRemove.code).toBe('IN_COMBAT');

    // Out of combat removal succeeds and rollback restores the removed PC
    const removed = removePartyMember(
      added.nextState,
      { actorId: 'pc_brenna', reason: 'Se quedó vigilando la orilla' },
      ctx,
    );
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(Object.keys(removed.nextState.characters)).toEqual(['pc_kael']);

    const rb = rollbackToSeq(initial, [added.event, removed.event], 1, {
      createId: () => 'rb_2',
      now: () => '2026-11-24T11:32:00.000Z',
    });
    expect(rb.ok).toBe(true);
    if (!rb.ok) return;
    expect(Object.keys(rb.state.characters)).toEqual(['pc_kael', 'pc_brenna']);
  });

  it('resolves atomic short and long rests across multiple party members', () => {
    const base = createAguasQuietasInitialState();
    const ctx = makeContext(42);
    const brenna = makeExtraPc('pc_brenna', 'Brenna');
    brenna.hp.current = 5;
    brenna.spellSlots = { '1': { current: 0, max: 2 } };
    brenna.exhaustionLevel = 1;
    brenna.conditions = ['exhaustion'];

    const seraphina = makeExtraPc('pc_seraphina', 'Seraphina');
    seraphina.hp.current = 4;
    seraphina.hitDice = { die: 'd8', current: 1, max: 1 };

    const kaelInjured = {
      ...base.characters.pc_kael!,
      hp: { current: 4, max: 11, temp: 0 },
    };

    const partyState = {
      ...base,
      characters: {
        pc_kael: kaelInjured,
        pc_brenna: brenna,
        pc_seraphina: seraphina,
      },
    };

    const shortRes = resolvePartyRest(
      partyState,
      { sceneId: 'escena_01_orilla', restType: 'short' },
      ctx,
    );
    expect(shortRes.ok).toBe(true);
    if (!shortRes.ok) return;
    expect(shortRes.event.type).toBe('REST_TAKEN');
    expect(shortRes.event.actor).toBe('party');
    expect(shortRes.members).toHaveLength(3);
    expect(shortRes.nextState.characters.pc_kael!.hp.current).toBeGreaterThan(4);
    expect(shortRes.nextState.characters.pc_brenna!.hp.current).toBeGreaterThan(5);
    expect(shortRes.nextState.characters.pc_seraphina!.hp.current).toBeGreaterThan(4);

    const longRes = resolvePartyRest(
      shortRes.nextState,
      { sceneId: 'escena_01_orilla', restType: 'long' },
      ctx,
    );
    expect(longRes.ok).toBe(true);
    if (!longRes.ok) return;
    expect(longRes.nextState.characters.pc_kael!.hp.current).toBe(11);
    expect(longRes.nextState.characters.pc_brenna!.hp.current).toBe(12);
    expect(longRes.nextState.characters.pc_brenna!.spellSlots['1']?.current).toBe(2);
    expect(longRes.nextState.characters.pc_brenna!.exhaustionLevel).toBe(0);
    expect(longRes.nextState.characters.pc_seraphina!.hp.current).toBe(12);
  });

  it('derives turn context for preferred activeActorId/pendingActorId and calibrates party tension meter', () => {
    const base = createAguasQuietasInitialState();
    const injuredParty = {
      ...base,
      characters: {
        pc_kael: {
          ...base.characters.pc_kael!,
          hp: { current: 0, max: 11, temp: 0 },
          conditions: ['frightened' as const, 'poisoned' as const],
        },
        pc_brenna: {
          ...makeExtraPc('pc_brenna', 'Brenna', 'Mati'),
          hp: { current: 0, max: 12, temp: 0 },
          conditions: ['prone' as const],
        },
      },
    };

    const activeBrenna = deriveTurnContext(injuredParty, {
      activeActorId: 'pc_brenna',
    });
    expect(activeBrenna.activeActorId).toBe('pc_brenna');
    expect(activeBrenna.activeActorName).toBe('Brenna');

    const rollCtx = deriveTurnContext(injuredParty, {
      pendingPlayerRoll: true,
      pendingActorId: 'pc_brenna',
      activeActorId: 'pc_kael',
    });
    expect(rollCtx.phase).toBe('awaiting_roll');
    expect(rollCtx.activeActorId).toBe('pc_brenna');

    // Scene base 28 + capped HP boost (34) + capped condition boost (20) = 82 (not 100!)
    const reading = computeTensionMeter(injuredParty, []);
    expect(reading.score).toBe(82);
  });
});
