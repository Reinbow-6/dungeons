import {
  getAdventureProgress,
  type AdventurePack,
  type AdventureProgress,
  type AlternativeEndingSpec,
  type EvaluatedEnding,
  type MainQuestSpec,
  type MainQuestStage,
} from '../adventure-pack.js';
import { AGUAS_QUIETAS_LOREBOOK } from '../lorebook.js';
import {
  createDefaultAuthority,
  type Character,
  type GameState,
  type RulesetProfile,
  type SceneDefinition,
} from '../types.js';

export type {
  AdventureProgress,
  AlternativeEndingSpec,
  EvaluatedEnding,
  MainQuestSpec,
  MainQuestStage,
};

/**
 * Grafo estructural original para la aventura introductoria "Aguas Quietas"
 * en perfil 5e lite (contenido 100% propio bajo SRD 5.2.1 CC-BY-4.0).
 */
export const AGUAS_QUIETAS_SCENES: Record<string, SceneDefinition> = {
  escena_01_orilla: {
    id: 'escena_01_orilla',
    titleEs: 'Orilla del Río Brumoso',
    shortLabelEs: 'Orilla del Río',
    baseTension: 28,
    summaryEs:
      'Islote de barro seco entre juncos junto al río fronterizo; exploradores ocultos vigilan desde la maleza.',
    narrativeHookEs:
      'Tras huir del asedio en la capital del sur, llegás al atardecer a un banco de tierra firme rodeado de ciénaga. El río es demasiado ancho para cruzarlo a nado y al este se eleva una columna de humo entre los árboles.',
    allowedTransitions: ['escena_02_batalla_orilla', 'escena_03_parlamento'],
    clues: [
      {
        id: 'pista_orilla_11',
        dc: 11,
        titleEs: 'Señales de humo controladas',
        descriptionEs:
          'El humo del este es seco y constante: proviene de un embarcadero organizado, no de un incendio del frente.',
        tacticalEffectEs:
          'Confirma que la barcaza del campamento es tu única vía viable para cruzar el río.',
      },
      {
        id: 'pista_orilla_14',
        dc: 14,
        titleEs: 'Brazaletes descosidos en los juncos',
        descriptionEs:
          'Los vigías arrancaron los emblemas militares de sus mangas: son desertores o milicia rota, no tropas del asedio.',
        tacticalEffectEs:
          'Abre margen para negociar apelando a su desconfianza hacia la capital; aporta al final alternativo Pacto de la Guardia Rota.',
      },
    ],
  },
  escena_02_batalla_orilla: {
    id: 'escena_02_batalla_orilla',
    titleEs: 'Escaramuza en la Orilla',
    shortLabelEs: 'Escaramuza',
    baseTension: 74,
    summaryEs:
      'Los exploradores se saben superados y buscan replegarse al campamento en tres rondas para dar la alarma.',
    allowedTransitions: ['escena_01_orilla', 'escena_05_asalto_campamento'],
    clues: [],
  },
  escena_03_parlamento: {
    id: 'escena_03_parlamento',
    titleEs: 'Parlamento en la Maleza',
    shortLabelEs: 'Parlamento',
    baseTension: 42,
    summaryEs:
      'Negociación tensa con los exploradores de la espesura: piden monedas o mano de obra para reparar el portón del muelle.',
    allowedTransitions: ['escena_04_campamento', 'escena_02_batalla_orilla'],
    clues: [
      {
        id: 'pista_parlamento_13',
        dc: 13,
        titleEs: 'Temor a las patrullas del norte',
        descriptionEs:
          'Los exploradores vigilan el río con más nerviosismo que a vos: necesitan reforzar el portón antes del amanecer.',
        tacticalEffectEs:
          'Te da ventaja narrativa para ofrecer ayuda técnica en lugar de monedas.',
      },
    ],
  },
  escena_04_campamento: {
    id: 'escena_04_campamento',
    titleEs: 'El Campamento del Embarcadero',
    shortLabelEs: 'Campamento',
    baseTension: 48,
    summaryEs:
      'Aldea ribereña cercada por troncos atados con sogas y un portón quemado; una barcaza espera amarrada al muelle.',
    narrativeHookEs:
      'La empalizada se alza entre la niebla húmeda. Desde las pasarelas improvisadas, vigías con el rostro pintado siguen tus movimientos sin bajar los arcos.',
    allowedTransitions: [
      'escena_06_comandante',
      'escena_04b_reparar_porton',
      'escena_05_asalto_campamento',
    ],
    transitionRequirements: {
      // El atajo directo a la Comandante exige descubrir la pista del campamento;
      // las rutas de reparar el portón o asaltar/infiltrar quedan siempre abiertas (sin soft-lock).
      'escena_04_campamento>escena_06_comandante': {
        requiredClues: ['pista_camp_14'],
      },
    },
    clues: [
      {
        id: 'pista_camp_12',
        dc: 12,
        titleEs: 'Conteo de la guarnición',
        descriptionEs:
          'Distinguís con precisión cuántos arqueros vigilan los parapetos y el patio central.',
        tacticalEffectEs:
          'Evita subestimar o sobreestimar la fuerza activa del campamento.',
      },
      {
        id: 'pista_camp_14',
        dc: 14,
        titleEs: 'Aldea tomada por la fuerza',
        descriptionEs:
          'Las puertas de las cabañas muestran marcas de hollín reciente y manchas oscuras en los umbrales.',
        tacticalEffectEs:
          'Confirma que la guarnición ocupó un caserío civil y actúa a la defensiva.',
      },
      {
        id: 'pista_camp_16',
        dc: 16,
        titleEs: 'Trofeos militares en el muro',
        descriptionEs:
          'En un lienzo lateral cuelgan cascos de patrullas regulares del norte abollando la madera.',
        tacticalEffectEs:
          'Revela choques armados recientes contra tropas locales.',
      },
      {
        id: 'pista_camp_18',
        dc: 18,
        titleEs: 'Bajas ocultas en la enfermería',
        descriptionEs:
          'Por una rendija de la lona médica ves a varios combatientes gravemente heridos incapaces de sostener un arma.',
        tacticalEffectEs:
          'Asegura que esos combatientes no participarán si estalla un enfrentamiento.',
      },
    ],
  },
  escena_04b_reparar_porton: {
    id: 'escena_04b_reparar_porton',
    titleEs: 'Reparar el Portón',
    shortLabelEs: 'Portón',
    baseTension: 52,
    summaryEs:
      'Tres tareas técnicas para reforzar bisagras dobladas, una hoja partida y madera calcinada antes de acceder al muelle.',
    allowedTransitions: ['escena_06_comandante', 'escena_05_asalto_campamento'],
    clues: [
      {
        id: 'pista_porton_14',
        dc: 14,
        titleEs: 'Rastro de cargas alquímicas',
        descriptionEs:
          'El patrón de astillado en la base del portón indica una voladura controlada con pólvora o alquimia.',
        tacticalEffectEs:
          'Abre diálogo sobre el asalto previo al convoy y la suerte de los antiguos aldeanos.',
      },
    ],
  },
  escena_05_asalto_campamento: {
    id: 'escena_05_asalto_campamento',
    titleEs: 'Asalto o Infiltración al Campamento',
    shortLabelEs: 'Asalto',
    baseTension: 84,
    summaryEs:
      'Cruzar la empalizada por sigilo o fuerza hasta soltar las amarras de la barcaza bajo fuego de los defensores.',
    allowedTransitions: ['escena_07_travesia_barcaza'],
    clues: [],
  },
  escena_06_comandante: {
    id: 'escena_06_comandante',
    titleEs: 'La Comandante Mireia',
    shortLabelEs: 'Mireia',
    baseTension: 66,
    summaryEs:
      'Interrogatorio frente a la Comandante Mireia, agotada y recelosa de infiltrados del sur, pero más interesada en proteger a los suyos que en matar por odio.',
    allowedTransitions: [
      'escena_07_travesia_barcaza',
      'escena_05_asalto_campamento',
    ],
    clues: [
      {
        id: 'pista_mireia_14',
        dc: 14,
        titleEs: 'Órdenes selladas en la mesa de Mireia',
        descriptionEs:
          'Un pliego con sello real roto revela que Mireia desertó para sacar civiles del asedio, no para saquear la frontera.',
        tacticalEffectEs:
          'Desbloquea una salida diplomática decisiva con la Comandante y aporta al final alternativo Pacto de la Guardia Rota.',
      },
    ],
  },
  escena_07_travesia_barcaza: {
    id: 'escena_07_travesia_barcaza',
    titleEs: 'Travesía en Barcaza',
    shortLabelEs: 'Barcaza',
    baseTension: 88,
    summaryEs:
      'Cuatro rondas tirando de la cadena mientras necrófagos de río emergen de las aguas oscuras.',
    allowedTransitions: ['escena_08_otra_orilla'],
    clues: [],
  },
  escena_08_otra_orilla: {
    id: 'escena_08_otra_orilla',
    titleEs: 'La Otra Orilla',
    shortLabelEs: 'Otra Orilla',
    baseTension: 14,
    summaryEs:
      'La barcaza toca tierra norte y los bosques fronterizos ofrecen resguardo temporal lejos del frente.',
    allowedTransitions: [],
    clues: [],
  },
};

export interface CreateAguasQuietasOptions {
  campaignId?: string;
  sessionId?: string;
  ruleset?: RulesetProfile;
  hybrid?: boolean;
}

export function createAguasQuietasInitialState(
  options: CreateAguasQuietasOptions = {},
): GameState {
  const campaignId = options.campaignId ?? 'camp_aguas_quietas';
  const sessionId = options.sessionId ?? 'sess_01';
  const ruleset: RulesetProfile = options.ruleset ?? '5e-lite';
  const hybrid = options.hybrid ?? false;

  const kael: Character = {
    id: 'pc_kael',
    name: 'Kael de Oakhaven',
    species: 'Elfo del Bosque',
    className: 'Explorador',
    level: 1,
    abilities: {
      str: 12, // +1
      dex: 16, // +3
      con: 12, // +1
      int: 14, // +2
      wis: 14, // +2
      cha: 10, // +0
    },
    skillProficiencies: {
      investigation: 'proficient', // +2 int +2 pb = +4
      perception: 'proficient', // +2 wis +2 pb = +4
      stealth: 'proficient', // +3 dex +2 pb = +5
      survival: 'proficient', // +2 wis +2 pb = +4
    },
    savingThrowProficiencies: ['str', 'dex'],
    hp: {
      current: 11,
      max: 11,
      temp: 0,
    },
    ac: 14,
    speed: 35,
    conditions: [],
    exhaustionLevel: 0,
    inventory: [
      { itemId: 'shortbow', name: 'Arco corto', quantity: 1 },
      { itemId: 'shortsword', name: 'Espada corta', quantity: 1 },
      { itemId: 'rations', name: 'Raciones de viaje', quantity: 3 },
    ],
    spellSlots: {},
    concentratingOn: null,
    authority: createDefaultAuthority(hybrid ? 'hybrid' : 'digital'),
    rollAuthority: hybrid ? 'player-declared' : 'engine-rolled',
  };

  return {
    campaignId,
    sessionId,
    adventureId: 'aguas-quietas',
    ruleset,
    sceneId: 'escena_01_orilla',
    lastSeq: 0,
    characters: {
      [kael.id]: kael,
    },
    flags: {},
    unlockedClues: {},
    scenes: AGUAS_QUIETAS_SCENES,
  };
}

export const AGUAS_INQUIETAS_QUEST: MainQuestSpec = {
  id: 'quest_aguas_inquietas',
  titleEs: 'Cruzar las Aguas Inquietas',
  objectiveEs:
    'Conseguí paso en la barcaza del Campamento del Embarcadero y cruzá el río fronterizo hacia la Otra Orilla antes de que el frente te alcance.',
  stages: [
    {
      id: 'stage_1_orilla',
      order: 1,
      titleEs: 'Salir de la Orilla',
      actTitleEs: 'Acto I · Huida en la Orilla',
      dramaticBeatEs: 'Planteamiento',
      goalEs: 'Superá o negociá con los vigías ocultos entre los juncos para llegar al campamento.',
      sceneIds: ['escena_01_orilla', 'escena_02_batalla_orilla', 'escena_03_parlamento'],
    },
    {
      id: 'stage_2_campamento',
      order: 2,
      titleEs: 'El Campamento del Embarcadero',
      actTitleEs: 'Acto II · El Embarcadero',
      dramaticBeatEs: 'Complicación',
      goalEs: 'Investigá la guarnición, repará el portón o prepará una infiltración hacia el muelle.',
      sceneIds: ['escena_04_campamento', 'escena_04b_reparar_porton'],
    },
    {
      id: 'stage_3_decision',
      order: 3,
      titleEs: 'Asegurar la Barcaza',
      actTitleEs: 'Acto III · Punto de Quiebre',
      dramaticBeatEs: 'Crisis',
      goalEs: 'Enfrentá el interrogatorio de la Comandante Mireia o tomá la barcaza por fuerza o sigilo.',
      sceneIds: ['escena_05_asalto_campamento', 'escena_06_comandante'],
    },
    {
      id: 'stage_4_cruce',
      order: 4,
      titleEs: 'Travesía hacia la Otra Orilla',
      actTitleEs: 'Acto IV · El Cruce Final',
      dramaticBeatEs: 'Clímax y Resolución',
      goalEs: 'Sobreviví al cruce del río infestado de necrófagos y alcanzá tierra firme al norte.',
      sceneIds: ['escena_07_travesia_barcaza', 'escena_08_otra_orilla'],
    },
  ],
  endings: [
    {
      id: 'final_escape_niebla',
      titleEs: 'Escape en la Niebla',
      summaryEs:
        'Lográs cruzar el río dejando atrás el campamento sumido en la desconfianza.',
      isStandard: true,
      requiredClueGroups: [],
      hintEs: 'Final estándar al llegar a la Otra Orilla.',
    },
    {
      id: 'final_pacto_guardia_rota',
      titleEs: 'Pacto de la Guardia Rota',
      summaryEs:
        'Exponés que conocés la deserción humanitaria de Mireia; ella escolta el cruce y se convierte en aliada en el norte.',
      requiredClueGroups: [
        ['pista_orilla_14', 'pista_camp_14'],
        ['pista_mireia_14', 'pista_porton_14'],
      ],
      hintEs:
        'Descubrí pruebas sobre los desertores/aldea (Orilla o Campamento) y sobre las órdenes de Mireia o el portón.',
    },
    {
      id: 'final_verdad_convoy',
      titleEs: 'Verdad del Convoy Caído',
      summaryEs:
        'Atás cabos entre la voladura alquímica, los cascos del norte y la enfermería para evacuar a los sobrevivientes sin derramar sangre.',
      requiredClueGroups: [
        ['pista_camp_16'],
        ['pista_porton_14'],
        ['pista_camp_18'],
      ],
      hintEs:
        'Reuní 3 pistas clave del campamento y el portón (Trofeos militares, Cargas alquímicas y Bajas ocultas).',
    },
    {
      id: 'final_golpe_fantasma',
      titleEs: 'Golpe Fantasma',
      summaryEs:
        'Aprovechando el conteo exacto de vigías y sabiendo qué defensores están heridos, robás la barcaza sin dar alarma.',
      requiredClueGroups: [['pista_camp_12'], ['pista_camp_18']],
      hintEs:
        'Investigá el Campamento para obtener el Conteo de la guarnición y las Bajas ocultas en la enfermería.',
    },
  ],
};

export const AGUAS_QUIETAS_PACK: AdventurePack = {
  schemaVersion: 1,
  id: 'aguas-quietas',
  titleEs: 'Aguas Quietas',
  subtitleEs: 'Frontera del Río Brumoso · Aventura introductoria',
  worldSummaryEs: 'Frontera pantanosa del norte tras la caída de la capital del sur.',
  tonePromptEs:
    'Fantasía oscura realista: refugiados huyendo del frente, desconfianza entre facciones y decisiones morales grises sin respuestas fáciles.',
  recommendedLevels: { min: 1, max: 2 },
  recommendedRuleset: '5e-full',
  initialSceneId: 'escena_01_orilla',
  epilogueSceneIds: ['escena_08_otra_orilla'],
  scenes: AGUAS_QUIETAS_SCENES,
  quest: AGUAS_INQUIETAS_QUEST,
  intro: {
    soloParagraphsEs: [
      'Tras huir del asedio en la capital del sur, llegás al atardecer a un banco de tierra firme rodeado de ciénaga. El río es demasiado ancho para cruzarlo a nado y al este se eleva una columna de humo entre los árboles.',
      'El agua oscura del río fronterizo arrastra ramas y ceniza, demasiado ancha y helada para cruzarla a nado. A tus pies el barro cruje bajo las botas, {{charName}}; entre los juncos altos creés distinguir el roce seco de madera tensada y figuras inmóviles midiendo cada uno de tus pasos. La iniciativa es tuya: ¿qué hacés?',
    ],
    groupParagraphsEs: [
      'Tras huir del asedio en la capital del sur, llegan al atardecer a un banco de tierra firme rodeado de ciénaga. El río es demasiado ancho para cruzarlo a nado y al este se eleva una columna de humo entre los árboles.',
      'El agua oscura del río fronterizo arrastra ramas y ceniza, demasiado ancha y helada para cruzarla a nado. Bajo las botas de **{{partyNames}}** el barro cruje entre los juncos altos; a lo lejos se distingue el roce seco de madera tensada y figuras inmóviles midiendo cada uno de sus pasos. La iniciativa es suya: ¿qué hacen?',
    ],
    suggestedActions: [
      {
        skill: 'Percepción',
        tone: 'blue',
        label: 'Escudriñar los juncos y la niebla antes de avanzar',
      },
      {
        skill: 'Persuasión',
        tone: 'violet',
        label: 'Alzar las manos y parlamentar con quienes vigilan desde la maleza',
      },
      {
        skill: 'Sigilo',
        tone: 'emerald',
        label: 'Deslizarte en silencio hacia la columna de humo al este',
      },
    ],
  },
  bestiary: [
    {
      id: 'explorador_espesura',
      nameEs: 'Explorador de la Espesura',
      srdBaseIndex: 'scout',
      cr: 0.5,
      ac: 13,
      hp: 16,
      speedTextEs: '30 pies',
      abilities: { str: 11, dex: 14, con: 12, int: 11, wis: 13, cha: 11 },
      skills: { perception: 5, stealth: 5, survival: 5 },
      vulnerabilities: [],
      immunities: [],
      traitsEs: [
        'Ojos de la Ciénaga: ventaja en Sigilo al ocultarse entre maleza o niebla ribereña.',
        'Retirada Táctica: si se ve superado en la orilla, prioriza replegarse en 3 rondas para dar la alarma.',
      ],
      attacks: [
        {
          nameEs: 'Arco largo',
          kind: 'ranged',
          attackBonus: 4,
          damageDice: '1d8+2',
          damageType: 'piercing',
          rangeText: '150/600 pies',
        },
        {
          nameEs: 'Espada corta',
          kind: 'melee',
          attackBonus: 4,
          damageDice: '1d6+2',
          damageType: 'piercing',
          rangeText: '5 pies',
        },
      ],
      rulesetVersion: '5.2.1',
    },
    {
      id: 'necrofago_de_rio',
      nameEs: 'Necrófago de río',
      srdBaseIndex: 'ghoul',
      cr: 0.5,
      ac: 12,
      hp: 18,
      speedTextEs: '30 pies, nadar 30 pies',
      abilities: { str: 13, dex: 14, con: 10, int: 7, wis: 10, cha: 6 },
      skills: { stealth: 4 },
      vulnerabilities: ['fire'],
      immunities: ['poison'],
      traitsEs: [
        'Anfibio: puede respirar aire y permanecer sumergido bajo el río sin penalizaciones.',
        'Instinto Depredador: persigue presas hacia la orilla durante 1 ronda antes de volver a lo profundo.',
      ],
      attacks: [
        {
          nameEs: 'Garras fangosas',
          kind: 'melee',
          attackBonus: 4,
          damageDice: '1d6+2',
          damageType: 'slashing',
          rangeText: '5 pies',
        },
      ],
      rulesetVersion: '5.2.1',
    },
    {
      id: 'comandante_mireia',
      nameEs: 'Comandante Mireia',
      srdBaseIndex: 'bandit-captain',
      cr: 2,
      ac: 15,
      hp: 38,
      speedTextEs: '30 pies',
      abilities: { str: 14, dex: 16, con: 14, int: 13, wis: 14, cha: 14 },
      skills: { insight: 4, perception: 4, stealth: 5 },
      vulnerabilities: [],
      immunities: [],
      traitsEs: [
        'Liderazgo Desgastado: mientras Mireia siga en pie, los Exploradores de la Espesura no huyen del campamento.',
        'Supervivencia sobre Odio: prefiere evitar bajas inútiles si comprueba que los viajeros no son espías del sur.',
      ],
      attacks: [
        {
          nameEs: 'Espada larga curva',
          kind: 'melee',
          attackBonus: 5,
          damageDice: '1d8+3',
          damageType: 'slashing',
          rangeText: '5 pies',
        },
        {
          nameEs: 'Arco largo',
          kind: 'ranged',
          attackBonus: 5,
          damageDice: '1d8+3',
          damageType: 'piercing',
          rangeText: '150/600 pies',
        },
      ],
      rulesetVersion: '5.2.1',
    },
  ],
  lorebook: [...AGUAS_QUIETAS_LOREBOOK],
  npcMinds: [
    {
      id: 'comandante_mireia',
      nameEs: 'Comandante Mireia',
      roleEs: 'Líder de la guarnición del embarcadero',
      activeSceneIds: ['escena_06_comandante'],
      triggerKeywords: ['mireia', 'comandante', 'jefa', 'barcaza', 'ordenes'],
      knowsEs:
        'Sabe que su tropa está mermada por bajas y que las patrullas del norte y del sur los persiguen.',
      doesNotKnowEs:
        'Ignora qué descubriste en la orilla o en la enfermería salvo que se lo digas explícitamente.',
      wantsEs:
        'Proteger a los civiles refugiados bajo su mando y evitar espías del asedio en el cruce.',
      hidesEs:
        'Desertó con órdenes reales rotas para evacuar civiles; mantiene una fachada dura para ocultar que casi no le quedan combatientes sanos.',
      defaultAttitudeEs:
        'Cautelosa, agotada y pragmática; respeta la franqueza y la utilidad.',
      attitudeRules: [
        {
          requiresClueId: 'pista_mireia_14',
          attitudeEs:
            'Recelosa al inicio, pero dispuesta a pactar si le demostrás que conocés sus verdaderas órdenes.',
        },
        {
          requiresCombat: true,
          attitudeEs: 'Muy hostil y a la defensiva por el choque armado previo.',
        },
      ],
    },
    {
      id: 'exploradores_espesura',
      nameEs: 'Exploradores de la Espesura',
      roleEs: 'Vigías y milicia fronteriza',
      activeSceneIds: [
        'escena_01_orilla',
        'escena_02_batalla_orilla',
        'escena_03_parlamento',
        'escena_04b_reparar_porton',
      ],
      triggerKeywords: [
        'explorador',
        'exploradores',
        'vigia',
        'vigias',
        'arquero',
        'juncos',
        'maleza',
        'porton',
      ],
      knowsEs:
        'Conocen los senderos de la ciénaga, el estado dañado del portón y que Mireia controla la única barcaza.',
      doesNotKnowEs:
        'Desconocen el contenido de las órdenes selladas de Mireia y los planes del frente al sur.',
      wantsEs:
        'Evitar una emboscada, conseguir manos para reparar el portón o monedas sin perder hombres.',
      hidesEs:
        'Se quitaron las insignias del ejército y temen una incursión nocturna desde el río.',
      defaultAttitudeEs:
        'Desconfiados, arcos tensados, midiendo si sos espía o refugiado.',
      attitudeRules: [
        {
          requiresCombat: true,
          attitudeEs:
            'Alarma máxima: buscan replegarse al campamento para avisar a Mireia.',
        },
        {
          requiresClueId: 'pista_orilla_14',
          attitudeEs:
            'Nerviosos pero negociables si les hablás como sobreviviente y no como soldado.',
        },
        {
          requiresClueId: 'pista_parlamento_13',
          attitudeEs:
            'Nerviosos pero negociables si les hablás como sobreviviente y no como soldado.',
        },
      ],
    },
    {
      id: 'aldeanos_ocultos',
      nameEs: 'Sobrevivientes de la Enfermería',
      roleEs: 'Heridos y antiguos civiles del caserío',
      activeSceneIds: [],
      triggerKeywords: ['enfermeria', 'heridos', 'aldeanos', 'civiles', 'lona'],
      revealInSceneWhenAnyClue: {
        sceneId: 'escena_04_campamento',
        clueIds: ['pista_camp_18', 'pista_camp_14'],
      },
      knowsEs:
        'Saben cuántos defensores están fuera de combate y recuerdan la voladura del portón.',
      doesNotKnowEs: 'No saben quién sos ni qué acordaste fuera de la empalizada.',
      wantsEs: 'Cruzar el río con vida sin quedar atrapados en otro tiroteo.',
      hidesEs:
        'Guarda silencio por miedo a represalias si estalla un motín en el campamento.',
      defaultAttitudeEs:
        'Temerosos pero agradecidos ante cualquier muestra de curación o compasión.',
    },
  ],
};

export const BUILTIN_ADVENTURE_PACKS: Record<string, AdventurePack> = {
  [AGUAS_QUIETAS_PACK.id]: AGUAS_QUIETAS_PACK,
};

export function getAguasInquietasProgress(state: GameState): AdventureProgress {
  return getAdventureProgress(state, AGUAS_QUIETAS_PACK);
}
