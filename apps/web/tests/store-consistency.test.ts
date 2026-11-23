import { randomUUID } from "node:crypto";
import {
  createRng,
  resolveCheck,
  transitionScene,
} from "@dungeons/rules";
import type { ToolExecutionOptions } from "ai";
import { describe, expect, it } from "vitest";

import { createDmTools, type DmToolRuntime } from "@/agent/agent";
import { commitEventWithRetry, performRollback } from "@/lib/game/operations";
import {
  getDefaultGameStore,
  InMemoryGameStore,
  StaleSeqError,
  isStaleSeqError,
} from "@/lib/game/store";

const GUEST = "22222222-2222-4222-8222-222222222222";
const EXEC_OPTS: ToolExecutionOptions<never> = {
  toolCallId: "t",
  messages: [],
  context: undefined as never,
};

async function execTool<I, O>(
  t: {
    execute?: (
      input: I,
      opts: ToolExecutionOptions<never>,
    ) => O | PromiseLike<O> | AsyncIterable<O>;
  },
  input: I,
): Promise<O> {
  return (await t.execute!(input, EXEC_OPTS)) as O;
}

function makeCtx() {
  let i = 0;
  return {
    rng: createRng("store-test"),
    createId: () => `s_${++i}`,
    now: () => "2026-11-20T00:00:00.000Z",
  };
}

describe("seq atómico y logHeadSeq (P0 fix 4 + post-rollback)", () => {
  it("rechaza el segundo commit con el mismo expectedSeq y permite reintentar con el logHeadSeq recargado", async () => {
    const store = new InMemoryGameStore();
    const loaded = await store.createCampaign({ guestId: GUEST });
    const ctx = makeCtx();

    const first = transitionScene(
      loaded.state,
      { targetSceneId: "escena_03_parlamento", reason: "Uno" },
      ctx,
    );
    if (!first.ok) throw new Error(first.messageEs);
    await store.appendEvent(
      loaded.campaignId,
      loaded.sessionId,
      first.event,
      first.nextState,
      loaded.logHeadSeq,
    );

    const second = transitionScene(
      first.nextState,
      { targetSceneId: "escena_04_campamento", reason: "Dos" },
      ctx,
    );
    if (!second.ok) throw new Error(second.messageEs);

    await expect(
      store.appendEvent(
        loaded.campaignId,
        loaded.sessionId,
        second.event,
        second.nextState,
        0,
      ),
    ).rejects.toMatchObject({ code: "STALE_SEQ" });

    const fresh = await store.loadCampaign(loaded.campaignId, GUEST);
    await store.appendEvent(
      loaded.campaignId,
      loaded.sessionId,
      second.event,
      second.nextState,
      fresh!.logHeadSeq,
    );
    const after = await store.loadCampaign(loaded.campaignId, GUEST);
    expect(after?.state.lastSeq).toBe(2);
    expect(after?.logHeadSeq).toBe(2);
  });

  it("tras STALE_SEQ con reintento, el estado final coincide con la lectura autoritativa del store y conserva el evento concurrente", async () => {
    const store = new InMemoryGameStore();
    const loaded = await store.createCampaign({ guestId: GUEST });
    const ctx = makeCtx();

    const first = transitionScene(
      loaded.state,
      { targetSceneId: "escena_03_parlamento", reason: "Uno" },
      ctx,
    );
    if (!first.ok) throw new Error(first.messageEs);
    const firstCommit = await commitEventWithRetry({
      store,
      campaignId: loaded.campaignId,
      sessionId: loaded.sessionId,
      guestId: GUEST,
      event: first.event,
      nextState: first.nextState,
      expectedSeq: 0,
    });
    expect(firstCommit.reloaded).toBe(false);
    expect(firstCommit.logHeadSeq).toBe(1);

    // Otra petición escribe el seq 2 antes de que se reintente el segundo commit.
    const concurrent = resolveCheck(
      first.nextState,
      {
        sceneId: "escena_03_parlamento",
        actorId: "pc_kael",
        skill: "perception",
        dc: 12,
        checkId: "check_concurrente",
      },
      ctx,
    );
    if (!concurrent.ok) throw new Error(concurrent.messageEs);
    await store.appendEvent(
      loaded.campaignId,
      loaded.sessionId,
      concurrent.event,
      concurrent.nextState,
    );

    // Segundo commit calculado sobre el snapshot viejo (expectedSeq=0).
    const staleNext = transitionScene(
      first.nextState,
      { targetSceneId: "escena_04_campamento", reason: "Dos" },
      ctx,
    );
    if (!staleNext.ok) throw new Error(staleNext.messageEs);
    const outcome = await commitEventWithRetry({
      store,
      campaignId: loaded.campaignId,
      sessionId: loaded.sessionId,
      guestId: GUEST,
      event: staleNext.event,
      nextState: staleNext.nextState,
      expectedSeq: 0,
    });
    expect(outcome.reloaded).toBe(true);
    if (!outcome.reloaded) return;

    const reloaded = await store.loadCampaign(loaded.campaignId, GUEST);
    expect(outcome.state).toEqual(reloaded?.state);
    expect(outcome.events).toEqual(reloaded?.events);
    expect(outcome.logHeadSeq).toBe(3);
    expect(outcome.events.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(outcome.state.flags["check:check_concurrente:success"]).toBeDefined();
    expect(
      staleNext.nextState.flags["check:check_concurrente:success"],
    ).toBeUndefined();
  });

  it("tras rollback a seq 0, commitEventWithRetry usa logHeadSeq sin falsos STALE_SEQ", async () => {
    const store = new InMemoryGameStore();
    const loaded = await store.createCampaign({ guestId: GUEST });
    const ctx = makeCtx();

    const first = transitionScene(
      loaded.state,
      { targetSceneId: "escena_03_parlamento", reason: "Uno" },
      ctx,
    );
    if (!first.ok) throw new Error(first.messageEs);
    await store.appendEvent(
      loaded.campaignId,
      loaded.sessionId,
      first.event,
      first.nextState,
      loaded.logHeadSeq,
    );

    const rb = await performRollback({
      campaignId: loaded.campaignId,
      guestId: GUEST,
      targetSeq: 0,
      store,
    });
    expect(rb.ok).toBe(true);
    if (!rb.ok) return;
    expect(rb.state.lastSeq).toBe(0);
    expect(rb.logHeadSeq).toBe(2);

    const freshAfterRb = await store.loadCampaign(loaded.campaignId, GUEST);
    expect(freshAfterRb?.state.lastSeq).toBe(0);
    expect(freshAfterRb?.logHeadSeq).toBe(2);

    // 1) Con logHeadSeq correcto no hay ni un STALE_SEQ.
    const nextAfterRb = resolveCheck(
      freshAfterRb!.state,
      {
        sceneId: "escena_01_orilla",
        actorId: "pc_kael",
        skill: "perception",
        dc: 12,
      },
      ctx,
    );
    if (!nextAfterRb.ok) throw new Error(nextAfterRb.messageEs);

    const direct = await commitEventWithRetry({
      store,
      campaignId: loaded.campaignId,
      sessionId: loaded.sessionId,
      guestId: GUEST,
      event: nextAfterRb.event,
      nextState: nextAfterRb.nextState,
      expectedSeq: freshAfterRb!.logHeadSeq,
    });
    expect(direct.reloaded).toBe(false);
    expect(direct.logHeadSeq).toBe(3);

    // 2) Incluso si un caller antiguo pasara expectedSeq=0 (state.lastSeq tras rollback),
    //    el retry recarga fresh.logHeadSeq y commitea sin estallar.
    const another = resolveCheck(
      nextAfterRb.nextState,
      {
        sceneId: "escena_01_orilla",
        actorId: "pc_kael",
        skill: "stealth",
        dc: 12,
      },
      ctx,
    );
    if (!another.ok) throw new Error(another.messageEs);
    const recovered = await commitEventWithRetry({
      store,
      campaignId: loaded.campaignId,
      sessionId: loaded.sessionId,
      guestId: GUEST,
      event: another.event,
      nextState: another.nextState,
      expectedSeq: 0,
    });
    expect(recovered.reloaded).toBe(true);
    expect(recovered.logHeadSeq).toBe(4);
  });

  it("el tool resolve_check devuelve STALE_SEQ structured cuando el commit falla por seq viejo", async () => {
    const state = (await new InMemoryGameStore().createCampaign({ guestId: GUEST }))
      .state;
    const rt: DmToolRuntime = {
      campaignId: randomUUID(),
      sessionId: randomUUID(),
      guestId: GUEST,
      getState: () => state,
      getInitialState: () => state,
      getEvents: () => [],
      commitEvent: async () => {
        throw new StaleSeqError(0, 3);
      },
      commitRollback: async () => ({
        ok: false,
        code: "INVALID_TARGET_SEQ",
        messageEs: "no",
      }),
      rng: createRng("stale"),
      createId: () => randomUUID(),
      now: () => new Date().toISOString(),
    };
    expect(isStaleSeqError(new StaleSeqError(1, 2))).toBe(true);

    const out = await execTool(createDmTools(rt).resolve_check, {
      sceneId: state.sceneId,
      actorId: "pc_kael",
      skill: "perception",
      dc: 12,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("STALE_SEQ");

    const saveOut = await execTool(createDmTools(rt).resolve_save, {
      sceneId: state.sceneId,
      actorId: "pc_kael",
      ability: "dex",
      dc: 12,
    });
    expect(saveOut.ok).toBe(false);
    if (!saveOut.ok) expect(saveOut.code).toBe("STALE_SEQ");
  });
});

describe("rollback sincronizado con mensajes (P0 fix 5 + performRollback)", () => {
  it("los mensajes posteriores al targetSeq no se devuelven al cargar ni desde performRollback", async () => {
    const store = new InMemoryGameStore();
    const loaded = await store.createCampaign({ guestId: GUEST });
    const ctx = makeCtx();

    const first = transitionScene(
      loaded.state,
      { targetSceneId: "escena_03_parlamento", reason: "Uno" },
      ctx,
    );
    if (!first.ok) throw new Error(first.messageEs);
    await store.appendEvent(
      loaded.campaignId,
      loaded.sessionId,
      first.event,
      first.nextState,
    );
    await store.saveMessages(
      loaded.campaignId,
      loaded.sessionId,
      [{ role: "user", parts: [{ type: "text", text: "mensaje anterior" }] }],
      first.nextState.lastSeq,
    );

    const second = transitionScene(
      first.nextState,
      { targetSceneId: "escena_04_campamento", reason: "Dos" },
      ctx,
    );
    if (!second.ok) throw new Error(second.messageEs);
    await store.appendEvent(
      loaded.campaignId,
      loaded.sessionId,
      second.event,
      second.nextState,
    );
    await store.saveMessages(
      loaded.campaignId,
      loaded.sessionId,
      [
        {
          role: "assistant",
          parts: [{ type: "text", text: "mensaje posterior" }],
        },
      ],
      second.nextState.lastSeq,
    );

    expect(
      (await store.loadCampaign(loaded.campaignId, GUEST))?.messages,
    ).toHaveLength(3);

    const rb = await performRollback({
      campaignId: loaded.campaignId,
      guestId: GUEST,
      targetSeq: 1,
      store,
    });
    expect(rb.ok).toBe(true);
    if (!rb.ok) return;

    expect(rb.messages).toHaveLength(2);
    expect(JSON.stringify(rb.messages)).not.toContain("mensaje posterior");
    expect(JSON.stringify(rb.messages)).toContain("mensaje anterior");

    const rbZero = await performRollback({
      campaignId: loaded.campaignId,
      guestId: GUEST,
      targetSeq: 0,
      store,
    });
    expect(rbZero.ok).toBe(true);
    if (!rbZero.ok) return;
    // La intro sembrada en seq 0 sobrevive al rollback a seq 0 (0 tokens LLM).
    expect(rbZero.messages).toHaveLength(1);
    expect(rbZero.messages[0]?.role).toBe("assistant");
  });
});

describe("autoridad de dados en los bridges (P0 fix 2)", () => {
  it("resolve_check y resolve_save devuelven WRONG_MODE en modo híbrido", async () => {
    const store = new InMemoryGameStore();
    const loaded = await store.createCampaign({ guestId: GUEST, mode: "hybrid" });
    const tools = createDmTools({
      campaignId: loaded.campaignId,
      sessionId: loaded.sessionId,
      guestId: GUEST,
      getState: () => loaded.state,
      getInitialState: () => loaded.initialState,
      getEvents: () => [],
      commitEvent: async () => {},
      commitRollback: async () => ({
        ok: false,
        code: "INVALID_TARGET_SEQ",
        messageEs: "no",
      }),
      rng: createRng("auth"),
      createId: () => randomUUID(),
      now: () => new Date().toISOString(),
    });

    const checkOut = await execTool(tools.resolve_check, {
      sceneId: loaded.state.sceneId,
      actorId: "pc_kael",
      skill: "perception",
      dc: 12,
    });
    expect(checkOut.ok).toBe(false);
    if (!checkOut.ok) {
      expect(checkOut.code).toBe("WRONG_MODE");
      expect(checkOut.messageEs).toContain("declare_check");
    }

    const saveOut = await execTool(tools.resolve_save, {
      sceneId: loaded.state.sceneId,
      actorId: "pc_kael",
      ability: "dex",
      dc: 12,
    });
    expect(saveOut.ok).toBe(false);
    if (!saveOut.ok) expect(saveOut.code).toBe("WRONG_MODE");
  });
});

describe("fail-fast sin DATABASE_URL en producción (P1.3)", () => {
  it("lanza error explícito si NODE_ENV=production y DATABASE_URL está ausente", () => {
    const mutableEnv = process.env as Record<string, string | undefined>;
    const prevNodeEnv = mutableEnv.NODE_ENV;
    const prevDbUrl = mutableEnv.DATABASE_URL;
    try {
      mutableEnv.NODE_ENV = "production";
      delete mutableEnv.DATABASE_URL;
      expect(() => getDefaultGameStore()).toThrow(/DATABASE_URL/i);
    } finally {
      if (prevNodeEnv === undefined) {
        delete mutableEnv.NODE_ENV;
      } else {
        mutableEnv.NODE_ENV = prevNodeEnv;
      }
      if (prevDbUrl === undefined) {
        delete mutableEnv.DATABASE_URL;
      } else {
        mutableEnv.DATABASE_URL = prevDbUrl;
      }
    }
  });
});
