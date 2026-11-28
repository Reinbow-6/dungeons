import { randomUUID } from "node:crypto";
import {
  createRng,
  resolveCheck,
  transitionScene,
} from "@dungeons/rules";
import type { ToolExecutionOptions } from "ai";
import { describe, expect, it } from "vitest";

import { createDmTools, type DmToolRuntime } from "@/agent/agent";
import { DELETE, GET, POST } from "@/app/api/game/campaigns/route";
import {
  createGuestSessionToken,
  GUEST_COOKIE_NAME,
} from "@/lib/auth/guest-session";
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

    // Segundo commit calculado sobre el snapshot viejo (expectedSeq=0) debe rechazarse con STALE_SEQ.
    const staleNext = transitionScene(
      first.nextState,
      { targetSceneId: "escena_04_campamento", reason: "Dos" },
      ctx,
    );
    if (!staleNext.ok) throw new Error(staleNext.messageEs);
    await expect(
      commitEventWithRetry({
        store,
        campaignId: loaded.campaignId,
        sessionId: loaded.sessionId,
        guestId: GUEST,
        event: staleNext.event,
        nextState: staleNext.nextState,
        expectedSeq: 0,
      }),
    ).rejects.toThrow(StaleSeqError);

    const reloaded = await store.loadCampaign(loaded.campaignId, GUEST);
    expect(reloaded?.logHeadSeq).toBe(2);
    expect(reloaded?.events.map((e) => e.seq)).toEqual([1, 2]);
    expect(reloaded?.state.flags["check:check_concurrente:success"]).toBeDefined();
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

    // 2) Si un caller antiguo pasara expectedSeq=0 (state.lastSeq tras rollback),
    //    el commit estricto rechaza con StaleSeqError para evitar sobrescribir estado.
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
    await expect(
      commitEventWithRetry({
        store,
        campaignId: loaded.campaignId,
        sessionId: loaded.sessionId,
        guestId: GUEST,
        event: another.event,
        nextState: another.nextState,
        expectedSeq: 0,
      }),
    ).rejects.toThrow(StaleSeqError);
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
    ).toHaveLength(2);

    const rb = await performRollback({
      campaignId: loaded.campaignId,
      guestId: GUEST,
      targetSeq: 1,
      store,
    });
    expect(rb.ok).toBe(true);
    if (!rb.ok) return;

    expect(rb.messages).toHaveLength(1);
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
    expect(rbZero.messages).toHaveLength(0);

    // Si el jugador eligió "Comenzar campaña" (intro en seq 0), esa intro sobrevive al rollback a seq 0.
    const seeded = await store.seedOpeningIntro(loaded.campaignId, GUEST);
    expect(seeded?.messages).toHaveLength(1);
    const rbZeroAfterSeed = await performRollback({
      campaignId: loaded.campaignId,
      guestId: GUEST,
      targetSeq: 0,
      store,
    });
    expect(rbZeroAfterSeed.ok).toBe(true);
    if (!rbZeroAfterSeed.ok) return;
    expect(rbZeroAfterSeed.messages).toHaveLength(1);
    expect(rbZeroAfterSeed.messages[0]?.role).toBe("assistant");
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

describe("borrado de partidas (deleteCampaign & deleteAllCampaignsForGuest)", () => {
  it("deleteCampaign solo permite borrar al dueño y actualiza listCampaignsForGuest y getLatestCampaignForGuest", async () => {
    const store = new InMemoryGameStore();
    const owner = randomUUID();
    const otherGuest = randomUUID();
    const invitedMember = randomUUID();

    const c1 = await store.createCampaign({ guestId: owner, title: "Partida 1" });
    const c2 = await store.createCampaign({ guestId: owner, title: "Partida 2" });
    const c3 = await store.createCampaign({ guestId: owner, title: "Partida 3" });
    await store.addCampaignMember(c2.campaignId, owner, invitedMember, "player");

    expect(await store.listCampaignsForGuest(owner)).toMatchObject({ total: 3 });
    expect((await store.getLatestCampaignForGuest(owner))?.campaignId).toBe(
      c3.campaignId,
    );

    // Otro guest y un miembro invitado (no dueño) no pueden borrar la campaña
    expect(await store.deleteCampaign(c3.campaignId, otherGuest)).toBe(false);
    expect(await store.deleteCampaign(c2.campaignId, invitedMember)).toBe(false);
    expect(await store.deleteCampaign("not-a-uuid", owner)).toBe(false);
    expect(await store.listCampaignsForGuest(owner)).toMatchObject({ total: 3 });

    // El dueño borra la más reciente (c3): getLatestCampaignForGuest pasa a c2
    expect(await store.deleteCampaign(c3.campaignId, owner)).toBe(true);
    expect(await store.loadCampaign(c3.campaignId, owner)).toBeNull();
    expect(await store.deleteCampaign(c3.campaignId, owner)).toBe(false);

    const afterDeleteLatest = await store.listCampaignsForGuest(owner);
    expect(afterDeleteLatest.total).toBe(2);
    expect(afterDeleteLatest.items.map((i) => i.campaignId)).not.toContain(
      c3.campaignId,
    );
    expect((await store.getLatestCampaignForGuest(owner))?.campaignId).toBe(
      c2.campaignId,
    );

    // El dueño borra c2 (también compartida): c1 queda como última y el miembro ya no la ve
    expect(await store.deleteCampaign(c2.campaignId, owner)).toBe(true);
    expect(await store.loadCampaign(c2.campaignId, invitedMember)).toBeNull();
    expect((await store.listCampaignsForGuest(invitedMember)).total).toBe(0);
    expect((await store.listCampaignsForGuest(owner)).total).toBe(1);
    expect((await store.getLatestCampaignForGuest(owner))?.campaignId).toBe(
      c1.campaignId,
    );
  });

  it("deleteAllCampaignsForGuest borra todas o respeta exceptCampaignId sin afectar a otros usuarios", async () => {
    const store = new InMemoryGameStore();
    const owner = randomUUID();
    const otherGuest = randomUUID();

    const a1 = await store.createCampaign({ guestId: owner, title: "A1" });
    const a2 = await store.createCampaign({ guestId: owner, title: "A2" });
    const a3 = await store.createCampaign({ guestId: owner, title: "A3" });
    const b1 = await store.createCampaign({ guestId: otherGuest, title: "B1" });
    await store.addCampaignMember(b1.campaignId, otherGuest, owner, "player");

    // Borra todas las del owner excepto a2; no borra b1 (ni propia de otherGuest ni compartida)
    const deletedWithExcept = await store.deleteAllCampaignsForGuest(owner, {
      exceptCampaignId: a2.campaignId,
    });
    expect(deletedWithExcept).toBe(2);

    const remainingList = await store.listCampaignsForGuest(owner);
    // owner ve a2 (owner) y b1 (player)
    expect(remainingList.total).toBe(2);
    expect(remainingList.items.map((i) => i.campaignId)).toContain(a2.campaignId);
    expect(remainingList.items.map((i) => i.campaignId)).not.toContain(
      a1.campaignId,
    );
    expect(remainingList.items.map((i) => i.campaignId)).not.toContain(
      a3.campaignId,
    );
    expect(await store.loadCampaign(a1.campaignId, owner)).toBeNull();
    expect(await store.loadCampaign(a3.campaignId, owner)).toBeNull();
    expect((await store.loadCampaign(a2.campaignId, owner))?.campaignId).toBe(
      a2.campaignId,
    );

    // Con exceptCampaignId inválido, igual borra las restantes del dueño sin fallar
    const deletedAll = await store.deleteAllCampaignsForGuest(owner, {
      exceptCampaignId: "invalid-uuid",
    });
    expect(deletedAll).toBe(1);
    expect(await store.loadCampaign(a2.campaignId, owner)).toBeNull();
    expect((await store.listCampaignsForGuest(otherGuest)).total).toBe(1);

    // Nuevo dueño sin campañas compartidas queda completamente vacío
    const soloGuest = randomUUID();
    await store.createCampaign({ guestId: soloGuest, title: "Solo 1" });
    await store.createCampaign({ guestId: soloGuest, title: "Solo 2" });
    expect(await store.deleteAllCampaignsForGuest(soloGuest)).toBe(2);
    expect((await store.listCampaignsForGuest(soloGuest)).total).toBe(0);
    expect(await store.getLatestCampaignForGuest(soloGuest)).toBeNull();
  });
});

describe("API DELETE /api/game/campaigns", () => {
  function withMemoryEnv(fn: () => Promise<void>): Promise<void> {
    const mutableEnv = process.env as Record<string, string | undefined>;
    const prevDbUrl = mutableEnv.DATABASE_URL;
    const prevNodeEnv = mutableEnv.NODE_ENV;
    delete mutableEnv.DATABASE_URL;
    if (mutableEnv.NODE_ENV === "production") {
      mutableEnv.NODE_ENV = "test";
    }
    return fn().finally(() => {
      if (prevDbUrl === undefined) {
        delete mutableEnv.DATABASE_URL;
      } else {
        mutableEnv.DATABASE_URL = prevDbUrl;
      }
      if (prevNodeEnv === undefined) {
        delete mutableEnv.NODE_ENV;
      } else {
        mutableEnv.NODE_ENV = prevNodeEnv;
      }
    });
  }

  function makeCookieHeader(guestId: string): string {
    const token = createGuestSessionToken(guestId);
    return `${GUEST_COOKIE_NAME}=${encodeURIComponent(token)}`;
  }

  async function createViaRoute(cookie: string, title: string): Promise<string> {
    const res = await POST(
      new Request("http://localhost/api/game/campaigns", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
        },
        body: JSON.stringify({ title }),
      }),
    );
    expect(res.status).toBe(201);
    const data = (await res.json()) as { campaignId: string };
    return data.campaignId;
  }

  it("borra una campaña por query ?campaignId= o body JSON y devuelve 404 si no existe o pertenece a otro guest", async () => {
    await withMemoryEnv(async () => {
      const guestA = randomUUID();
      const guestB = randomUUID();
      const cookieA = makeCookieHeader(guestA);
      const cookieB = makeCookieHeader(guestB);

      const id1 = await createViaRoute(cookieA, "Campaña Uno");
      const id2 = await createViaRoute(cookieA, "Campaña Dos");

      // Otro guest recibe 404 CAMPAIGN_NOT_FOUND
      const forbiddenRes = await DELETE(
        new Request(`http://localhost/api/game/campaigns?campaignId=${id1}`, {
          method: "DELETE",
          headers: { cookie: cookieB },
        }),
      );
      expect(forbiddenRes.status).toBe(404);
      expect(await forbiddenRes.json()).toMatchObject({
        ok: false,
        code: "CAMPAIGN_NOT_FOUND",
      });

      // Borrado por query ?campaignId=
      const delQueryRes = await DELETE(
        new Request(`http://localhost/api/game/campaigns?campaignId=${id1}`, {
          method: "DELETE",
          headers: { cookie: cookieA },
        }),
      );
      expect(delQueryRes.status).toBe(200);
      expect(await delQueryRes.json()).toEqual({
        ok: true,
        deletedCount: 1,
        deletedCampaignId: id1,
      });

      // Borrado por JSON body { campaignId }
      const delBodyRes = await DELETE(
        new Request("http://localhost/api/game/campaigns", {
          method: "DELETE",
          headers: {
            "content-type": "application/json",
            cookie: cookieA,
          },
          body: JSON.stringify({ campaignId: id2 }),
        }),
      );
      expect(delBodyRes.status).toBe(200);
      expect(await delBodyRes.json()).toEqual({
        ok: true,
        deletedCount: 1,
        deletedCampaignId: id2,
      });

      const latestRes = await GET(
        new Request("http://localhost/api/game/campaigns", {
          headers: { cookie: cookieA },
        }),
      );
      expect(latestRes.status).toBe(200);
      expect((await latestRes.json()) as { campaignId: string | null }).toMatchObject({
        campaignId: null,
      });
    });
  });

  it("borra todas las campañas con ?all=1 / body { all: true } con y sin exceptCampaignId, y valida 400 INVALID_DELETE_REQUEST", async () => {
    await withMemoryEnv(async () => {
      const guestId = randomUUID();
      const cookie = makeCookieHeader(guestId);

      const id1 = await createViaRoute(cookie, "Uno");
      const id2 = await createViaRoute(cookie, "Dos");
      const id3 = await createViaRoute(cookie, "Tres");

      // Inválidos -> 400 INVALID_DELETE_REQUEST
      for (const req of [
        new Request("http://localhost/api/game/campaigns", {
          method: "DELETE",
          headers: { cookie },
        }),
        new Request("http://localhost/api/game/campaigns?campaignId=", {
          method: "DELETE",
          headers: { cookie },
        }),
        new Request(`http://localhost/api/game/campaigns?campaignId=${id1}&all=1`, {
          method: "DELETE",
          headers: { cookie },
        }),
        new Request("http://localhost/api/game/campaigns", {
          method: "DELETE",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({ all: false }),
        }),
        new Request("http://localhost/api/game/campaigns", {
          method: "DELETE",
          headers: { "content-type": "application/json", cookie },
          body: "{not-json",
        }),
      ]) {
        const badRes = await DELETE(req);
        expect(badRes.status).toBe(400);
        expect(await badRes.json()).toMatchObject({
          ok: false,
          code: "INVALID_DELETE_REQUEST",
        });
      }

      // ?all=1&exceptCampaignId=id2 conserva id2 y borra id1 e id3
      const delExceptRes = await DELETE(
        new Request(
          `http://localhost/api/game/campaigns?all=1&exceptCampaignId=${id2}`,
          {
            method: "DELETE",
            headers: { cookie },
          },
        ),
      );
      expect(delExceptRes.status).toBe(200);
      expect(await delExceptRes.json()).toEqual({ ok: true, deletedCount: 2 });

      const listAfterExcept = await GET(
        new Request("http://localhost/api/game/campaigns?list=1", {
          headers: { cookie },
        }),
      );
      const listJson = (await listAfterExcept.json()) as {
        total: number;
        items: Array<{ campaignId: string }>;
      };
      expect(listJson.total).toBe(1);
      expect(listJson.items.map((i) => i.campaignId)).toEqual([id2]);
      expect(listJson.items.map((i) => i.campaignId)).not.toContain(id3);

      // JSON body { all: true } borra la restante
      const delAllBodyRes = await DELETE(
        new Request("http://localhost/api/game/campaigns", {
          method: "DELETE",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({ all: true }),
        }),
      );
      expect(delAllBodyRes.status).toBe(200);
      expect(await delAllBodyRes.json()).toEqual({ ok: true, deletedCount: 1 });

      const listAfterAll = await GET(
        new Request("http://localhost/api/game/campaigns?list=1", {
          headers: { cookie },
        }),
      );
      expect((await listAfterAll.json()) as { total: number }).toMatchObject({
        total: 0,
      });
    });
  });
});
