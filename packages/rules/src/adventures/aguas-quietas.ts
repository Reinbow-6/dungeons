import {
  createDefaultAuthority,
  type Character,
  type GameState,
  type RulesetProfile,
  type SceneDefinition,
} from '../types.js';

/**
 * Grafo estructural original para la aventura introductoria "Aguas Quietas"
 * en perfil 5e lite (contenido 100% propio bajo SRD 5.2.1 CC-BY-4.0).
 */
export const AGUAS_QUIETAS_SCENES: Record<string, SceneDefinition> = {
  escena_01_orilla: {
    id: 'escena_01_orilla',
    titleEs: 'Orilla del Río Brumoso',
    summaryEs:
      'Islote de barro seco entre juncos junto al río fronterizo; exploradores ocultos vigilan desde la maleza.',
    narrativeHookEs:
      'Tras huir del asedio en la capital del sur, llegás al atardecer a un banco de tierra firme rodeado de ciénaga. El río es demasiado ancho para cruzarlo a nado y al este se eleva una columna de humo entre los árboles.',
    allowedTransitions: ['escena_02_batalla_orilla', 'escena_03_parlamento'],
    clues: [],
  },
  escena_02_batalla_orilla: {
    id: 'escena_02_batalla_orilla',
    titleEs: 'Escaramuza en la Orilla',
    summaryEs:
      'Los exploradores se saben superados y buscan replegarse al campamento en tres rondas para dar la alarma.',
    allowedTransitions: ['escena_01_orilla', 'escena_05_asalto_campamento'],
    clues: [],
  },
  escena_03_parlamento: {
    id: 'escena_03_parlamento',
    titleEs: 'Parlamento en la Maleza',
    summaryEs:
      'Negociación tensa con los exploradores de la espesura: piden monedas o mano de obra para reparar el portón del muelle.',
    allowedTransitions: ['escena_04_campamento', 'escena_02_batalla_orilla'],
    clues: [],
  },
  escena_04_campamento: {
    id: 'escena_04_campamento',
    titleEs: 'El Campamento del Embarcadero',
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
    summaryEs:
      'Cruzar la empalizada por sigilo o fuerza hasta soltar las amarras de la barcaza bajo fuego de los defensores.',
    allowedTransitions: ['escena_07_travesia_barcaza'],
    clues: [],
  },
  escena_06_comandante: {
    id: 'escena_06_comandante',
    titleEs: 'La Comandante Mireia',
    summaryEs:
      'Interrogatorio frente a la Comandante Mireia, agotada y recelosa de infiltrados del sur, pero más interesada en proteger a los suyos que en matar por odio.',
    allowedTransitions: [
      'escena_07_travesia_barcaza',
      'escena_05_asalto_campamento',
    ],
    clues: [],
  },
  escena_07_travesia_barcaza: {
    id: 'escena_07_travesia_barcaza',
    titleEs: 'Travesía en Barcaza',
    summaryEs:
      'Cuatro rondas tirando de la cadena mientras necrófagos de río emergen de las aguas oscuras.',
    allowedTransitions: ['escena_08_otra_orilla'],
    clues: [],
  },
  escena_08_otra_orilla: {
    id: 'escena_08_otra_orilla',
    titleEs: 'La Otra Orilla',
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
