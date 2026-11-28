import { describe, expect, it } from 'vitest';
import {
  AdventurePackSchema,
  AGUAS_QUIETAS_PACK,
  computeMacroStoryArc,
  computeTensionMeter,
  getAdventureProgress,
  selectActiveNpcMinds,
  validateAdventurePackGraph,
  type AdventurePack,
  type GameState,
} from '../src/index.js';

function makeCustomPack(): AdventurePack {
  return {
    schemaVersion: 1,
    id: 'cripta-niebla',
    titleEs: 'La Cripta de la Niebla',
    subtitleEs: 'One-shot de prueba',
    worldSummaryEs: 'Aldea aislada entre bosques de bruma.',
    tonePromptEs: 'Horror gótico sobrio y tensión contenida.',
    recommendedLevels: { min: 1, max: 3 },
    recommendedRuleset: '5e-full',
    initialSceneId: 'entrada_cripta',
    epilogueSceneIds: ['salida_alba'],
    scenes: {
      entrada_cripta: {
        id: 'entrada_cripta',
        titleEs: 'Atrio de Piedra',
        shortLabelEs: 'Atrio',
        baseTension: 32,
        summaryEs: 'Portón cubierto de musgo ante una cripta silenciosa.',
        narrativeHookEs: 'La verja de hierro chirría bajo la lluvia.',
        allowedTransitions: ['camara_sarcofago'],
        clues: [
          {
            id: 'pista_atrio_12',
            dc: 12,
            titleEs: 'Rastro de ceniza fresca',
            descriptionEs: 'Alguien encendió una antorcha aquí hace menos de una hora.',
            tacticalEffectEs: 'Evita caer por sorpresa en la cámara.',
          },
        ],
      },
      camara_sarcofago: {
        id: 'camara_sarcofago',
        titleEs: 'Cámara del Sarcófago',
        baseTension: 78,
        summaryEs: 'Salón abovedado con un ataúd abierto.',
        allowedTransitions: ['salida_alba'],
        clues: [
          {
            id: 'pista_sarcofago_15',
            dc: 15,
            titleEs: 'Medallón de plata oculto',
            descriptionEs: 'Descansa entre los pliegues de una túnica antigua.',
            tacticalEffectEs: 'Habilita el final verdadero.',
          },
        ],
      },
      salida_alba: {
        id: 'salida_alba',
        titleEs: 'Sendero del Alba',
        baseTension: 10,
        summaryEs: 'Regreso seguro antes del amanecer.',
        allowedTransitions: [],
        clues: [],
      },
    },
    quest: {
      id: 'quest_cripta',
      titleEs: 'Sellar la Cripta',
      objectiveEs: 'Descubrí qué perturbó el descanso del valle y escapá con vida.',
      stages: [
        {
          id: 'etapa_1',
          order: 1,
          titleEs: 'Explorar el umbral',
          actTitleEs: 'Acto I · El Umbral',
          dramaticBeatEs: 'Apertura',
          goalEs: 'Ingresar a la cámara interior.',
          sceneIds: ['entrada_cripta', 'camara_sarcofago'],
        },
        {
          id: 'etapa_2',
          order: 2,
          titleEs: 'Escape al alba',
          actTitleEs: 'Acto II · Amanecer',
          dramaticBeatEs: 'Cierre',
          goalEs: 'Alcanzar el sendero del alba.',
          sceneIds: ['salida_alba'],
        },
      ],
      endings: [
        {
          id: 'final_estandar',
          titleEs: 'Supervivientes de la Bruma',
          summaryEs: 'Escapaste de la cripta antes del alba.',
          isStandard: true,
          requiredClueGroups: [],
          hintEs: 'Llegar al sendero del alba.',
        },
        {
          id: 'final_medallon',
          titleEs: 'El Medallón Recuperado',
          summaryEs: 'Sellaste la cripta devolviendo el medallón ancestral.',
          requiredClueGroups: [['pista_sarcofago_15']],
          hintEs: 'Encontrás el medallón en la cámara del sarcófago.',
        },
      ],
    },
    intro: {
      soloParagraphsEs: ['La niebla abraza a {{charName}} frente al portón.'],
      groupParagraphsEs: ['La niebla rodea a **{{partyNames}}** frente al portón.'],
      suggestedActions: [
        {
          skill: 'Percepción',
          tone: 'blue',
          label: 'Examinar el portón de hierro',
        },
      ],
    },
    bestiary: [
      {
        id: 'guardian_esqueleto',
        nameEs: 'Guardián Esqueleto',
        cr: 0.5,
        ac: 13,
        hp: 15,
        speedTextEs: '30 pies',
        abilities: { str: 10, dex: 14, con: 12, int: 6, wis: 8, cha: 5 },
        skills: {},
        vulnerabilities: ['bludgeoning'],
        immunities: ['poison'],
        traitsEs: ['Centinela eterno.'],
        attacks: [
          {
            nameEs: 'Espada oxidada',
            kind: 'melee',
            attackBonus: 4,
            damageDice: '1d6+2',
            damageType: 'slashing',
            rangeText: '5 pies',
          },
        ],
      },
    ],
    lorebook: [
      {
        id: 'lore_cripta',
        titleEs: 'Cripta del Valle',
        category: 'location',
        keywords: ['cripta', 'atrio'],
        priority: 80,
        contentEs: 'Mausoleo antiguo sellado hace un siglo.',
      },
    ],
    npcMinds: [
      {
        id: 'sepulturero',
        nameEs: 'Aldous el Sepulturero',
        roleEs: 'Vigilante del cementerio',
        activeSceneIds: ['entrada_cripta'],
        triggerKeywords: ['sepulturero', 'aldous'],
        knowsEs: 'Escuchó pasos dentro la noche anterior.',
        doesNotKnowEs: 'No sabe quién robó el medallón.',
        wantsEs: 'Que cierren la cripta cuanto antes.',
        hidesEs: 'Olvidó cerrar el candado principal.',
        defaultAttitudeEs: 'Nervioso pero cooperativo.',
        attitudeRules: [
          {
            requiresClueId: 'pista_atrio_12',
            attitudeEs: 'Aliviado al ver que notaste la ceniza fresca.',
          },
        ],
      },
    ],
  };
}

describe('AdventurePack schema, graph validator & decoupled narrative engine', () => {
  it('validates AGUAS_QUIETAS_PACK against AdventurePackSchema and graph validator', () => {
    const parsed = AdventurePackSchema.safeParse(AGUAS_QUIETAS_PACK);
    expect(parsed.success).toBe(true);

    const validation = validateAdventurePackGraph(AGUAS_QUIETAS_PACK);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);
    expect(validation.warnings).toEqual([]);
    expect(validation.stats.scenes).toBe(9);
    expect(validation.stats.reachableScenes).toBe(9);
    expect(validation.stats.creatures).toBe(3);
  });

  it('flags broken references, duplicate IDs, and unreachable scenes', () => {
    const broken = makeCustomPack();
    broken.scenes.entrada_cripta!.allowedTransitions.push('escena_fantasma');
    broken.scenes.isla_muerta = {
      id: 'isla_muerta',
      titleEs: 'Isla Muerta',
      summaryEs: 'Sin conexión.',
      allowedTransitions: [],
      clues: [
        {
          id: 'pista_atrio_12', // duplicada!
          dc: 10,
          titleEs: 'Duplicada',
          descriptionEs: 'Desc',
          tacticalEffectEs: 'Fx',
        },
      ],
    };

    const res = validateAdventurePackGraph(broken);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('escena_fantasma'))).toBe(true);
    expect(res.errors.some((e) => e.includes('pista_atrio_12'))).toBe(true);
    expect(res.warnings.some((w) => w.includes('isla_muerta'))).toBe(true);
  });

  it('computes progress, tension, macro arc, and NPC minds for custom AdventurePacks', () => {
    const custom = makeCustomPack();
    const state: GameState = {
      campaignId: 'camp_custom',
      sessionId: 'sess_1',
      adventureId: custom.id,
      ruleset: '5e-full',
      sceneId: 'camara_sarcofago',
      lastSeq: 1,
      characters: {},
      flags: {},
      unlockedClues: {
        entrada_cripta: ['pista_atrio_12'],
        camara_sarcofago: ['pista_sarcofago_15'],
      },
      scenes: custom.scenes,
    };

    const progress = getAdventureProgress(state, custom);
    expect(progress.completed).toBe(false);
    expect(progress.discoveredCount).toBe(2);
    expect(progress.unlockedAlternativeEndings.map((e) => e.id)).toEqual([
      'final_medallon',
    ]);

    const tension = computeTensionMeter(state, [], custom);
    expect(tension.score).toBe(78);

    const arc = computeMacroStoryArc(state, [], custom);
    expect(arc.actTitleEs).toBe('Acto I · El Umbral');
    expect(arc.dramaticBeatEs).toBe('Apertura');

    const npcs = selectActiveNpcMinds(state, [], 'Hablar con Aldous', custom);
    expect(npcs).toHaveLength(1);
    expect(npcs[0]?.attitudeEs).toContain('ceniza fresca');

    const completedState: GameState = { ...state, sceneId: 'salida_alba' };
    expect(getAdventureProgress(completedState, custom).completed).toBe(true);
  });
});
