import type { GameState } from './types.js';

export type LorebookCategory =
  | 'faction'
  | 'location'
  | 'npc'
  | 'creature'
  | 'world'
  | 'item';

export interface LorebookEntry {
  id: string;
  titleEs: string;
  category: LorebookCategory;
  keywords: string[];
  secondaryKeywords?: string[];
  activeSceneIds?: string[];
  /** Anti-spoiler guard: if non-empty, at least one listed clue must be unlocked in state.unlockedClues. */
  requiresAnyClue?: string[];
  constant?: boolean;
  /** 1-100; higher priority enters first when tokenBudget is constrained. */
  priority: number;
  contentEs: string;
}

export type LorebookActivationReason =
  | 'constant'
  | 'scene'
  | 'keyword'
  | 'recursive';

export interface ActivatedLorebookEntry {
  entry: LorebookEntry;
  reason: LorebookActivationReason;
  matchedKeywords: string[];
  estimatedTokens: number;
}

export interface LorebookSelectionOptions {
  scanDepth?: number;
  tokenBudget?: number;
  maxEntries?: number;
  recursionDepth?: number;
}

export interface LorebookSelectionResult {
  entries: ActivatedLorebookEntry[];
  usedTokens: number;
  tokenBudget: number;
  droppedCount: number;
  scannedMessages: number;
}

const DEFAULT_SCAN_DEPTH = 4;
const DEFAULT_TOKEN_BUDGET = 450;
const DEFAULT_MAX_ENTRIES = 6;
const DEFAULT_RECURSION_DEPTH = 1;

export function normalizeForLoreMatch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function estimateLorebookTokens(entry: LorebookEntry): number {
  return Math.ceil((entry.titleEs.length + entry.contentEs.length + 24) / 4);
}

function collectUnlockedClues(state: GameState): Set<string> {
  const unlocked = new Set<string>();
  for (const ids of Object.values(state.unlockedClues)) {
    for (const id of ids) {
      unlocked.add(id);
    }
  }
  return unlocked;
}

function findMatchingKeywords(
  keywords: readonly string[],
  haystack: string,
): string[] {
  if (!haystack || keywords.length === 0) return [];
  const matched: string[] = [];
  for (const rawKw of keywords) {
    const kw = normalizeForLoreMatch(rawKw.trim());
    if (kw.length > 0 && haystack.includes(kw)) {
      matched.push(rawKw);
    }
  }
  return matched;
}

function matchesEntryKeywords(
  entry: LorebookEntry,
  haystack: string,
): string[] | null {
  const primaryMatches = findMatchingKeywords(entry.keywords, haystack);
  if (primaryMatches.length === 0) {
    return null;
  }

  if (entry.secondaryKeywords && entry.secondaryKeywords.length > 0) {
    const secondaryMatches = findMatchingKeywords(
      entry.secondaryKeywords,
      haystack,
    );
    if (secondaryMatches.length === 0) {
      return null;
    }
    return [...primaryMatches, ...secondaryMatches];
  }

  return primaryMatches;
}

/**
 * Selects World Info / Lorebook entries on demand based on recent conversation
 * texts, active scene, unlocked clues (anti-spoiler), recursion, and token budget.
 */
export function selectLorebookEntries(
  catalog: readonly LorebookEntry[],
  state: GameState,
  recentTexts: readonly string[],
  options?: LorebookSelectionOptions,
): LorebookSelectionResult {
  const scanDepth = Math.max(0, options?.scanDepth ?? DEFAULT_SCAN_DEPTH);
  const tokenBudget = Math.max(0, options?.tokenBudget ?? DEFAULT_TOKEN_BUDGET);
  const maxEntries = Math.max(0, options?.maxEntries ?? DEFAULT_MAX_ENTRIES);
  const recursionDepth = Math.max(
    0,
    options?.recursionDepth ?? DEFAULT_RECURSION_DEPTH,
  );

  const nonEmptyTexts = recentTexts
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  const scannedSlice =
    scanDepth > 0 ? nonEmptyTexts.slice(-scanDepth) : ([] as string[]);
  const sceneTitle = state.scenes[state.sceneId]?.titleEs ?? '';
  const initialHaystack = normalizeForLoreMatch(
    [...scannedSlice, sceneTitle].filter(Boolean).join(' '),
  );

  const unlockedClues = collectUnlockedClues(state);
  const eligibleCatalog = catalog.filter((entry) => {
    if (!entry.requiresAnyClue || entry.requiresAnyClue.length === 0) {
      return true;
    }
    return entry.requiresAnyClue.some((clueId) => unlockedClues.has(clueId));
  });

  const activatedMap = new Map<string, ActivatedLorebookEntry>();
  let lastPassEntries: ActivatedLorebookEntry[] = [];

  // First pass: constant, active scene, and direct keyword matches
  for (const entry of eligibleCatalog) {
    let reason: LorebookActivationReason | null = null;
    let matchedKeywords: string[] = [];

    if (entry.constant) {
      reason = 'constant';
    } else if (entry.activeSceneIds?.includes(state.sceneId)) {
      reason = 'scene';
      matchedKeywords = matchesEntryKeywords(entry, initialHaystack) ?? [];
    } else {
      const kwMatches = matchesEntryKeywords(entry, initialHaystack);
      if (kwMatches) {
        reason = 'keyword';
        matchedKeywords = kwMatches;
      }
    }

    if (reason) {
      const item: ActivatedLorebookEntry = {
        entry,
        reason,
        matchedKeywords,
        estimatedTokens: estimateLorebookTokens(entry),
      };
      activatedMap.set(entry.id, item);
      lastPassEntries.push(item);
    }
  }

  // Recursive passes: entries activated in the previous pass can trigger further entries
  for (
    let depth = 0;
    depth < recursionDepth && lastPassEntries.length > 0;
    depth += 1
  ) {
    const recursionHaystack = normalizeForLoreMatch(
      lastPassEntries
        .map((item) => `${item.entry.titleEs} ${item.entry.contentEs}`)
        .join(' '),
    );
    const nextPassEntries: ActivatedLorebookEntry[] = [];

    for (const entry of eligibleCatalog) {
      if (activatedMap.has(entry.id)) continue;
      const kwMatches = matchesEntryKeywords(entry, recursionHaystack);
      if (kwMatches) {
        const item: ActivatedLorebookEntry = {
          entry,
          reason: 'recursive',
          matchedKeywords: kwMatches,
          estimatedTokens: estimateLorebookTokens(entry),
        };
        activatedMap.set(entry.id, item);
        nextPassEntries.push(item);
      }
    }

    lastPassEntries = nextPassEntries;
  }

  const orderedCandidates = Array.from(activatedMap.values()).sort((a, b) => {
    const aConst = a.entry.constant ? 1 : 0;
    const bConst = b.entry.constant ? 1 : 0;
    if (aConst !== bConst) return bConst - aConst;

    if (a.entry.priority !== b.entry.priority) {
      return b.entry.priority - a.entry.priority;
    }

    const aRec = a.reason === 'recursive' ? 1 : 0;
    const bRec = b.reason === 'recursive' ? 1 : 0;
    if (aRec !== bRec) return aRec - bRec;

    return a.entry.id.localeCompare(b.entry.id);
  });

  const selected: ActivatedLorebookEntry[] = [];
  let usedTokens = 0;
  let droppedCount = 0;

  for (const candidate of orderedCandidates) {
    if (selected.length >= maxEntries) {
      droppedCount += 1;
      continue;
    }
    if (usedTokens + candidate.estimatedTokens > tokenBudget) {
      droppedCount += 1;
      continue;
    }
    selected.push(candidate);
    usedTokens += candidate.estimatedTokens;
  }

  return {
    entries: selected,
    usedTokens,
    tokenBudget,
    droppedCount,
    scannedMessages: scannedSlice.length,
  };
}

export const AGUAS_QUIETAS_LOREBOOK: readonly LorebookEntry[] = [
  {
    id: 'lore_rio_brumoso',
    titleEs: 'Río Brumoso y Ciénaga Fronteriza',
    category: 'location',
    activeSceneIds: ['escena_01_orilla', 'escena_07_travesia_barcaza'],
    keywords: ['rio', 'brumoso', 'niebla', 'cienaga', 'orilla', 'aguas'],
    priority: 85,
    contentEs:
      'Río ancho de corriente fría y neblina espesa que separa la frontera sur de los bosques del norte; imposible de cruzar a nado por los remolinos y el lodo de la ciénaga.',
  },
  {
    id: 'lore_asedio_sur',
    titleEs: 'Asedio en la Capital del Sur',
    category: 'world',
    keywords: [
      'asedio',
      'capital',
      'sur',
      'guerra',
      'frente',
      'refugiados',
      'ejercito',
    ],
    priority: 70,
    contentEs:
      'El frente militar del sur colapsó hace días; columnas de refugiados y desertores huyen hacia el río buscando cruzar antes de que avancen las vanguardias.',
  },
  {
    id: 'lore_guarnicion_embarcadero',
    titleEs: 'Guarnición del Embarcadero',
    category: 'faction',
    activeSceneIds: ['escena_04_campamento', 'escena_05_asalto_campamento'],
    keywords: [
      'guarnicion',
      'embarcadero',
      'campamento',
      'empalizada',
      'milicia',
      'desertores',
      'brazaletes',
    ],
    priority: 88,
    contentEs:
      'Destacamento atrincherado tras una empalizada de troncos atados con sogas; visten ropas raídas sin insignias oficiales y vigilan todo acceso al muelle con arcos tensados.',
  },
  {
    id: 'lore_barcaza_cadena',
    titleEs: 'Barcaza de Cadena del Muelle',
    category: 'location',
    activeSceneIds: ['escena_04_campamento', 'escena_07_travesia_barcaza'],
    keywords: ['barcaza', 'cadena', 'muelle', 'cruce', 'cruzar', 'balsa'],
    priority: 90,
    contentEs:
      'Única embarcación capaz de cruzar el Río Brumoso guiada por una gruesa cadena de hierro tendida entre ambas riberas; su uso requiere autorización del embarcadero o tomar el muelle.',
  },
  {
    id: 'lore_porton_alquimia',
    titleEs: 'Portón Dañado del Campamento',
    category: 'location',
    activeSceneIds: ['escena_04b_reparar_porton'],
    keywords: [
      'porton',
      'bisagras',
      'alquimia',
      'alquimicas',
      'polvora',
      'voladura',
      'reparar',
    ],
    priority: 80,
    contentEs:
      'Acceso principal al embarcadero con bisagras vencidas y tablones astillados por hollín reciente; el campamento necesita repararlo antes del amanecer.',
  },
  {
    id: 'lore_patrullas_norte',
    titleEs: 'Patrullas y Bosques del Norte',
    category: 'faction',
    activeSceneIds: ['escena_08_otra_orilla'],
    keywords: [
      'patrulla',
      'patrullas',
      'cascos',
      'trofeos',
      'ribera norte',
      'otra orilla',
    ],
    priority: 72,
    contentEs:
      'Las guarniciones de la ribera norte mantienen patrullas regulares que disputan el control del cruce; sus bosques densos ofrecen cobertura lejos de la guerra del sur.',
  },
  {
    id: 'lore_necrofagos_rio',
    titleEs: 'Necrófagos de Río',
    category: 'creature',
    activeSceneIds: ['escena_07_travesia_barcaza'],
    keywords: [
      'necrofago',
      'necrofagos',
      'ghoul',
      'ahogados',
      'aguas oscuras',
    ],
    priority: 86,
    contentEs:
      'Muertos vivientes anegados que acechan bajo el cauce del Río Brumoso y trepan por la cadena o la borda cuando el ruido del cruce los atrae.',
  },
  {
    id: 'lore_desercion_mireia',
    titleEs: 'Órdenes Rotas de la Comandante Mireia',
    category: 'npc',
    requiresAnyClue: ['pista_mireia_14'],
    keywords: [
      'mireia',
      'ordenes',
      'sello',
      'desercion',
      'guardia rota',
      'pliego',
    ],
    priority: 95,
    contentEs:
      'El pliego con sello real roto confirma que Mireia desobedeció la retirada para evacuar civiles del asedio; su dureza encubre una tropa mermada y sin refuerzos.',
  },
  {
    id: 'lore_enfermeria_heridos',
    titleEs: 'Enfermería y Sobrevivientes del Caserío',
    category: 'location',
    requiresAnyClue: ['pista_camp_18', 'pista_camp_14'],
    keywords: [
      'enfermeria',
      'heridos',
      'lona',
      'bajas',
      'aldeanos',
      'civiles',
    ],
    priority: 84,
    contentEs:
      'Bajo la lona médica yacen varios defensores incapacitados junto a aldeanos desplazados; la fuerza activa del campamento es bastante menor de lo que aparenta.',
  },
];
