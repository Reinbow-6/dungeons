import type { GameEvent, GameState } from "@dungeons/rules";

import { sanitizeUntrustedText } from "@/lib/ai/prompt-safety";
import type { MemoryFactCategory, StoredMemoryFact } from "@/lib/game/store";

export const MEMORY_AGENT_CONFIG = {
  id: "memory",
  temperature: 0.1,
  enabled: true,
} as const;

export interface MemoryFactDraft {
  category: MemoryFactCategory;
  content: string;
  importance: number;
  eventSeq: number;
  source: "engine" | "dm-memory";
}

function resolveNaturalFromDice(
  dieResults: number[] | null,
  mode: unknown,
): number | null {
  if (!dieResults || dieResults.length === 0) return null;
  if (dieResults.length === 1 || mode === "normal" || typeof mode !== "string") {
    return dieResults[0] ?? null;
  }
  if (mode === "advantage") {
    return Math.max(...dieResults);
  }
  if (mode === "disadvantage") {
    return Math.min(...dieResults);
  }
  return dieResults[0] ?? null;
}

/**
 * Extracts deterministic campaign memory facts directly from committed authoritative GameEvents.
 * Every fact carries `eventSeq` so rollbacks cleanly revert facts from undone events.
 */
export function extractDeterministicFactsFromEvent(
  event: GameEvent,
  state: GameState,
): MemoryFactDraft[] {
  if (event.revertedByEventId !== null || event.type === "ROLLBACK") {
    return [];
  }

  const facts: MemoryFactDraft[] = [];
  const p = event.payload;
  const actorName = state.characters[event.actor]?.name ?? event.actor;

  switch (event.type) {
    case "SCENE_TRANSITION": {
      const toSceneId = typeof p.toSceneId === "string" ? p.toSceneId : state.sceneId;
      const toTitle = state.scenes[toSceneId]?.titleEs ?? toSceneId;
      const reason = typeof p.reason === "string" ? p.reason : "Avance en la historia";
      facts.push({
        category: "scene",
        content: sanitizeUntrustedText(
          `El grupo llegó a "${toTitle}" (${toSceneId}): ${reason}.`,
          280,
        ),
        importance: 7,
        eventSeq: event.seq,
        source: "engine",
      });
      break;
    }

    case "CLUES_UNLOCKED": {
      const sceneId = typeof p.sceneId === "string" ? p.sceneId : state.sceneId;
      const scene = state.scenes[sceneId];
      const sceneTitle = scene?.titleEs ?? sceneId;
      const unlockedIds = Array.isArray(p.newlyUnlockedIds)
        ? p.newlyUnlockedIds.filter((id): id is string => typeof id === "string")
        : [];
      for (const clueId of unlockedIds) {
        const clue = scene?.clues.find((c) => c.id === clueId);
        const desc = clue
          ? `${clue.titleEs}: ${clue.descriptionEs}`
          : clueId;
        facts.push({
          category: "milestone",
          content: sanitizeUntrustedText(
            `Pista descubierta en "${sceneTitle}" — ${desc}`,
            280,
          ),
          importance: 8,
          eventSeq: event.seq,
          source: "engine",
        });
      }
      break;
    }

    case "COMBAT_STARTED": {
      const sceneId = typeof p.sceneId === "string" ? p.sceneId : state.sceneId;
      const sceneTitle = state.scenes[sceneId]?.titleEs ?? sceneId;
      const order = Array.isArray(p.initiativeOrder) ? p.initiativeOrder : [];
      const enemies = order
        .filter(
          (entry): entry is { name?: unknown; kind?: unknown } =>
            Boolean(entry) &&
            typeof entry === "object" &&
            (entry as { kind?: unknown }).kind === "enemy",
        )
        .map((e) => (typeof e.name === "string" ? e.name : "enemigo"));
      const enemySummary =
        enemies.length > 0 ? enemies.join(", ") : "fuerzas hostiles";
      facts.push({
        category: "milestone",
        content: sanitizeUntrustedText(
          `Combate iniciado en "${sceneTitle}" contra: ${enemySummary}.`,
          280,
        ),
        importance: 6,
        eventSeq: event.seq,
        source: "engine",
      });
      break;
    }

    case "COMBAT_ENDED": {
      const sceneId = typeof p.sceneId === "string" ? p.sceneId : state.sceneId;
      const sceneTitle = state.scenes[sceneId]?.titleEs ?? sceneId;
      const outcome = typeof p.outcome === "string" ? p.outcome : "finalizado";
      const reason = typeof p.reason === "string" ? p.reason : "Encuentro concluido";
      const rounds =
        typeof p.roundsElapsed === "number" ? ` en ${p.roundsElapsed} ronda(s)` : "";
      facts.push({
        category: "milestone",
        content: sanitizeUntrustedText(
          `Combate en "${sceneTitle}" concluyó (${outcome}${rounds}): ${reason}.`,
          280,
        ),
        importance: 8,
        eventSeq: event.seq,
        source: "engine",
      });
      break;
    }

    case "INVENTORY_CHANGED": {
      const itemName =
        typeof p.itemName === "string"
          ? p.itemName
          : typeof p.itemId === "string"
            ? p.itemId
            : "objeto";
      const qtyDelta = typeof p.qtyDelta === "number" ? p.qtyDelta : 0;
      const qtyAfter =
        typeof p.quantityAfter === "number" ? p.quantityAfter : null;
      const reason = typeof p.reason === "string" ? p.reason : "Cambio de equipo";
      const actionVerb = qtyDelta >= 0 ? `obtuvo +${qtyDelta}` : `gastó ${Math.abs(qtyDelta)}`;
      const afterText = qtyAfter !== null ? ` (restan ${qtyAfter})` : "";
      facts.push({
        category: "item",
        content: sanitizeUntrustedText(
          `${actorName} ${actionVerb} de "${itemName}"${afterText}: ${reason}.`,
          280,
        ),
        importance: 5,
        eventSeq: event.seq,
        source: "engine",
      });
      break;
    }

    case "CONDITION_CHANGED": {
      const addList = Array.isArray(p.addConditions)
        ? p.addConditions.filter((c): c is string => typeof c === "string")
        : [];
      const removeList = Array.isArray(p.removeConditions)
        ? p.removeConditions.filter((c): c is string => typeof c === "string")
        : [];
      const exBefore = typeof p.exhaustionBefore === "number" ? p.exhaustionBefore : 0;
      const exAfter = typeof p.exhaustionAfter === "number" ? p.exhaustionAfter : 0;
      const reason = typeof p.reason === "string" ? p.reason : "Efecto en escena";
      const parts: string[] = [];
      if (addList.length > 0) parts.push(`ganó [${addList.join(", ")}]`);
      if (removeList.length > 0) parts.push(`removió [${removeList.join(", ")}]`);
      if (exAfter !== exBefore) parts.push(`agotamiento ${exBefore} → ${exAfter}`);
      if (parts.length > 0) {
        facts.push({
          category: "milestone",
          content: sanitizeUntrustedText(
            `${actorName} ${parts.join(", ")}: ${reason}.`,
            280,
          ),
          importance: 6,
          eventSeq: event.seq,
          source: "engine",
        });
      }
      break;
    }

    case "REST_TAKEN": {
      if (p.restType !== "long") {
        break;
      }
      const sceneId = typeof p.sceneId === "string" ? p.sceneId : state.sceneId;
      const sceneTitle = state.scenes[sceneId]?.titleEs ?? sceneId;
      facts.push({
        category: "milestone",
        content: sanitizeUntrustedText(
          `${actorName} completó un descanso largo en "${sceneTitle}", recuperando fuerzas y recursos.`,
          280,
        ),
        importance: 5,
        eventSeq: event.seq,
        source: "engine",
      });
      break;
    }

    case "DEATH_SAVE_RESOLVED": {
      const outcome = typeof p.outcome === "string" ? p.outcome : "";
      if (
        outcome !== "critical_recovery" &&
        outcome !== "stabilized" &&
        outcome !== "dead"
      ) {
        break;
      }
      const detail =
        outcome === "critical_recovery"
          ? "se recuperó milagrosamente con un 20 natural (1 PG)"
          : outcome === "stabilized"
            ? "quedó estable en 0 PG"
            : "murió tras acumular 3 fallos de salvación contra la muerte";
      facts.push({
        category: "milestone",
        content: sanitizeUntrustedText(`${actorName} ${detail}.`, 280),
        importance: outcome === "dead" ? 10 : 8,
        eventSeq: event.seq,
        source: "engine",
      });
      break;
    }

    case "CHECK_RESOLVED":
    case "SAVE_RESOLVED": {
      const nat = resolveNaturalFromDice(event.dieResults, p.mode);
      const isSceneClue = p.dcSource === "scene-clue";
      const isCrit = nat === 20 || nat === 1;
      if (!isSceneClue && !isCrit) {
        break;
      }
      const targetName =
        typeof p.skill === "string"
          ? p.skill
          : typeof p.ability === "string"
            ? p.ability.toUpperCase()
            : "tirada";
      const total = typeof p.total === "number" ? p.total : "?";
      const dc = typeof p.dc === "number" ? p.dc : "?";
      const outcomeEs = p.success ? "Éxito" : "Fallo";
      const critTag =
        nat === 20 ? " (20 natural)" : nat === 1 ? " (1 natural)" : "";
      const refTag =
        typeof p.dcRef === "string" ? ` [ref: ${p.dcRef}]` : "";
      facts.push({
        category: "milestone",
        content: sanitizeUntrustedText(
          `${actorName} — ${outcomeEs}${critTag} en ${targetName} (${total} vs CD ${dc})${refTag}.`,
          280,
        ),
        importance: 6,
        eventSeq: event.seq,
        source: "engine",
      });
      break;
    }

    default:
      break;
  }

  return facts;
}

/**
 * Builds a concise deterministic session recap in Spanish when closing a session and opening the next.
 */
export function buildDeterministicSessionSummary(params: {
  sessionNumber: number;
  state: GameState;
  events: readonly GameEvent[];
  memoryFacts: readonly StoredMemoryFact[];
}): string {
  const { sessionNumber, state, memoryFacts } = params;
  const sceneTitle = state.scenes[state.sceneId]?.titleEs ?? state.sceneId;
  const charSummaries = Object.values(state.characters)
    .map((c) => {
      const conds =
        c.conditions.length > 0 ? `, cond: ${c.conditions.join("/")}` : "";
      return `${c.name} (${c.hp.current}/${c.hp.max} PG${conds})`;
    })
    .join("; ");

  const topFacts = memoryFacts
    .filter((f) => f.revertedBySeq === null)
    .slice(0, 4)
    .map((f) => sanitizeUntrustedText(f.content, 120));

  const factsText =
    topFacts.length > 0
      ? ` Hitos clave: ${topFacts.join(" | ")}`
      : "";

  return sanitizeUntrustedText(
    `Sesión #${sessionNumber} — Escena: ${sceneTitle} (seq ${state.lastSeq}). Estado: ${charSummaries}.${factsText}`,
    900,
  );
}
