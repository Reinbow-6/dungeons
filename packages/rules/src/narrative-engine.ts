import { getAguasInquietasProgress } from './adventures/aguas-quietas.js';
import type { GameEvent } from './events.js';
import type { GameState, TurnPhase } from './types.js';

function normalizeForMatch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

// ---------- 1. Turn Phase (Multiplayer-ready state machine) ----------

export interface TurnContext {
  phase: TurnPhase;
  labelEs: string;
  activeActorId: string | null;
  activeActorName: string | null;
}

const TURN_PHASE_LABELS: Record<TurnPhase, string> = {
  exploration: 'Exploración libre',
  awaiting_roll: 'Esperando tirada del jugador',
  combat_turn: 'Turno de combate',
  resolving: 'DM resolviendo escena',
};

export function deriveTurnContext(
  state: GameState,
  options?: { pendingPlayerRoll?: boolean; isStreaming?: boolean },
): TurnContext {
  const firstPc = Object.values(state.characters)[0];

  if (options?.pendingPlayerRoll) {
    return {
      phase: 'awaiting_roll',
      labelEs: TURN_PHASE_LABELS.awaiting_roll,
      activeActorId: firstPc?.id ?? null,
      activeActorName: firstPc?.name ?? null,
    };
  }

  if (options?.isStreaming) {
    return {
      phase: 'resolving',
      labelEs: TURN_PHASE_LABELS.resolving,
      activeActorId: null,
      activeActorName: 'Dungeon Master',
    };
  }

  if (state.combat?.active) {
    const active = state.combat.combatants[state.combat.turnIndex];
    return {
      phase: 'combat_turn',
      labelEs: `${TURN_PHASE_LABELS.combat_turn} (R${state.combat.round})`,
      activeActorId: active?.id ?? null,
      activeActorName: active?.name ?? null,
    };
  }

  const phase: TurnPhase = state.turnPhase ?? 'exploration';
  return {
    phase,
    labelEs: TURN_PHASE_LABELS[phase],
    activeActorId: firstPc?.id ?? null,
    activeActorName: firstPc?.name ?? null,
  };
}

// ---------- 2. Deterministic Tension Meter (0-100, 0 LLM tokens) ----------

export type TensionLevel = 'calma' | 'alerta' | 'tension' | 'peligro' | 'climax';

export interface TensionReading {
  score: number;
  level: TensionLevel;
  labelEs: string;
  factorsEs: string[];
  pacingDirectiveEs: string;
}

const SCENE_BASE_TENSION: Record<string, number> = {
  escena_01_orilla: 28,
  escena_02_batalla_orilla: 74,
  escena_03_parlamento: 42,
  escena_04_campamento: 48,
  escena_04b_reparar_porton: 52,
  escena_05_asalto_campamento: 84,
  escena_06_comandante: 66,
  escena_07_travesia_barcaza: 88,
  escena_08_otra_orilla: 14,
};

const HARSH_CONDITIONS = new Set([
  'blinded',
  'frightened',
  'paralyzed',
  'poisoned',
  'prone',
  'restrained',
  'stunned',
  'unconscious',
]);

export function computeTensionMeter(
  state: GameState,
  events: readonly GameEvent[],
): TensionReading {
  let score = SCENE_BASE_TENSION[state.sceneId] ?? 35;
  const factorsEs: string[] = [];

  const sceneTitle = state.scenes[state.sceneId]?.titleEs ?? state.sceneId;
  factorsEs.push(`Escena (${sceneTitle}): base ${score}`);

  if (state.combat?.active) {
    const combatBoost = 22 + Math.min(16, (state.combat.round - 1) * 4);
    score += combatBoost;
    factorsEs.push(`Combate activo R${state.combat.round}: +${combatBoost}`);
  }

  for (const char of Object.values(state.characters)) {
    if (char.hp.current === 0) {
      score += 24;
      factorsEs.push(`${char.name} a 0 PG: +24`);
    } else if (char.hp.current / Math.max(1, char.hp.max) <= 0.35) {
      score += 14;
      factorsEs.push(`${char.name} herido grave: +14`);
    }
    const harshCount = char.conditions.filter((c) => HARSH_CONDITIONS.has(c)).length;
    if (harshCount > 0) {
      const condBoost = Math.min(16, harshCount * 8);
      score += condBoost;
      factorsEs.push(`Condiciones activas (${harshCount}): +${condBoost}`);
    }
  }

  const recentActive = events
    .filter((e) => e.revertedByEventId === null && e.type !== 'ROLLBACK')
    .slice(-5);

  let recentDelta = 0;
  for (const ev of recentActive) {
    if (ev.type === 'CHECK_RESOLVED' || ev.type === 'SAVE_RESOLVED') {
      if (ev.payload.success === false) {
        recentDelta += 6;
      } else if (ev.payload.success === true) {
        recentDelta -= 3;
      }
    } else if (ev.type === 'REST_TAKEN') {
      recentDelta -= 14;
    } else if (ev.type === 'DEATH_SAVE_RESOLVED') {
      recentDelta += ev.payload.outcome === 'failure' ? 12 : 4;
    } else if (ev.type === 'CLUES_UNLOCKED') {
      recentDelta -= 2;
    }
  }
  if (recentDelta !== 0) {
    score += recentDelta;
    factorsEs.push(
      `Impulso reciente: ${recentDelta > 0 ? `+${recentDelta}` : recentDelta}`,
    );
  }

  const clamped = Math.max(0, Math.min(100, Math.round(score)));

  if (clamped < 25) {
    return {
      score: clamped,
      level: 'calma',
      labelEs: 'Calma',
      factorsEs,
      pacingDirectiveEs:
        'Ritmo pausado: permití respiro, diálogo íntimo y detalles sensoriales de la frontera.',
    };
  }
  if (clamped < 45) {
    return {
      score: clamped,
      level: 'alerta',
      labelEs: 'Alerta',
      factorsEs,
      pacingDirectiveEs:
        'Ritmo expectante: insinuá peligros en la niebla y vigilantes midiendo al personaje.',
    };
  }
  if (clamped < 65) {
    return {
      score: clamped,
      level: 'tension',
      labelEs: 'Tensión',
      factorsEs,
      pacingDirectiveEs:
        'Ritmo tenso: subí la presión del tiempo, desconfianza entre facciones y consecuencias visibles.',
    };
  }
  if (clamped < 85) {
    return {
      score: clamped,
      level: 'peligro',
      labelEs: 'Peligro',
      factorsEs,
      pacingDirectiveEs:
        'Ritmo apremiante: frases más cortas, peligro inminente y decisiones tácticas con costo real.',
    };
  }
  return {
    score: clamped,
    level: 'climax',
    labelEs: 'Clímax',
    factorsEs,
    pacingDirectiveEs:
      'Ritmo de clímax: máxima urgencia cinematográfica; cada acción define el destino del cruce.',
  };
}

// ---------- 3. Low-cost Macro Story Arc (Story-Arc-Engine inspired) ----------

export interface MacroStoryArc {
  actNumber: 1 | 2 | 3 | 4;
  actTitleEs: string;
  dramaticBeatEs: string;
  eventsSinceLastTransition: number;
  stagnationWarningEs: string | null;
  summaryLineEs: string;
}

const ACT_METADATA: Record<
  1 | 2 | 3 | 4,
  { titleEs: string; beatEs: string }
> = {
  1: { titleEs: 'Acto I · Huida en la Orilla', beatEs: 'Planteamiento' },
  2: { titleEs: 'Acto II · El Embarcadero', beatEs: 'Complicación' },
  3: { titleEs: 'Acto III · Punto de Quiebre', beatEs: 'Crisis' },
  4: { titleEs: 'Acto IV · El Cruce Final', beatEs: 'Clímax y Resolución' },
};

export function computeMacroStoryArc(
  state: GameState,
  events: readonly GameEvent[],
): MacroStoryArc {
  const progress = getAguasInquietasProgress(state);
  const actNumber = Math.min(4, Math.max(1, progress.currentStage.order)) as
    | 1
    | 2
    | 3
    | 4;
  const meta = ACT_METADATA[actNumber];

  const active = events.filter(
    (e) => e.revertedByEventId === null && e.type !== 'ROLLBACK',
  );
  let eventsSinceLastTransition = 0;
  for (let i = active.length - 1; i >= 0; i -= 1) {
    if (active[i]!.type === 'SCENE_TRANSITION') break;
    eventsSinceLastTransition += 1;
  }

  const stagnationWarningEs =
    !state.combat?.active &&
    !progress.completed &&
    eventsSinceLastTransition >= 5
      ? 'La escena lleva varios eventos sin avanzar: introducí una señal del frente o una presión concreta que empuje hacia la siguiente escena.'
      : null;

  return {
    actNumber,
    actTitleEs: meta.titleEs,
    dramaticBeatEs: meta.beatEs,
    eventsSinceLastTransition,
    stagnationWarningEs,
    summaryLineEs: `${meta.titleEs} (${meta.beatEs}) — Etapa ${progress.currentStage.order}/${progress.quest.stages.length}: ${progress.currentStage.titleEs}`,
  };
}

// ---------- 4. Compartmentalized NPC Minds (Inner-Entity / Inner-Self inspired) ----------

export interface NpcMindCard {
  id: string;
  nameEs: string;
  roleEs: string;
  activeSceneIds: string[];
  triggerKeywords: string[];
  knowsEs: string;
  doesNotKnowEs: string;
  wantsEs: string;
  hidesEs: string;
  attitudeEs: string;
}

export function selectActiveNpcMinds(
  state: GameState,
  events: readonly GameEvent[],
  latestUserText = '',
): NpcMindCard[] {
  const normText = normalizeForMatch(latestUserText);
  const discovered = new Set<string>();
  for (const ids of Object.values(state.unlockedClues)) {
    for (const id of ids) discovered.add(id);
  }

  const hadCombat = events.some(
    (e) =>
      e.revertedByEventId === null &&
      (e.type === 'COMBAT_STARTED' || e.type === 'COMBAT_ATTACK'),
  );

  const catalog: NpcMindCard[] = [
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
      attitudeEs:
        discovered.has('pista_mireia_14')
          ? 'Recelosa al inicio, pero dispuesta a pactar si le demostrás que conocés sus verdaderas órdenes.'
          : hadCombat
            ? 'Muy hostil y a la defensiva por el choque armado previo.'
            : 'Cautelosa, agotada y pragmática; respeta la franqueza y la utilidad.',
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
      attitudeEs: hadCombat
        ? 'Alarma máxima: buscan replegarse al campamento para avisar a Mireia.'
        : discovered.has('pista_orilla_14') || discovered.has('pista_parlamento_13')
          ? 'Nerviosos pero negociables si les hablás como sobreviviente y no como soldado.'
          : 'Desconfiados, arcos tensados, midiendo si sos espía o refugiado.',
    },
    {
      id: 'aldeanos_ocultos',
      nameEs: 'Sobrevivientes de la Enfermería',
      roleEs: 'Heridos y antiguos civiles del caserío',
      activeSceneIds: [],
      triggerKeywords: ['enfermeria', 'heridos', 'aldeanos', 'civiles', 'lona'],
      knowsEs:
        'Saben cuántos defensores están fuera de combate y recuerdan la voladura del portón.',
      doesNotKnowEs:
        'No saben quién sos ni qué acordaste fuera de la empalizada.',
      wantsEs: 'Cruzar el río con vida sin quedar atrapados en otro tiroteo.',
      hidesEs:
        'Guarda silencio por miedo a represalias si estalla un motín en el campamento.',
      attitudeEs:
        'Temerosos pero agradecidos ante cualquier muestra de curación o compasión.',
    },
  ];

  return catalog.filter((card) => {
    if (card.activeSceneIds.includes(state.sceneId)) return true;
    if (
      card.id === 'aldeanos_ocultos' &&
      state.sceneId === 'escena_04_campamento' &&
      (discovered.has('pista_camp_18') || discovered.has('pista_camp_14'))
    ) {
      return true;
    }
    return (
      normText.length > 0 &&
      card.triggerKeywords.some((kw) => normText.includes(kw))
    );
  });
}

// ---------- 5. Mention-Activated Memory Filtering (Auto-Cards inspired) ----------

export interface FilterableMemoryFact {
  id: string;
  category: string;
  content: string;
  importance: number;
  eventSeq: number;
  revertedBySeq: number | null;
}

const STOPWORDS = new Set([
  'para',
  'como',
  'pero',
  'porque',
  'sobre',
  'desde',
  'hasta',
  'hacia',
  'entre',
  'todo',
  'esta',
  'este',
  'estos',
  'estas',
  'ellos',
  'ellas',
  'nosotros',
  'quiero',
  'hago',
  'miro',
  'paso',
]);

export function selectMentionActivatedMemories<T extends FilterableMemoryFact>(
  facts: readonly T[],
  state: GameState,
  latestUserText = '',
  maxTotal = 10,
): T[] {
  const active = facts.filter((f) => f.revertedBySeq == null);
  if (active.length <= 4) {
    return active.slice(0, maxTotal);
  }

  // Always keep top 3 high-importance milestones/promises (importance >= 8)
  const pinned = active
    .filter((f) => f.importance >= 8)
    .sort((a, b) => b.importance - a.importance || b.eventSeq - a.eventSeq)
    .slice(0, 3);
  const pinnedIds = new Set(pinned.map((f) => f.id));

  const sceneTitle = state.scenes[state.sceneId]?.titleEs ?? '';
  const queryText = normalizeForMatch(`${latestUserText} ${sceneTitle}`);
  const tokens = Array.from(
    new Set(
      queryText
        .replace(/@/g, ' ')
        .split(/[^a-z0-9ñ]+/)
        .filter((t) => t.length >= 4 && !STOPWORDS.has(t)),
    ),
  );

  const triggered = active
    .filter((f) => !pinnedIds.has(f.id))
    .map((fact) => {
      const hay = normalizeForMatch(`${fact.category} ${fact.content}`);
      const hits = tokens.reduce((acc, tok) => acc + (hay.includes(tok) ? 1 : 0), 0);
      return { fact, hits };
    })
    .filter((entry) => entry.hits > 0)
    .sort(
      (a, b) =>
        b.hits - a.hits ||
        b.fact.importance - a.fact.importance ||
        b.fact.eventSeq - a.fact.eventSeq,
    )
    .map((entry) => entry.fact);

  return [...pinned, ...triggered].slice(0, maxTotal);
}
