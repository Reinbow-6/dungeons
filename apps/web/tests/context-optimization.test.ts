import { createRng } from "@dungeons/rules";
import { convertToModelMessages, validateUIMessages } from "ai";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createDmTools,
  type DmChatMessagePart,
  type DmChatUIMessage,
  type DmToolRuntime,
} from "@/agent/agent";
import { GET as getUsage } from "@/app/api/usage/route";
import {
  pruneHistoricalToolOutputs,
  summarizeToolPartForHistory,
} from "@/lib/ai/prune-tool-history";
import { resolveGuestSessionFromRequest } from "@/lib/auth/guest-session";
import { SEEDED_INTRO_TOOL_CALL_ID } from "@/lib/game/intro";
import { InMemoryGameStore } from "@/lib/game/store";
import {
  getDailyModelUsageForGuest,
  recordModelUsage,
  resetMemoryModelUsage,
  utcDayKey,
} from "@/lib/observability/logger";
import {
  extractTurnUsageTelemetry,
  extractUsageTelemetry,
} from "@/lib/observability/usage";

const GUEST = "33333333-3333-4333-8333-333333333333";

function makeDummyRuntime(
  loaded: Awaited<ReturnType<InMemoryGameStore["createCampaign"]>>,
): DmToolRuntime {
  return {
    campaignId: loaded.campaignId,
    sessionId: loaded.sessionId,
    guestId: GUEST,
    getState: () => loaded.state,
    getInitialState: () => loaded.initialState,
    getEvents: () => loaded.events,
    commitEvent: async () => {
      throw new Error("not used in validation test");
    },
    commitRollback: async () => {
      throw new Error("not used in validation test");
    },
    rng: createRng("ctx-opt-test"),
    createId: () => "id_1",
    now: () => "2026-11-23T00:00:00.000Z",
  };
}

describe("Phase 1a: Seeded deterministic intro (0 tokens at turn 0)", () => {
  it("seeds an opening assistant message with narrative + 3 suggested actions on campaign creation", async () => {
    const store = new InMemoryGameStore();
    const loaded = await store.createCampaign({
      guestId: GUEST,
      presetId: "pc_kael",
      ruleset: "5e-full",
    });

    expect(loaded.messages).toHaveLength(1);
    const intro = loaded.messages[0]!;
    expect(intro.role).toBe("assistant");
    expect(intro.eventSeq).toBe(0);

    const introParts = intro.parts as DmChatMessagePart[];
    const textPart = introParts.find((p) => p.type === "text");
    expect(textPart).toBeDefined();
    expect(
      textPart && textPart.type === "text" ? textPart.text : "",
    ).toContain("Kael");

    const suggestPart = introParts.find(
      (p) => p.type === "tool-suggest_actions",
    );
    expect(suggestPart).toBeDefined();
    expect(suggestPart).toMatchObject({
      type: "tool-suggest_actions",
      toolCallId: SEEDED_INTRO_TOOL_CALL_ID,
      state: "output-available",
    });
    const output = (suggestPart as { output?: { actions?: unknown[] } }).output;
    expect(output?.actions).toHaveLength(3);

    // Must pass real AI SDK validateUIMessages + pruning + convertToModelMessages
    const tools = createDmTools(makeDummyRuntime(loaded));
    const turn1Messages: DmChatUIMessage[] = [
      {
        id: intro.id,
        role: "assistant",
        parts: introParts,
      },
      {
        id: "u-turn-1",
        role: "user",
        parts: [{ type: "text", text: "Escudriño los juncos y la niebla." }],
      },
    ];

    const validated = await validateUIMessages<DmChatUIMessage>({
      messages: turn1Messages,
      tools,
    });
    expect(validated).toHaveLength(2);

    const pruned = pruneHistoricalToolOutputs(validated);
    expect(pruned[0]!.parts).toHaveLength(1);
    expect(pruned[0]!.parts[0]!.type).toBe("text");

    const modelMsgs = await convertToModelMessages(pruned);
    expect(modelMsgs).toHaveLength(2);
    expect(modelMsgs[0]!.role).toBe("assistant");
    expect(modelMsgs[1]!.role).toBe("user");
  });
});

describe("Phase 1b: Historical tool output pruning", () => {
  it("collapses historical tool outputs & drops suggest_actions/reasoning while preserving the final active assistant message", async () => {
    const messages: DmChatUIMessage[] = [
      {
        id: "u1",
        role: "user",
        parts: [{ type: "text", text: "Observo los juncos de la orilla." }],
      },
      {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: "reasoning",
            text: "Voy a pedir tirada de percepción contra CD 12.",
          },
          {
            type: "tool-resolve_check",
            toolCallId: "tc-1",
            state: "output-available",
            input: {
              sceneId: "escena_01_orilla",
              actorId: "pc_kael",
              skill: "perception",
              dc: 12,
            },
            output: {
              ok: true,
              messageEs:
                "Kael obtiene 15 (12 + 3) contra CD 12 en Percepción y supera la prueba con amplio margen.",
              checkId: "chk_1",
              skill: "perception",
              rolls: [12],
              naturalRoll: 12,
              modifier: 3,
              total: 15,
              dc: 12,
              success: true,
              margin: 3,
              seq: 1,
            },
          },
          {
            type: "text",
            text: "Entre los juncos distinguís dos siluetas con arcos tensos.",
          },
          {
            type: "tool-suggest_actions",
            toolCallId: "tc-2",
            state: "output-available",
            input: {
              sceneLabel: "ORILLA",
              actions: [
                { skill: "Persuasión", label: "Hablar con las siluetas" },
                { skill: "Sigilo", label: "Agacharte entre el barro" },
              ],
            },
            output: {
              ok: true,
              sceneLabel: "ORILLA",
              actions: [
                { skill: "Persuasión", label: "Hablar con las siluetas" },
                { skill: "Sigilo", label: "Agacharte entre el barro" },
              ],
            },
          },
        ],
      },
      {
        id: "u2",
        role: "user",
        parts: [{ type: "text", text: "Investigo las huellas y ataco si saltan." }],
      },
      {
        id: "a2",
        role: "assistant",
        parts: [
          {
            type: "tool-investigate",
            toolCallId: "tc-3",
            state: "output-available",
            input: {
              sceneId: "escena_01_orilla",
              actorId: "pc_kael",
              skill: "investigation",
            },
            output: {
              ok: true,
              messageEs: "Descubrís huellas frescas de botas herradas.",
              seq: 2,
              total: 16,
              unlockedClues: [
                {
                  id: "pista_orilla_huellas",
                  dc: 12,
                  titleEs: "Huellas en el barro",
                  descriptionEs: "Pisadas de botas herradas hacia el este.",
                  tacticalEffectEs: "Ventaja en seguimiento.",
                },
              ],
            },
          },
          {
            type: "tool-combat_attack",
            toolCallId: "tc-4",
            state: "output-available",
            input: {
              sceneId: "escena_01_orilla",
              attackerId: "pc_kael",
              targetId: "bandido_1",
            },
            output: {
              ok: true,
              messageEs: "Impacto certero por 7 de daño.",
              hit: true,
              isCritical: false,
              damageApplied: 7,
              targetName: "Bandido",
            },
          },
          {
            type: "text",
            text: "Tu estocada hace retroceder al bandido hacia el barro.",
          },
          {
            type: "tool-suggest_actions",
            toolCallId: "tc-5",
            state: "output-available",
            input: {
              actions: [
                { skill: "Combate", label: "Rematar al bandido" },
                { skill: "Intimidación", label: "Exigir su rendición" },
              ],
            },
            output: {
              ok: true,
              actions: [
                { skill: "Combate", label: "Rematar al bandido" },
                { skill: "Intimidación", label: "Exigir su rendición" },
              ],
            },
          },
        ],
      },
      {
        id: "u3",
        role: "user",
        parts: [{ type: "text", text: "Intento intimidarlos para que bajen los arcos." }],
      },
      {
        id: "a3",
        role: "assistant",
        parts: [
          {
            type: "tool-declare_check",
            toolCallId: "tc-6",
            state: "output-available",
            input: {
              sceneId: "escena_01_orilla",
              actorId: "pc_kael",
              skill: "intimidation",
              dc: 13,
              promptEs: "Tirá 1d20 + Intimidación",
            },
            output: {
              ok: true,
              checkId: "chk_2",
              skill: "intimidation",
              declaredTotal: 17,
              dieResults: [15],
              naturalRoll: 15,
              expectedModifier: 2,
              dc: 13,
              success: true,
              margin: 4,
            },
          },
        ],
      },
    ];

    const pruned = pruneHistoricalToolOutputs(messages);
    expect(pruned).toHaveLength(6);

    // Historical a1 collapsed to 1 text part inside <resumen_motor> without reasoning or suggest_actions
    expect(pruned[1]!.parts).toHaveLength(1);
    expect(pruned[1]!.parts[0]!.type).toBe("text");
    const a1Text =
      pruned[1]!.parts[0]!.type === "text" ? pruned[1]!.parts[0]!.text : "";
    expect(a1Text).toContain("<resumen_motor>");
    expect(a1Text).toContain("[resolve_check → perception 15 vs CD 12, éxito]");
    expect(a1Text).toContain("</resumen_motor>");
    expect(a1Text).toContain("dos siluetas con arcos tensos");
    expect(a1Text).not.toContain("suggest_actions");
    expect(a1Text).not.toContain("Voy a pedir tirada");

    // Historical a2 collapsed to 1 text part with both canonical tool lines
    expect(pruned[3]!.parts).toHaveLength(1);
    const a2Text =
      pruned[3]!.parts[0]!.type === "text" ? pruned[3]!.parts[0]!.text : "";
    expect(a2Text).toContain("<resumen_motor>");
    expect(a2Text).toContain("[investigate → total 16, +1 pista]");
    expect(a2Text).toContain("[combat_attack → impacto, 7 daño a Bandido]");
    expect(a2Text).toContain("hace retroceder al bandido");
    expect(a2Text).not.toContain("Rematar al bandido");

    // Final active assistant a3 preserved verbatim (resuming declare_check)
    expect(pruned[5]).toBe(messages[5]);
    expect(pruned[5]!.parts[0]!.type).toBe("tool-declare_check");

    // Model message serialization shrinks significantly vs unpruned
    const unprunedSize = JSON.stringify(
      await convertToModelMessages(messages),
    ).length;
    const prunedSize = JSON.stringify(
      await convertToModelMessages(pruned),
    ).length;
    expect(prunedSize).toBeLessThan(unprunedSize * 0.65);
  });

  it("prunes ALL historical assistant turns when the latest message is from the user", () => {
    const messages: DmChatUIMessage[] = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "Hola" }] },
      {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: "tool-transition_scene",
            toolCallId: "tc-1",
            state: "output-available",
            input: { targetSceneId: "escena_03_parlamento", reason: "Avance" },
            output: {
              ok: true,
              messageEs: "Avanzás al claro de la ciénaga.",
              toSceneId: "escena_03_parlamento",
              titleEs: "El Parlamento en la Ciénaga",
            },
          },
          { type: "text", text: "Llegás al claro." },
        ],
      },
      { id: "u2", role: "user", parts: [{ type: "text", text: "Saludo." }] },
    ];

    const pruned = pruneHistoricalToolOutputs(messages);
    expect(pruned[1]!.parts).toHaveLength(1);
    expect(pruned[1]!.parts[0]).toEqual({
      type: "text",
      text: "<resumen_motor>\n[transition_scene → El Parlamento en la Ciénaga]\n</resumen_motor>\n\nLlegás al claro.",
    });
  });

  it("returns null for suggest_actions and formats rejected tools concisely", () => {
    expect(
      summarizeToolPartForHistory({
        type: "tool-suggest_actions",
        toolCallId: "x",
        state: "output-available",
        input: { actions: [] },
        output: { ok: true, actions: [] },
      } as DmChatMessagePart),
    ).toBeNull();

    expect(
      summarizeToolPartForHistory({
        type: "tool-resolve_check",
        toolCallId: "y",
        state: "output-available",
        input: {
          sceneId: "escena_01_orilla",
          actorId: "pc_kael",
          skill: "perception",
        },
        output: {
          ok: false,
          code: "INVALID_DC_REF",
          messageEs: "DC inválida",
        },
      } as DmChatMessagePart),
    ).toBe("[resolve_check → rechazado (INVALID_DC_REF)]");
  });
});

describe("Phase 2a & 2b: Cache telemetry extraction & per-session daily usage", () => {
  beforeEach(() => {
    resetMemoryModelUsage();
  });

  it("extracts cachedTokens from AI SDK v7 inputTokenDetails and OpenRouter raw fallbacks", () => {
    const standard = extractUsageTelemetry({
      inputTokens: 4000,
      outputTokens: 320,
      totalTokens: 4320,
      inputTokenDetails: {
        noCacheTokens: 1000,
        cacheReadTokens: 3000,
        cacheWriteTokens: 0,
      },
    });
    expect(standard).toEqual({
      promptTokens: 4000,
      completionTokens: 320,
      cachedTokens: 3000,
      totalTokens: 4320,
      cacheHitRate: 0.75,
    });

    const openRouterRaw = extractUsageTelemetry({
      inputTokens: 5000,
      outputTokens: 250,
      raw: {
        prompt_tokens_details: {
          cached_tokens: 3500,
        },
      },
    });
    expect(openRouterRaw.cachedTokens).toBe(3500);
    expect(openRouterRaw.cacheHitRate).toBe(0.7);
    expect(openRouterRaw.totalTokens).toBe(5250);

    const multiStep = extractTurnUsageTelemetry(
      {
        inputTokens: 10000,
        outputTokens: 500,
      },
      [
        {
          inputTokens: 5000,
          outputTokens: 120,
          raw: { prompt_tokens_details: { cached_tokens: 3200 } },
        },
        {
          inputTokens: 5000,
          outputTokens: 380,
          raw: { prompt_tokens_details: { cached_tokens: 4300 } },
        },
      ],
    );
    expect(multiStep.cachedTokens).toBe(7500);
    expect(multiStep.cacheHitRate).toBe(0.75);
  });

  it("records real usage for whitelisted accounts and exposes it via GET /api/usage", async () => {
    const dayKey = utcDayKey();
    const initRes = await getUsage(new Request("http://localhost:3000/api/usage"));
    expect(initRes.status).toBe(200);
    expect(initRes.headers.get("Cache-Control")).toBe("no-store");

    const setCookie = initRes.headers.get("Set-Cookie");
    expect(setCookie).toBeTruthy();
    const cookieHeader = setCookie!.split(";")[0]!;
    const guest = resolveGuestSessionFromRequest(
      new Request("http://localhost:3000/api/usage", {
        headers: { cookie: cookieHeader },
      }),
    );

    await recordModelUsage({
      guestId: guest.guestId,
      userId: "user-whitelisted-1",
      accessTier: "whitelisted",
      provider: "openrouter",
      modelId: "deepseek/deepseek-v3.2",
      promptTokens: 6000,
      completionTokens: 400,
      cachedTokens: 4200,
    });
    await recordModelUsage({
      guestId: guest.guestId,
      userId: "user-whitelisted-1",
      accessTier: "whitelisted",
      provider: "openrouter",
      modelId: "deepseek/deepseek-v3.2",
      promptTokens: 4000,
      completionTokens: 300,
      cachedTokens: 2800,
    });

    const summary = await getDailyModelUsageForGuest(guest.guestId, dayKey);
    expect(summary.totalRequests).toBe(2);
    expect(summary.totalPromptTokens).toBe(10000);
    expect(summary.totalCompletionTokens).toBe(700);
    expect(summary.totalCachedTokens).toBe(7000);
    expect(summary.cacheHitRate).toBe(0.7);
    expect(summary.byModel).toHaveLength(1);
    expect(summary.byModel[0]!.accessTier).toBe("whitelisted");

    const res = await getUsage(
      new Request("http://localhost:3000/api/usage", {
        headers: { cookie: cookieHeader },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      totalRequests: number;
      totalPromptTokens: number;
      totalCachedTokens: number;
      cacheHitRate: number;
      byModel: Array<{ modelId: string; accessTier: string }>;
    };
    expect(body.ok).toBe(true);
    expect(body.totalRequests).toBe(2);
    expect(body.totalPromptTokens).toBe(10000);
    expect(body.totalCachedTokens).toBe(7000);
    expect(body.cacheHitRate).toBe(0.7);
    expect(body.byModel[0]).toMatchObject({
      modelId: "deepseek/deepseek-v3.2",
      accessTier: "whitelisted",
    });
  });
});
