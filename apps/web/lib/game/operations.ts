import type { GameEvent, GameState, RollbackResult } from "@dungeons/rules";

import {
  getDefaultGameStore,
  type GameStore,
  type StoredMemoryFact,
  type StoredMessage,
} from "@/lib/game/store";

export type CommitOutcome =
  | { reloaded: false; logHeadSeq: number }
  | {
      reloaded: true;
      state: GameState;
      events: GameEvent[];
      logHeadSeq: number;
    };

/**
 * Commit optimista estricto con `expectedSeq` (referido a `logHeadSeq`, el máximo `seq`
 * real de `event_log`). Ante concurrencia (`StaleSeqError`), propaga el error para que el
 * caller recargue y re-resuelva en lugar de sobrescribir estado con una mutación vieja.
 */
export async function commitEventWithRetry(params: {
  store: GameStore;
  campaignId: string;
  sessionId: string;
  guestId: string;
  event: GameEvent;
  nextState: GameState;
  expectedSeq?: number;
}): Promise<CommitOutcome> {
  const { store, campaignId, sessionId, event, nextState, expectedSeq } = params;
  await store.appendEvent(
    campaignId,
    sessionId,
    event,
    nextState,
    expectedSeq,
  );
  return { reloaded: false, logHeadSeq: event.seq };
}

export type PerformRollbackOutcome =
  | (Extract<RollbackResult, { ok: true }> & {
      messages: StoredMessage[];
      memoryFacts: StoredMemoryFact[];
      logHeadSeq: number;
    })
  | Extract<RollbackResult, { ok: false }>;

/**
 * Handler único del servidor para rollback: la ruta HTTP `/api/game/rollback`
 * y el tool `rollback_to_event` delegan en esta misma función.
 */
export async function performRollback(params: {
  campaignId: string;
  guestId: string;
  targetSeq: number;
  reason?: string;
  store?: GameStore;
}): Promise<PerformRollbackOutcome> {
  const store = params.store ?? getDefaultGameStore();
  const rb = await store.rollbackCampaign(
    params.campaignId,
    params.guestId,
    params.targetSeq,
  );
  if (!rb.ok) {
    return rb;
  }

  const reloaded = await store.loadCampaign(params.campaignId, params.guestId);
  return {
    ...rb,
    messages: reloaded?.messages ?? [],
    memoryFacts: reloaded?.memoryFacts ?? [],
    logHeadSeq: reloaded?.logHeadSeq ?? rb.rollbackEvent.seq,
  };
}
