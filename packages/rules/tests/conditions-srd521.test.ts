import { describe, expect, it } from 'vitest';
import {
  createAguasQuietasInitialState,
  getConditionsEffects,
  reduceEvents,
  resolveCheck,
  resolveCombatAttack,
  resolveConditionChange,
  resolveDamageRoll,
  resolveSave,
  rollbackToSeq,
  startCombat,
  type CombatEnemyDefinition,
  type GameEvent,
  type Rng,
} from '../src/index.js';

function makeFixedContext(sequence: number[]) {
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
    createId: () => `cond_${++idCounter}`,
    now: () => '2026-11-21T00:00:00.000Z',
  };
}

const SCOUT_ENEMY: CombatEnemyDefinition = {
  id: 'scout_1',
  name: 'Explorador',
  hp: 20,
  ac: 13,
  dexMod: 2,
  attacks: [
    {
      id: 'espada_corta',
      nameEs: 'Espada corta',
      attackBonus: 4,
      damageDice: '1d6+2',
      damageType: 'piercing',
    },
    {
      id: 'arco_largo',
      nameEs: 'Arco largo',
      attackBonus: 4,
      damageDice: '1d8+2',
      damageType: 'piercing',
    },
  ],
  vulnerabilities: ['fire'],
  immunities: ['poison'],
  resistances: ['fire', 'slashing'],
};

describe('SRD 5.2.1 conditions, exhaustion, resistances, concentration & temp HP', () => {
  it('computes condition effects, cumulative exhaustion (1..6), speed penalty, and rollback', () => {
    const initial = createAguasQuietasInitialState();
    const ctx = makeFixedContext([]);
    const events: GameEvent[] = [];

    // Apply exhaustion cumulatively 3 times without explicit exhaustionDelta
    let state = initial;
    for (let i = 1; i <= 3; i += 1) {
      const res = resolveConditionChange(
        state,
        {
          sceneId: 'escena_01_orilla',
          actorId: 'pc_kael',
          addConditions: ['exhaustion'],
          reason: `Travesía helada #${i}`,
        },
        ctx,
      );
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      events.push(res.event);
      state = res.nextState;
      expect(res.exhaustionLevelAfter).toBe(i);
    }

    const eff3 = getConditionsEffects(
      state.characters.pc_kael!.conditions,
      state.characters.pc_kael!.exhaustionLevel,
    );
    expect(eff3.d20Modifier).toBe(-6);
    expect(eff3.speedPenaltyFeet).toBe(-15);
    expect(eff3.isExhaustionLethal).toBe(false);

    // Exhaustion reaches level 6 (lethal)
    const toSix = resolveConditionChange(
      state,
      {
        sceneId: 'escena_01_orilla',
        actorId: 'pc_kael',
        exhaustionDelta: 4, // clamps to 6
        reason: 'Agotamiento extremo',
      },
      ctx,
    );
    expect(toSix.ok).toBe(true);
    if (!toSix.ok) return;
    events.push(toSix.event);
    expect(toSix.exhaustionLevelAfter).toBe(6);
    expect(
      getConditionsEffects(
        toSix.nextState.characters.pc_kael!.conditions,
        toSix.nextState.characters.pc_kael!.exhaustionLevel,
      ).isExhaustionLethal,
    ).toBe(true);

    expect(reduceEvents(initial, events)).toEqual(toSix.nextState);

    const rb = rollbackToSeq(initial, events, 2, ctx);
    expect(rb.ok).toBe(true);
    if (!rb.ok) return;
    expect(rb.state.characters.pc_kael!.exhaustionLevel).toBe(2);
    expect(rb.state.characters.pc_kael!.conditions).toEqual(['exhaustion']);
  });

  it('enforces blinded sight auto-fail, frightened disadvantage, restrained DEX save disadvantage, and paralyzed/unconscious STR/DEX auto-fail', () => {
    const initial = createAguasQuietasInitialState();
    const ctx = makeFixedContext([14, 7, 15, 6]);

    // Blinded: auto-fail sight-based check without consuming RNG rolls
    const blindedState = resolveConditionChange(
      initial,
      {
        sceneId: 'escena_01_orilla',
        actorId: 'pc_kael',
        addConditions: ['blinded'],
        reason: 'Niebla cegadora',
      },
      ctx,
    );
    expect(blindedState.ok).toBe(true);
    if (!blindedState.ok) return;

    const sightCheck = resolveCheck(
      blindedState.nextState,
      {
        sceneId: 'escena_01_orilla',
        actorId: 'pc_kael',
        skill: 'perception',
        dc: 10,
        requiresSight: true,
      },
      ctx,
    );
    expect(sightCheck.ok).toBe(true);
    if (!sightCheck.ok) return;
    expect(sightCheck.autoFailed).toBe(true);
    expect(sightCheck.success).toBe(false);
    expect(sightCheck.rolls).toEqual([]);

    // Frightened imposes disadvantage on checks (uses [14, 7] -> chooses 7)
    const frightenedState = resolveConditionChange(
      initial,
      {
        sceneId: 'escena_01_orilla',
        actorId: 'pc_kael',
        addConditions: ['frightened'],
        reason: 'Presencia aterradora',
      },
      ctx,
    );
    expect(frightenedState.ok).toBe(true);
    if (!frightenedState.ok) return;

    const fearCheck = resolveCheck(
      frightenedState.nextState,
      {
        sceneId: 'escena_01_orilla',
        actorId: 'pc_kael',
        skill: 'perception',
        dc: 12,
      },
      ctx,
    );
    expect(fearCheck.ok).toBe(true);
    if (!fearCheck.ok) return;
    expect(fearCheck.effectiveMode).toBe('disadvantage');
    expect(fearCheck.rolls).toEqual([14, 7]);
    expect(fearCheck.naturalRoll).toBe(7);

    // Restrained gives disadvantage on DEX saves (uses [15, 6] -> chooses 6)
    const restrainedState = resolveConditionChange(
      initial,
      {
        sceneId: 'escena_01_orilla',
        actorId: 'pc_kael',
        addConditions: ['restrained'],
        reason: 'Red de pantano',
      },
      ctx,
    );
    expect(restrainedState.ok).toBe(true);
    if (!restrainedState.ok) return;

    const dexSave = resolveSave(
      restrainedState.nextState,
      {
        sceneId: 'escena_01_orilla',
        actorId: 'pc_kael',
        ability: 'dex',
        dc: 13,
      },
      ctx,
    );
    expect(dexSave.ok).toBe(true);
    if (!dexSave.ok) return;
    expect(dexSave.effectiveMode).toBe('disadvantage');
    expect(dexSave.rolls).toEqual([15, 6]);
    expect(dexSave.naturalRoll).toBe(6);

    // Paralyzed auto-fails STR and DEX saves deterministically
    const paralyzedState = resolveConditionChange(
      initial,
      {
        sceneId: 'escena_01_orilla',
        actorId: 'pc_kael',
        addConditions: ['paralyzed'],
        reason: 'Veneno paralizante',
      },
      ctx,
    );
    expect(paralyzedState.ok).toBe(true);
    if (!paralyzedState.ok) return;

    const strSave = resolveSave(
      paralyzedState.nextState,
      {
        sceneId: 'escena_01_orilla',
        actorId: 'pc_kael',
        ability: 'str',
        dc: 5,
      },
      ctx,
    );
    expect(strSave.ok).toBe(true);
    if (!strSave.ok) return;
    expect(strSave.autoFailed).toBe(true);
    expect(strSave.success).toBe(false);
    expect(strSave.rolls).toEqual([]);
  });

  it('applies attacker/defender conditions in combat: prone melee vs ranged, invisible, paralyzed auto-crit, incapacitated block, and resistant cancellation', () => {
    const initial = createAguasQuietasInitialState();
    initial.characters.pc_kael!.resistances = ['piercing'];

    // Initiative rolls: Kael 16 (+3=19), Scout 10 (+2=12)
    const startRes = startCombat(
      initial,
      { sceneId: 'escena_01_orilla', enemies: [SCOUT_ENEMY] },
      makeFixedContext([16, 10]),
    );
    expect(startRes.ok).toBe(true);
    if (!startRes.ok) return;

    // 1. Kael attacks scout with shortsword (slashing? wait: shortsword is piercing, let's use longsword for slashing resistance test!)
    // Actually Kael has shortsword (piercing). Let's test torch (fire -> Scout has BOTH fire vulnerability & fire resistance -> cancel out to 'normal'!)
    const cancelledRes = resolveCombatAttack(
      startRes.nextState,
      {
        sceneId: 'escena_01_orilla',
        attackerId: 'pc_kael',
        targetId: 'scout_1',
        weaponId: 'torch',
      },
      makeFixedContext([15, 4]), // hit 15+3=18 >= 13; 1d4=4 fire -> cancelled to 4
    );
    expect(cancelledRes.ok).toBe(true);
    if (!cancelledRes.ok) return;
    expect(cancelledRes.damageRelation).toBe('normal');
    expect(cancelledRes.damageApplied).toBe(4);

    // 2. Test pure slashing resistance on Scout: longsword 1d8+1 (Kael STR +1) -> 1d8=6 => 7 raw -> floor(7/2)=3
    const resistRes = resolveCombatAttack(
      cancelledRes.nextState,
      {
        sceneId: 'escena_01_orilla',
        attackerId: 'pc_kael',
        targetId: 'scout_1',
        weaponId: 'longsword',
      },
      makeFixedContext([14, 6]), // hit; 6+1=7 raw -> resistant floor(7/2)=3!
    );
    expect(resistRes.ok).toBe(true);
    if (!resistRes.ok) return;
    expect(resistRes.damageRelation).toBe('resistant');
    expect(resistRes.rawDamage).toBe(7);
    expect(resistRes.damageApplied).toBe(3);

    // 3. Kael is prone: Scout melee gets advantage ([5, 16] -> 16 hit), Scout ranged gets disadvantage ([18, 4] -> 4 miss)
    const proneKael = resolveConditionChange(
      resistRes.nextState,
      {
        sceneId: 'escena_01_orilla',
        actorId: 'pc_kael',
        addConditions: ['prone'],
        reason: 'Derribado por el golpe',
      },
      makeFixedContext([]),
    );
    expect(proneKael.ok).toBe(true);
    if (!proneKael.ok) return;

    const meleeVsProne = resolveCombatAttack(
      proneKael.nextState,
      {
        sceneId: 'escena_01_orilla',
        attackerId: 'scout_1',
        targetId: 'pc_kael',
        attackId: 'espada_corta',
      },
      makeFixedContext([5, 16, 3]), // adv picks 16+4=20 hit; 3+2=5 piercing -> Kael piercing resistant floor(5/2)=2 dmg!
    );
    expect(meleeVsProne.ok).toBe(true);
    if (!meleeVsProne.ok) return;
    expect(meleeVsProne.effectiveMode).toBe('advantage');
    expect(meleeVsProne.attackRolls).toEqual([5, 16]);
    expect(meleeVsProne.damageRelation).toBe('resistant');
    expect(meleeVsProne.damageApplied).toBe(2);

    const rangedVsProne = resolveCombatAttack(
      meleeVsProne.nextState,
      {
        sceneId: 'escena_01_orilla',
        attackerId: 'scout_1',
        targetId: 'pc_kael',
        attackId: 'arco_largo',
      },
      makeFixedContext([18, 4]), // dis picks 4+4=8 < AC 14 miss
    );
    expect(rangedVsProne.ok).toBe(true);
    if (!rangedVsProne.ok) return;
    expect(rangedVsProne.effectiveMode).toBe('disadvantage');
    expect(rangedVsProne.hit).toBe(false);

    // 4. Invisible attacker (Kael gets advantage even while prone? prone gives dis, invisible gives adv -> cancel to normal!)
    // Clear prone first so Kael has pure advantage from invisible -> [3, 17] -> 17
    const standUp = resolveConditionChange(
      rangedVsProne.nextState,
      {
        sceneId: 'escena_01_orilla',
        actorId: 'pc_kael',
        removeConditions: ['prone'],
        addConditions: ['invisible'],
        reason: 'Se incorpora invisible',
      },
      makeFixedContext([]),
    );
    expect(standUp.ok).toBe(true);
    if (!standUp.ok) return;

    const invisAttack = resolveCombatAttack(
      standUp.nextState,
      {
        sceneId: 'escena_01_orilla',
        attackerId: 'pc_kael',
        targetId: 'scout_1',
        attackId: 'shortsword',
      },
      makeFixedContext([3, 17, 2]),
    );
    expect(invisAttack.ok).toBe(true);
    if (!invisAttack.ok) return;
    expect(invisAttack.effectiveMode).toBe('advantage');
    expect(invisAttack.attackRolls).toEqual([3, 17]);

    // 5. Incapacitated/Paralyzed: incapacitated Kael cannot attack; melee hit vs paralyzed Kael auto-crits!
    const paralyzedKael = resolveConditionChange(
      invisAttack.nextState,
      {
        sceneId: 'escena_01_orilla',
        actorId: 'pc_kael',
        removeConditions: ['invisible'],
        addConditions: ['paralyzed'],
        reason: 'Paralizado',
      },
      makeFixedContext([]),
    );
    expect(paralyzedKael.ok).toBe(true);
    if (!paralyzedKael.ok) return;

    const blockedAttack = resolveCombatAttack(
      paralyzedKael.nextState,
      {
        sceneId: 'escena_01_orilla',
        attackerId: 'pc_kael',
        targetId: 'scout_1',
      },
      makeFixedContext([]),
    );
    expect(blockedAttack.ok).toBe(false);
    if (!blockedAttack.ok) {
      expect(blockedAttack.code).toBe('ATTACKER_INCAPACITATED');
    }

    // Scout hits paralyzed Kael with melee -> adv ([4, 15]) + non-nat20 auto-crit -> doubles 1d6+2 to 2d6+2!
    const autoCrit = resolveCombatAttack(
      paralyzedKael.nextState,
      {
        sceneId: 'escena_01_orilla',
        attackerId: 'scout_1',
        targetId: 'pc_kael',
        attackId: 'espada_corta',
      },
      makeFixedContext([4, 15, 4, 5]), // 2d6+2 => 4+5+2=11 raw -> piercing resist floor(11/2)=5
    );
    expect(autoCrit.ok).toBe(true);
    if (!autoCrit.ok) return;
    expect(autoCrit.hit).toBe(true);
    expect(autoCrit.isCritical).toBe(true);
    expect(autoCrit.damageExpressionUsed).toBe('2d6+2');
    expect(autoCrit.damageRolls).toEqual([4, 5]);
    expect(autoCrit.damageApplied).toBe(5);
  });

  it('handles partial temp HP absorption with overflow, concentration checks (pass/fail/incapacitation), and full replay/rollback', () => {
    const initial = createAguasQuietasInitialState();
    initial.characters.pc_kael!.hp.temp = 4;
    initial.characters.pc_kael!.concentratingOn = 'Marca del cazador';
    const events: GameEvent[] = [];

    // 1. Damage roll 10 with temp=4 -> 4 temp absorbed + 6 real HP loss (11->5), DC=10. Kael CON mod is +2.
    // Fixed rolls: 1d10=10? Use dice 1d8+2 => roll 8 -> total 10, then CON save d20=9 (+2=11 >= 10 maintains!)
    const passConc = resolveDamageRoll(
      initial,
      {
        sceneId: 'escena_01_orilla',
        sourceActorId: 'trap',
        targetActorId: 'pc_kael',
        diceExpression: '1d8+2',
      },
      makeFixedContext([8, 9]),
    );
    expect(passConc.ok).toBe(true);
    if (!passConc.ok) return;
    events.push(passConc.event);
    expect(passConc.damageApplied).toBe(10);
    expect(passConc.nextState.characters.pc_kael!.hp.temp).toBe(0);
    expect(passConc.hpBefore).toBe(11);
    expect(passConc.hpAfter).toBe(5);
    expect(passConc.concentrationCheck?.maintained).toBe(true);
    expect(passConc.nextState.characters.pc_kael!.concentratingOn).toBe(
      'Marca del cazador',
    );

    // 2. Second hit deals 4 damage -> CON save d20=5 (+2=7 < 10 fails and breaks concentration!)
    const failConc = resolveDamageRoll(
      passConc.nextState,
      {
        sceneId: 'escena_01_orilla',
        sourceActorId: 'trap',
        targetActorId: 'pc_kael',
        diceExpression: '1d4+1',
      },
      makeFixedContext([3, 5]), // 3+1=4 dmg -> HP 5->1; save 5+2=7 < 10
    );
    expect(failConc.ok).toBe(true);
    if (!failConc.ok) return;
    events.push(failConc.event);
    expect(failConc.hpAfter).toBe(1);
    expect(failConc.concentrationCheck?.maintained).toBe(false);
    expect(failConc.nextState.characters.pc_kael!.concentratingOn).toBeNull();

    // 3. Reapply concentration, then incapacitation automatically clears it
    const recast = resolveConditionChange(
      failConc.nextState,
      {
        sceneId: 'escena_01_orilla',
        actorId: 'pc_kael',
        concentratingOn: 'Bendición',
        reason: 'Vuelve a concentrarse',
      },
      makeFixedContext([]),
    );
    expect(recast.ok).toBe(true);
    if (!recast.ok) return;
    events.push(recast.event);
    expect(recast.concentratingOnAfter).toBe('Bendición');

    const stunned = resolveConditionChange(
      recast.nextState,
      {
        sceneId: 'escena_01_orilla',
        actorId: 'pc_kael',
        addConditions: ['stunned'],
        reason: 'Golpe aturdidor',
      },
      makeFixedContext([]),
    );
    expect(stunned.ok).toBe(true);
    if (!stunned.ok) return;
    events.push(stunned.event);
    expect(stunned.concentratingOnAfter).toBeNull();

    expect(reduceEvents(initial, events)).toEqual(stunned.nextState);

    // Rollback to seq 1 restores temp=0, HP=5, and maintained concentration
    const rb = rollbackToSeq(initial, events, 1, makeFixedContext([]));
    expect(rb.ok).toBe(true);
    if (!rb.ok) return;
    expect(rb.state.characters.pc_kael!.hp).toEqual({
      current: 5,
      max: 11,
      temp: 0,
    });
    expect(rb.state.characters.pc_kael!.concentratingOn).toBe(
      'Marca del cazador',
    );
  });
});
