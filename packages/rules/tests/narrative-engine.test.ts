import { describe, expect, it } from 'vitest';
import {
  applyDelta,
  computeMacroStoryArc,
  computeTensionMeter,
  createAguasQuietasInitialState,
  createRng,
  deriveTurnContext,
  endCombat,
  selectActiveNpcMinds,
  selectMentionActivatedMemories,
  startCombat,
  type FilterableMemoryFact,
  type GameEvent,
  type GameState,
} from '../src/index.js';

function makeEvent(
  seq: number,
  type: GameEvent['type'],
  payload: Record<string, unknown> = {},
  revertedByEventId: string | null = null,
): GameEvent {
  return {
    id: `ev_${seq}`,
    campaignId: 'camp_aguas_quietas',
    sessionId: 'sess_1',
    seq,
    type,
    source: 'engine',
    visibility: 'public',
    actor: 'pc_kael',
    checkId: null,
    declaredTotal: null,
    dieResults: null,
    payload,
    stateDelta: {},
    revertedByEventId,
    createdAt: '2026-11-24T09:00:00.000Z',
  };
}

describe('Narrative Engine (Block C)', () => {
  describe('turnPhase & deriveTurnContext', () => {
    it('derives exploration, awaiting_roll, resolving, and combat_turn accurately', () => {
      const initial = createAguasQuietasInitialState();

      const explore = deriveTurnContext(initial);
      expect(explore.phase).toBe('exploration');
      expect(explore.activeActorId).toBe('pc_kael');

      const waiting = deriveTurnContext(initial, { pendingPlayerRoll: true });
      expect(waiting.phase).toBe('awaiting_roll');
      expect(waiting.activeActorId).toBe('pc_kael');

      const resolving = deriveTurnContext(initial, { isStreaming: true });
      expect(resolving.phase).toBe('resolving');
      expect(resolving.activeActorName).toBe('Dungeon Master');

      const combatStart = startCombat(
        initial,
        {
          sceneId: 'escena_01_orilla',
          enemies: [
            {
              id: 'gob_1',
              name: 'Explorador hostil',
              ac: 13,
              hp: 10,
              dexMod: 2,
              attacks: [
                {
                  id: 'espada_corta',
                  nameEs: 'Espada corta',
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
        {
          rng: createRng(7),
          createId: () => 'ev_c1',
          now: () => '2026-11-24T09:00:00.000Z',
        },
      );
      expect(combatStart.ok).toBe(true);
      if (!combatStart.ok) return;

      expect(combatStart.nextState.turnPhase).toBe('combat_turn');
      const combatCtx = deriveTurnContext(combatStart.nextState);
      expect(combatCtx.phase).toBe('combat_turn');
      expect(combatCtx.labelEs).toContain('R1');
      expect(combatCtx.activeActorId).toBeTruthy();

      // Ending combat returns turnPhase to exploration via applyDelta
      const ended = endCombat(
        combatStart.nextState,
        { sceneId: 'escena_01_orilla', outcome: 'victory', reason: 'Victoria' },
        {
          rng: createRng(7),
          createId: () => 'ev_c2',
          now: () => '2026-11-24T09:01:00.000Z',
        },
      );
      expect(ended.ok).toBe(true);
      if (!ended.ok) return;
      expect(ended.nextState.turnPhase).toBe('exploration');

      // Direct applyDelta replay also maintains turnPhase deterministically
      const replayed = applyDelta(initial, combatStart.event.stateDelta, 1);
      expect(replayed.turnPhase).toBe('combat_turn');
    });
  });

  describe('computeTensionMeter', () => {
    it('reflects scene baseline, combat/HP/failure escalation, and rest/ending relief', () => {
      const initial = createAguasQuietasInitialState();
      const startReading = computeTensionMeter(initial, []);
      expect(startReading.score).toBe(28);
      expect(startReading.level).toBe('alerta');

      // After resting in the ending scene, tension drops into calma
      const calmState: GameState = {
        ...initial,
        sceneId: 'escena_08_otra_orilla',
      };
      const calmReading = computeTensionMeter(calmState, [
        makeEvent(1, 'REST_TAKEN', { kind: 'short' }),
      ]);
      expect(calmReading.level).toBe('calma');
      expect(calmReading.score).toBe(0);

      // Active combat + 0 HP + frightened + failed checks pushes to climax
      const kael = initial.characters.pc_kael!;
      const crisisState: GameState = {
        ...initial,
        sceneId: 'escena_05_asalto_campamento',
        combat: {
          active: true,
          round: 3,
          turnIndex: 0,
          combatants: [
            {
              id: 'pc_kael',
              name: kael.name,
              kind: 'pc',
              initiative: 15,
              ac: kael.ac,
              hp: { current: 0, max: kael.hp.max },
              attacks: [],
              vulnerabilities: [],
              immunities: [],
              defeated: true,
              conditions: ['frightened'],
            },
          ],
        },
        characters: {
          ...initial.characters,
          pc_kael: {
            ...kael,
            hp: { ...kael.hp, current: 0 },
            conditions: ['frightened'],
          },
        },
      };
      const crisisReading = computeTensionMeter(crisisState, [
        makeEvent(1, 'CHECK_RESOLVED', { success: false }),
        makeEvent(2, 'DEATH_SAVE_RESOLVED', { outcome: 'failure' }),
      ]);
      expect(crisisReading.level).toBe('climax');
      expect(crisisReading.score).toBe(100);
      expect(crisisReading.factorsEs.some((f) => f.includes('0 PG'))).toBe(true);
    });
  });

  describe('computeMacroStoryArc', () => {
    it('tracks Acts I-IV and raises stagnation warning after 5 non-transition events', () => {
      const initial = createAguasQuietasInitialState();

      const act1 = computeMacroStoryArc(initial, []);
      expect(act1.actNumber).toBe(1);
      expect(act1.stagnationWarningEs).toBeNull();

      // 5 active checks without a scene transition triggers stagnation warning
      const stagnantEvents = [
        makeEvent(1, 'CHECK_RESOLVED', { success: true }),
        makeEvent(2, 'CHECK_RESOLVED', { success: false }),
        makeEvent(3, 'CLUES_UNLOCKED', {}),
        makeEvent(4, 'CHECK_RESOLVED', { success: true }),
        makeEvent(5, 'CHECK_RESOLVED', { success: true }),
      ];
      const stagnant = computeMacroStoryArc(initial, stagnantEvents);
      expect(stagnant.eventsSinceLastTransition).toBe(5);
      expect(stagnant.stagnationWarningEs).toBeTruthy();

      // A scene transition resets the stagnation counter
      const afterTransition = computeMacroStoryArc(
        { ...initial, sceneId: 'escena_04_campamento' },
        [...stagnantEvents, makeEvent(6, 'SCENE_TRANSITION', {})],
      );
      expect(afterTransition.actNumber).toBe(2);
      expect(afterTransition.eventsSinceLastTransition).toBe(0);
      expect(afterTransition.stagnationWarningEs).toBeNull();

      // Final crossing scene maps to Act IV and suppresses stagnation once completed
      const act4 = computeMacroStoryArc(
        { ...initial, sceneId: 'escena_08_otra_orilla' },
        stagnantEvents,
      );
      expect(act4.actNumber).toBe(4);
      expect(act4.stagnationWarningEs).toBeNull();
    });
  });

  describe('selectActiveNpcMinds', () => {
    it('gates NPC minds by active scene or explicit mention and adapts attitude', () => {
      const initial = createAguasQuietasInitialState();

      // On E1 with neutral input: Exploradores active, Mireia & Aldeanos hidden
      const e1Default = selectActiveNpcMinds(initial, [], 'Examino los juncos');
      expect(e1Default.map((m) => m.id)).toEqual(['exploradores_espesura']);

      // Mentioning @Mireia on E1 activates Comandante Mireia's compartmentalized mind
      const e1MentionMireia = selectActiveNpcMinds(
        initial,
        [],
        'Pregunto sobre @Mireia y su barcaza',
      );
      expect(e1MentionMireia.map((m) => m.id)).toContain('comandante_mireia');

      // On E6 with pista_mireia_14 unlocked, Mireia attitude shifts to negotiable
      const mireiaState: GameState = {
        ...initial,
        sceneId: 'escena_06_comandante',
        unlockedClues: {
          escena_06_comandante: ['pista_mireia_14'],
        },
      };
      const mireiaCards = selectActiveNpcMinds(mireiaState, [], 'Hablo con ella');
      const mireia = mireiaCards.find((c) => c.id === 'comandante_mireia');
      expect(mireia).toBeDefined();
      expect(mireia?.attitudeEs).toContain('dispuesta a pactar');

      // On E4 without infirmary clue or mention, Aldeanos hidden; with clue unlocked, activated
      const campNoClue = selectActiveNpcMinds(
        { ...initial, sceneId: 'escena_04_campamento' },
        [],
        'Observo la empalizada',
      );
      expect(campNoClue.map((c) => c.id)).not.toContain('aldeanos_ocultos');

      const campWithClue = selectActiveNpcMinds(
        {
          ...initial,
          sceneId: 'escena_04_campamento',
          unlockedClues: { escena_04_campamento: ['pista_camp_18'] },
        },
        [],
        'Observo la empalizada',
      );
      expect(campWithClue.map((c) => c.id)).toContain('aldeanos_ocultos');
    });
  });

  describe('selectMentionActivatedMemories', () => {
    const sampleFacts: FilterableMemoryFact[] = [
      {
        id: 'f1',
        category: 'promise',
        content: 'Prometiste evacuar a los niños primero.',
        importance: 9,
        eventSeq: 1,
        revertedBySeq: null,
      },
      {
        id: 'f2',
        category: 'milestone',
        content: 'Robaste el sello real del convoy.',
        importance: 8,
        eventSeq: 2,
        revertedBySeq: null,
      },
      {
        id: 'f3',
        category: 'npc',
        content: 'El herrero Barto guarda pólvora seca bajo el yunque.',
        importance: 5,
        eventSeq: 3,
        revertedBySeq: null,
      },
      {
        id: 'f4',
        category: 'lore',
        content: 'El puente viejo colapsó durante la tormenta invernal.',
        importance: 4,
        eventSeq: 4,
        revertedBySeq: null,
      },
      {
        id: 'f5',
        category: 'npc',
        content: 'Mireia desconfía de los mensajeros del sur.',
        importance: 6,
        eventSeq: 5,
        revertedBySeq: null,
      },
      {
        id: 'f6',
        category: 'npc',
        content: 'Hecho revertido que nunca debe aparecer.',
        importance: 10,
        eventSeq: 6,
        revertedBySeq: 7,
      },
    ];

    it('returns all active facts when <= 4 and filters out reverted facts', () => {
      const initial = createAguasQuietasInitialState();
      const shortList = selectMentionActivatedMemories(
        [sampleFacts[0]!, sampleFacts[2]!, sampleFacts[5]!],
        initial,
        'Nada relacionado',
      );
      expect(shortList.map((f) => f.id)).toEqual(['f1', 'f3']);
    });

    it('pins importance >= 8 facts and activates lower-importance facts only on mention/keyword match', () => {
      const initial = createAguasQuietasInitialState();
      const selected = selectMentionActivatedMemories(
        sampleFacts,
        initial,
        'Busco al herrero Barto para pedir pólvora',
      );
      const ids = selected.map((f) => f.id);
      // High-importance (>=8) pinned
      expect(ids).toContain('f1');
      expect(ids).toContain('f2');
      // Mentioned fact activated
      expect(ids).toContain('f3');
      // Unrelated low-importance facts excluded
      expect(ids).not.toContain('f4');
      expect(ids).not.toContain('f5');
      // Reverted fact excluded
      expect(ids).not.toContain('f6');
    });
  });
});
