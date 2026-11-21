import type { GameEvent, GameState, RollbackResult } from "@dungeons/rules";

import {
  getDefaultGameStore,
  isStaleSeqError,
  type GameStore,
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
 * Commit optimista con `expectedSeq` (referido a `logHeadSeq`, el máximo `seq`
 * real de `event_log`). Ante un `STALE_SEQ`, recarga desde el store, reintenta
 * una vez usando `fresh.logHeadSeq` (evitando falsos `STALE_SEQ` tras rollback)
 * y devuelve el estado y eventos autoritativos releídos del store.
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
  const { store, campaignId, sessionId, guestId, event, nextState, expectedSeq } =
    params;
  try {
    await store.appendEvent(
      campaignId,
      sessionId,
      event,
      nextState,
      expectedSeq,
    );
    return { reloaded: false, logHeadSeq: event.seq };
  } catch (err) {
    if (!isStaleSeqError(err)) throw err;
    const fresh = await store.loadCampaign(campaignId, guestId);
    if (!fresh) throw err;
    await store.appendEvent(
      fresh.campaignId,
      fresh.sessionId,
      event,
      nextState,
      fresh.logHeadSeq,
    );
    const finalLoaded = await store.loadCampaign(campaignId, guestId);
    if (!finalLoaded) throw err;
    return {
      reloaded: true,
      state: finalLoaded.state,
      events: finalLoaded.events,
      logHeadSeq: finalLoaded.logHeadSeq,
    };
  }
}

export type PerformRollbackOutcome =
  | (Extract<RollbackResult, { ok: true }> & {
      messages: StoredMessage[];
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
    logHeadSeq: reloaded?.logHeadSeq ?? rb.rollbackEvent.seq,
  };
}
