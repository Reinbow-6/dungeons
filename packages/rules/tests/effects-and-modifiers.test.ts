import { describe, expect, it } from 'vitest';
import {
  advanceCombatTurn,
  buildRollTags,
  buildSpellActiveEffect,
  createAguasQuietasInitialState,
  createDefaultAuthority,
  declareCheck,
  endCombat,
  evaluateConcentrationCheck,
  evaluatePredicate,
  getEffectiveAc,
  getEffectiveSpeed,
  reduceEvents,
  resolveCastSpell,
  resolveCheck,
  resolveCombatAttack,
  resolveConditionChange,
  resolveModifiers,
  resolveTakeRest,
  rollbackToSeq,
  startCombat,
  type ActiveEffect,
  type Character,
  type CombatEnemyDefinition,
  type GameEvent,
  type GameState,
  type Rng,
  type SourcedModifier,
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
    createId: () => `ef_${++counter}`,
    now: () => '2026-11-28T03:00:00.000Z',
  };
}

function makePartyState(): GameState {
  const base = createAguasQuietasInitialState({
    campaignId: 'camp_effects',
    sessionId: 'sess_effects',
    ruleset: '5e-full',
  });
  const seraphina: Character = {
    id: 'pc_seraphina',
    name: 'Seraphina Voss',
    species: 'Humana',
    className: 'Clériga',
    level: 3,
    abilities: { str: 12, dex: 10, con: 14, int: 10, wis: 16, cha: 14 },
    skillProficiencies: {
      insight: 'proficient',
      medicine: 'proficient',
      religion: 'proficient',
    },
    savingThrowProficiencies: ['wis', 'cha'],
    hp: { current: 22, max: 22, temp: 0 },
    ac: 16,
    speed: 30,
    conditions: [],
    exhaustionLevel: 0,
    inventory: [{ itemId: 'mace', name: 'Maza', quantity: 1 }],
    spellSlots: { '1': { current: 4, max: 4 }, '2': { current: 2, max: 2 } },
    spellcastingAbility: 'wis',
    knownSpells: [
      'guidance',
      'ray-of-frost',
      'bless',
      'bane',
      'shield-of-faith',
      'shield',
      'faerie-fire',
      'guiding-bolt',
      'hold-person',
      'sleep',
    ],
    hitDice: { die: 'd8', current: 3, max: 3 },
    concentratingOn: null,
    authority: createDefaultAuthority('digital'),
    rollAuthority: 'engine-rolled',
  };

  return {
    ...base,
    characters: {
      pc_kael: {
        ...base.characters.pc_kael!,
        hp: { current: 18, max: 18, temp: 0 },
        ac: 15,
      },
      pc_seraphina: seraphina,
    },
  };
}

const BANDIT_ENEMY: CombatEnemyDefinition = {
  id: 'bandit_1',
  creatureId: 'explorador_espesura',
  name: 'Bandido de la Niebla',
  ac: 14,
  hp: 30,
  dexMod: 1,
  attacks: [
    {
      id: 'scimitar',
      nameEs: 'Cimitarra',
      attackBonus: 4,
      damageDice: '1d6+2',
      damageType: 'slashing',
    },
  ],
  vulnerabilities: [],
  immunities: [],
};

describe('SourcedModifiers, declarative predicates, stacking & ActiveEffects lifecycle', () => {
  it('evaluates declarative predicates including negation and roll tags', () => {
    const tags = buildRollTags({
      kind: 'check',
      skill: 'stealth',
      ability: 'dex',
      conditions: ['poisoned'],
      inCombat: true,
      sceneId: 'escena_01_orilla',
    });

    expect(evaluatePredicate(['d20', 'check:stealth'], tags)).toBe(true);
    expect(evaluatePredicate(['in-combat', '!condition:blinded'], tags)).toBe(true);
    expect(evaluatePredicate(['in-combat', '!condition:poisoned'], tags)).toBe(false);
    expect(evaluatePredicate(['ability:str'], tags)).toBe(false);
  });

  it('enforces 5e stacking: untyped stacks, same slug deduplicates, named types take strongest positive and negative', () => {
    const baseModifiers: SourcedModifier[] = [
      { slug: 'ability:dex', labelEs: 'Destreza', target: 'attack', value: 3, type: 'untyped' },
      { slug: 'pb', labelEs: 'Competencia', target: 'attack', value: 2, type: 'untyped' },
      { slug: 'magic:weapon', labelEs: 'Espada +1', target: 'attack', value: 1, type: 'item' },
      { slug: 'magic:gauntlets', labelEs: 'Brazalete +2', target: 'attack', value: 2, type: 'item' },
      { slug: 'bless:a', labelEs: 'Bendición A', target: 'attack', value: 2, type: 'spell' },
      { slug: 'bless:a', labelEs: 'Bendición A dup', target: 'attack', value: 4, type: 'spell' },
      { slug: 'bane:a', labelEs: 'Perdición', target: 'attack', value: -3, type: 'spell' },
    ];

    const resolved = resolveModifiers({
      baseModifiers,
      target: 'attack',
      tags: buildRollTags({ kind: 'attack', attackKind: 'melee' }),
    });

    // untyped (3 + 2 = 5) + highest item (+2) + highest spell (+4) + lowest negative spell (-3) = 8
    expect(resolved.totalMod).toBe(8);
    expect(resolved.breakdown.find((b) => b.slug === 'magic:weapon')?.ignored).toBe(true);
    expect(resolved.breakdown.find((b) => b.slug === 'magic:gauntlets')?.ignored).toBeFalsy();
    const dupIgnored = resolved.breakdown.filter((b) => b.slug === 'bless:a' && b.ignored);
    expect(dupIgnored).toHaveLength(1);
  });

  it('consumes guidance on engine-rolled resolveCheck and includes diceBonusRange for declareCheck', () => {
    const state = makePartyState();
    // Cast guidance on Kael
    const castRes = resolveCastSpell(
      state,
      {
        sceneId: state.sceneId,
        casterId: 'pc_seraphina',
        spellId: 'guidance',
        targetId: 'pc_kael',
      },
      makeFixedCtx([]),
    );
    expect(castRes.ok).toBe(true);
    if (!castRes.ok) return;

    const kaelGuided = castRes.nextState.characters.pc_kael!;
    expect(kaelGuided.activeEffects).toHaveLength(1);
    expect(kaelGuided.activeEffects![0]!.consumeOnUse).toBe(true);

    // Hybrid declareCheck allows declared roll inside [+1, +4] extra range (Kael investigation mod = +4, declared total 19 with d20=12, guidance=3 -> 12+4+3=19)
    const paperState: GameState = {
      ...castRes.nextState,
      characters: {
        ...castRes.nextState.characters,
        pc_kael: {
          ...kaelGuided,
          authority: createDefaultAuthority('hybrid'),
          rollAuthority: 'player-declared',
        },
      },
    };
    const decRes = declareCheck(
      paperState,
      {
        sceneId: paperState.sceneId,
        actorId: 'pc_kael',
        skill: 'investigation',
        dc: 15,
        dieResults: [12],
        declaredTotal: 19,
      },
      makeFixedCtx([]),
    );
    expect(decRes.ok).toBe(true);
    if (!decRes.ok) return;
    expect(decRes.nextState.characters.pc_kael?.activeEffects ?? []).toHaveLength(0);
    expect(decRes.nextState.characters.pc_seraphina?.concentratingOn).toBeNull();

    // Hybrid declareCheck without declaredTotal (UI flow) rolls 1d4=3 automatically and adds it to total/expectedModifier
    const decAutoRes = declareCheck(
      paperState,
      {
        sceneId: paperState.sceneId,
        actorId: 'pc_kael',
        skill: 'investigation',
        dc: 15,
        dieResults: [12],
      },
      makeFixedCtx([3]),
    );
    expect(decAutoRes.ok).toBe(true);
    if (!decAutoRes.ok) return;
    expect(decAutoRes.expectedModifier).toBe(7);
    expect(decAutoRes.total).toBe(19);
    expect(decAutoRes.breakdown?.some((b) => b.slug === 'spell:guidance:check' && b.value === 3)).toBe(true);
    expect(decAutoRes.nextState.characters.pc_kael?.activeEffects ?? []).toHaveLength(0);
    expect(decAutoRes.nextState.characters.pc_seraphina?.concentratingOn).toBeNull();

    // Engine-rolled resolveCheck rolls d20=10 and guidance +1d4=3 -> +4 base +3 guidance = +7 -> total 17
    const checkRes = resolveCheck(
      castRes.nextState,
      {
        sceneId: castRes.nextState.sceneId,
        actorId: 'pc_kael',
        skill: 'investigation',
        dc: 15,
      },
      makeFixedCtx([3, 10]),
    );
    expect(checkRes.ok).toBe(true);
    if (!checkRes.ok) return;
    expect(checkRes.total).toBe(17);
    expect(checkRes.breakdown?.some((b) => b.slug === 'spell:guidance:check' && b.value === 3)).toBe(true);
    expect(checkRes.nextState.characters.pc_kael?.activeEffects ?? []).toHaveLength(0);
  });

  it('tracks combat spells (shield, guiding-bolt, bless, bane, hold-person, ray-of-frost), concentration break & all 4 turn expiry timings', () => {
    const state = makePartyState();
    const events: GameEvent[] = [];

    // Kael init=18, Seraphina init=14, Bandit init=10
    const startRes = startCombat(
      state,
      { sceneId: state.sceneId, enemies: [BANDIT_ENEMY] },
      makeFixedCtx([15, 14, 9]),
    );
    expect(startRes.ok).toBe(true);
    if (!startRes.ok) return;
    events.push(startRes.event);

    const enemyId = startRes.combat.combatants.find((c) => c.kind === 'enemy')!.id;

    // 1. Cast Shield on Seraphina (+5 AC, start_of_owner_turn, 1 round)
    const shieldRes = resolveCastSpell(
      startRes.nextState,
      { sceneId: state.sceneId, casterId: 'pc_seraphina', spellId: 'shield' },
      makeFixedCtx([]),
    );
    expect(shieldRes.ok).toBe(true);
    if (!shieldRes.ok) return;
    events.push(shieldRes.event);
    expect(getEffectiveAc(shieldRes.nextState.characters.pc_seraphina!).effectiveAc).toBe(21);

    // Enemy attacks Seraphina with d20=15 (+4=19): hits base AC 16, MISSES effective AC 21!
    const missedAtk = resolveCombatAttack(
      shieldRes.nextState,
      { sceneId: state.sceneId, attackerId: enemyId, targetId: 'pc_seraphina' },
      makeFixedCtx([15]),
    );
    expect(missedAtk.ok).toBe(true);
    if (!missedAtk.ok) return;
    events.push(missedAtk.event);
    expect(missedAtk.hit).toBe(false);
    expect(missedAtk.targetBaseAc).toBe(16);
    expect(missedAtk.targetAc).toBe(21);
    expect(missedAtk.acBreakdown?.some((b) => b.slug === 'spell:shield:ac' && b.value === 5)).toBe(true);

    // 2. Cast Guiding Bolt hitting enemy -> applies advantage-against consumeOnUse effect
    const gbRes = resolveCastSpell(
      missedAtk.nextState,
      {
        sceneId: state.sceneId,
        casterId: 'pc_seraphina',
        spellId: 'guiding-bolt',
        targetId: enemyId,
      },
      makeFixedCtx([15, 4, 4, 4, 4]),
    );
    expect(gbRes.ok).toBe(true);
    if (!gbRes.ok) return;
    events.push(gbRes.event);
    const enemyGuided = gbRes.nextState.combat?.combatants.find((c) => c.id === enemyId);
    expect(enemyGuided?.activeEffects?.some((e) => e.slug === 'spell:guiding-bolt')).toBe(true);

    // Kael attacks enemy -> Guiding Bolt grants advantage (rolls 4 and 14 -> picks 14) and is consumed
    const advAtk = resolveCombatAttack(
      gbRes.nextState,
      { sceneId: state.sceneId, attackerId: 'pc_kael', targetId: enemyId },
      makeFixedCtx([4, 14, 5]),
    );
    expect(advAtk.ok).toBe(true);
    if (!advAtk.ok) return;
    events.push(advAtk.event);
    expect(advAtk.attackRolls).toEqual([4, 14]);
    expect(advAtk.naturalRoll).toBe(14);
    expect(
      advAtk.nextState.combat?.combatants.find((c) => c.id === enemyId)?.activeEffects ?? [],
    ).toHaveLength(0);

    // 3. Cast Hold Person (failed WIS save d20=3) -> enemy gets linkedCondition 'paralyzed'
    const holdRes = resolveCastSpell(
      advAtk.nextState,
      {
        sceneId: state.sceneId,
        casterId: 'pc_seraphina',
        spellId: 'hold-person',
        targetId: enemyId,
      },
      makeFixedCtx([3]),
    );
    expect(holdRes.ok).toBe(true);
    if (!holdRes.ok) return;
    events.push(holdRes.event);
    expect(
      holdRes.nextState.combat?.combatants.find((c) => c.id === enemyId)?.conditions,
    ).toContain('paralyzed');

    // Switching concentration to Bless purges Hold Person + removes 'paralyzed' from enemy
    const blessRes = resolveCastSpell(
      holdRes.nextState,
      {
        sceneId: state.sceneId,
        casterId: 'pc_seraphina',
        spellId: 'bless',
        targetId: 'pc_kael',
      },
      makeFixedCtx([]),
    );
    expect(blessRes.ok).toBe(true);
    if (!blessRes.ok) return;
    events.push(blessRes.event);
    expect(blessRes.nextState.characters.pc_seraphina?.concentratingOn).toBe('Bendición');
    expect(
      blessRes.nextState.combat?.combatants.find((c) => c.id === enemyId)?.conditions,
    ).not.toContain('paralyzed');
    expect(
      blessRes.nextState.combat?.combatants.find((c) => c.id === 'pc_kael')?.activeEffects?.some(
        (e) => e.slug === 'spell:bless',
      ),
    ).toBe(true);

    // Advance turn from Kael -> Seraphina: Shield (start_of_owner_turn, 1 round) expires cleanly!
    const turnToSeraphina = advanceCombatTurn(
      blessRes.nextState,
      { sceneId: state.sceneId },
      makeFixedCtx([]),
    );
    expect(turnToSeraphina.ok).toBe(true);
    if (!turnToSeraphina.ok) return;
    events.push(turnToSeraphina.event);
    expect(turnToSeraphina.activeCombatant.id).toBe('pc_seraphina');
    expect(turnToSeraphina.expiredEffects.some((e) => e.slug === 'spell:shield')).toBe(true);
    expect(getEffectiveAc(turnToSeraphina.nextState.characters.pc_seraphina!).effectiveAc).toBe(16);

    // Test end_of_owner_turn, start_of_source_turn, end_of_source_turn via timed resolveConditionChange + manual effect
    const timedCond = resolveConditionChange(
      turnToSeraphina.nextState,
      {
        sceneId: state.sceneId,
        actorId: 'pc_kael',
        addConditions: ['frightened'],
        reason: 'Aura espantosa',
        durationRounds: 1,
        expiryTiming: 'end_of_owner_turn',
      },
      makeFixedCtx([]),
    );
    expect(timedCond.ok).toBe(true);
    if (!timedCond.ok) return;
    events.push(timedCond.event);
    expect(timedCond.nextState.characters.pc_kael?.conditions).toContain('frightened');

    // End Seraphina's turn -> Enemy's turn -> Kael's turn -> End Kael's turn (frightened expires)
    const tEnemy = advanceCombatTurn(timedCond.nextState, { sceneId: state.sceneId }, makeFixedCtx([]));
    expect(tEnemy.ok).toBe(true);
    if (!tEnemy.ok) return;
    events.push(tEnemy.event);

    const tKael = advanceCombatTurn(tEnemy.nextState, { sceneId: state.sceneId }, makeFixedCtx([]));
    expect(tKael.ok).toBe(true);
    if (!tKael.ok) return;
    events.push(tKael.event);
    expect(tKael.activeCombatant.id).toBe('pc_kael');
    expect(tKael.nextState.characters.pc_kael?.conditions).toContain('frightened');

    const tAfterKael = advanceCombatTurn(tKael.nextState, { sceneId: state.sceneId }, makeFixedCtx([]));
    expect(tAfterKael.ok).toBe(true);
    if (!tAfterKael.ok) return;
    events.push(tAfterKael.event);
    expect(
      tAfterKael.expiredEffects.some(
        (e) => e.linkedConditionRemoved === 'frightened' && e.targetId === 'pc_kael',
      ),
    ).toBe(true);
    expect(tAfterKael.nextState.characters.pc_kael?.conditions).not.toContain('frightened');

    // Enemy hits Seraphina (damage 10, CON save d20=2 +2 =4 < DC 10) -> breaks concentration & purges Bless from Kael!
    const breakAtk = resolveCombatAttack(
      tAfterKael.nextState,
      { sceneId: state.sceneId, attackerId: enemyId, targetId: 'pc_seraphina' },
      makeFixedCtx([19, 4, 4, 2]), // d20=19 (hit), 1d6=4+2... wait scimitar is 1d6+2 -> dmg 6, save d20=2 (<10)
    );
    expect(breakAtk.ok).toBe(true);
    if (!breakAtk.ok) return;
    events.push(breakAtk.event);
    expect(breakAtk.nextState.characters.pc_seraphina?.concentratingOn).toBeNull();
    expect(breakAtk.nextState.characters.pc_kael?.activeEffects ?? []).toHaveLength(0);

    // Ray of Frost reduces effective speed by 10 (clamped at 0)
    const rofRes = resolveCastSpell(
      breakAtk.nextState,
      {
        sceneId: state.sceneId,
        casterId: 'pc_seraphina',
        spellId: 'ray-of-frost',
        targetId: 'pc_kael',
      },
      makeFixedCtx([18, 4]),
    );
    expect(rofRes.ok).toBe(true);
    if (!rofRes.ok) return;
    events.push(rofRes.event);
    expect(getEffectiveSpeed(rofRes.nextState.characters.pc_kael!).effectiveSpeed).toBe(25);

    // End combat purges expiresOnCombatEnd effects (Ray of Frost)
    const ended = endCombat(
      rofRes.nextState,
      { sceneId: state.sceneId, reason: 'Combate terminado' },
      makeFixedCtx([]),
    );
    expect(ended.ok).toBe(true);
    if (!ended.ok) return;
    events.push(ended.event);
    expect(ended.expiredEffects.some((e) => e.slug === 'spell:ray-of-frost')).toBe(true);
    expect(getEffectiveSpeed(ended.nextState.characters.pc_kael!).effectiveSpeed).toBe(35);

    // Full event-log replay and rollback parity
    expect(reduceEvents(state, events)).toEqual(ended.nextState);
    const rb = rollbackToSeq(state, events, 2, {
      createId: () => 'rb_1',
      now: () => '2026-11-28T03:05:00.000Z',
    });
    expect(rb.ok).toBe(true);
    if (!rb.ok) return;
    // After seq 2 (startCombat + Shield), Seraphina has Shield active (+5 AC = 21)
    expect(getEffectiveAc(rb.state.characters.pc_seraphina!).effectiveAc).toBe(21);
  });

  it('ticks start_of_source_turn and end_of_source_turn accurately and purges on rests', () => {
    const base = makePartyState();
    const sourceStartEffect: ActiveEffect = {
      id: 'eff_src_start',
      slug: 'custom:aura-start',
      labelEs: 'Aura al inicio del turno',
      sourceActorId: 'pc_seraphina',
      durationRounds: 1,
      remainingRounds: 1,
      expiryTiming: 'start_of_source_turn',
      expiresOnCombatEnd: true,
      expiresOnRest: 'short',
      modifiers: [],
    };
    const sourceEndEffect = buildSpellActiveEffect({
      spellId: 'shield-of-faith',
      effectId: 'eff_sof',
      sourceActorId: 'pc_seraphina',
    })!;
    sourceEndEffect.durationRounds = 1;
    sourceEndEffect.remainingRounds = 1;

    const seeded: GameState = {
      ...base,
      characters: {
        ...base.characters,
        pc_kael: {
          ...base.characters.pc_kael!,
          activeEffects: [sourceStartEffect, sourceEndEffect],
        },
        pc_seraphina: {
          ...base.characters.pc_seraphina!,
          concentratingOn: 'Escudo de la fe',
        },
      },
    };

    const started = startCombat(
      seeded,
      { sceneId: seeded.sceneId, enemies: [BANDIT_ENEMY] },
      makeFixedCtx([18, 12, 5]), // Kael -> Seraphina -> Bandit
    );
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    // Kael -> Seraphina (source starts turn -> start_of_source_turn expires)
    const t1 = advanceCombatTurn(started.nextState, { sceneId: seeded.sceneId }, makeFixedCtx([]));
    expect(t1.ok).toBe(true);
    if (!t1.ok) return;
    expect(t1.expiredEffects.map((e) => e.effectId)).toEqual(['eff_src_start']);

    // Seraphina -> Bandit (source ends turn -> end_of_source_turn expires)
    const t2 = advanceCombatTurn(t1.nextState, { sceneId: seeded.sceneId }, makeFixedCtx([]));
    expect(t2.ok).toBe(true);
    if (!t2.ok) return;
    expect(t2.expiredEffects.map((e) => e.effectId)).toEqual(['eff_sof']);

    // Short rest purges short-rest effects while preserving expiresOnRest: 'none'; long rest clears all non-'none'
    const restState: GameState = {
      ...base,
      characters: {
        ...base.characters,
        pc_kael: {
          ...base.characters.pc_kael!,
          activeEffects: [
            buildSpellActiveEffect({
              spellId: 'bless',
              effectId: 'eff_bless_rest',
              sourceActorId: 'pc_seraphina',
            })!,
            {
              id: 'eff_permanent_boon',
              slug: 'boon:silver',
              labelEs: 'Bendición permanente',
              sourceActorId: 'pc_kael',
              durationRounds: null,
              remainingRounds: null,
              expiryTiming: 'end_of_owner_turn',
              expiresOnCombatEnd: false,
              expiresOnRest: 'none',
              modifiers: [{ slug: 'boon:ac', labelEs: 'Bendición', target: 'ac', value: 1, type: 'untyped' }],
            },
          ],
        },
      },
    };

    const rested = resolveTakeRest(
      restState,
      { sceneId: restState.sceneId, actorId: 'pc_kael', restType: 'short' },
      makeFixedCtx([]),
    );
    expect(rested.ok).toBe(true);
    if (!rested.ok) return;
    const afterIds = (rested.nextState.characters.pc_kael?.activeEffects ?? []).map((e) => e.id);
    expect(afterIds).toEqual(['eff_permanent_boon']);
  });

  it('applies Bless dice and save advantage in concentration checks, and grantsAdvantage in declareCheck', () => {
    const base = makePartyState();
    const blessEff = buildSpellActiveEffect({
      spellId: 'bless',
      effectId: 'eff_conc_bless',
      sourceActorId: 'pc_seraphina',
    })!;
    const advSaveEff: ActiveEffect = {
      id: 'eff_adv_save',
      slug: 'boon:focus',
      labelEs: 'Mente Férrea',
      sourceActorId: 'pc_seraphina',
      durationRounds: null,
      remainingRounds: null,
      expiryTiming: 'end_of_owner_turn',
      expiresOnCombatEnd: false,
      expiresOnRest: 'long',
      modifiers: [
        {
          slug: 'boon:focus:save',
          labelEs: 'Mente Férrea',
          target: 'save',
          type: 'circumstance',
          grantsAdvantage: true,
        },
        {
          slug: 'boon:focus:check',
          labelEs: 'Mente Férrea',
          target: 'check',
          type: 'circumstance',
          grantsAdvantage: true,
        },
      ],
    };

    const charWithBuffs: Character = {
      ...base.characters.pc_seraphina!,
      concentratingOn: 'Bendición',
      activeEffects: [blessEff, advSaveEff],
    };

    // CON save mod is +2. Bless rolls 3 -> +5. Advantage d20 rolls [4, 12] -> picks 12. Total 17 >= DC 10.
    const conc = evaluateConcentrationCheck({
      character: charWithBuffs,
      damageApplied: 10,
      hpAfter: 12,
      ruleset: '5e-full',
      rng: makeFixedRng([3, 4, 12]),
    });
    expect(conc).toEqual({
      spell: 'Bendición',
      dc: 10,
      naturalRoll: 12,
      modifier: 5,
      total: 17,
      maintained: true,
    });

    // Hybrid declareCheck respects grantsAdvantage from activeEffects (requires 2 d20s even with mode: 'normal')
    const hybridState: GameState = {
      ...base,
      characters: {
        ...base.characters,
        pc_seraphina: {
          ...charWithBuffs,
          rollAuthority: 'player-declared',
        },
      },
    };
    const oneDie = declareCheck(
      hybridState,
      {
        sceneId: hybridState.sceneId,
        actorId: 'pc_seraphina',
        skill: 'insight',
        dc: 12,
        dieResults: [15],
      },
      makeFixedCtx([]),
    );
    expect(oneDie.ok).toBe(false);
    if (!oneDie.ok) expect(oneDie.code).toBe('IMPOSSIBLE_DIE');

    const twoDice = declareCheck(
      hybridState,
      {
        sceneId: hybridState.sceneId,
        actorId: 'pc_seraphina',
        skill: 'insight',
        dc: 12,
        dieResults: [6, 15],
      },
      makeFixedCtx([]),
    );
    expect(twoDice.ok).toBe(true);
    if (twoDice.ok) expect(twoDice.naturalRoll).toBe(15);
  });
});
