import { createRng } from "@dungeons/rules";
import { convertToModelMessages, validateUIMessages } from "ai";
import { beforeEach, describe, expect, it } from "vitest";

import {
  buildDmPromptLayers,
  createDmTools,
  injectDynamicContextIntoMessages,
  selectActiveDmTools,
  type DmChatMessagePart,
  type DmChatUIMessage,
  type DmToolRuntime,
} from "@/agent/agent";
import { GET as getUsage } from "@/app/api/usage/route";
import {
  compactConversationContext,
  DEFAULT_MAX_ESTIMATED_CHARS,
  DEFAULT_MAX_RECENT_MESSAGES,
} from "@/lib/ai/context-window";
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
  it("starts new campaigns empty for 3-option launch and seeds deterministic intro on seedOpeningIntro", async () => {
    const store = new InMemoryGameStore();
    const created = await store.createCampaign({
      guestId: GUEST,
      presetId: "pc_kael",
      ruleset: "5e-full",
    });

    // New campaign starts clean so the 3-option screen is visible
    expect(created.messages).toHaveLength(0);

    const loaded = (await store.seedOpeningIntro(created.campaignId, GUEST))!;
    expect(loaded).not.toBeNull();
    expect(loaded.messages).toHaveLength(1);

    // Calling seedOpeningIntro again must be idempotent
    const seededAgain = (await store.seedOpeningIntro(created.campaignId, GUEST))!;
    expect(seededAgain.messages).toHaveLength(1);

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

    // Historical a1 keeps clean narrative prose without synthetic tags, reasoning, or suggest_actions
    expect(pruned[1]!.parts).toHaveLength(1);
    expect(pruned[1]!.parts[0]!.type).toBe("text");
    const a1Text =
      pruned[1]!.parts[0]!.type === "text" ? pruned[1]!.parts[0]!.text : "";
    expect(a1Text).toBe(
      "Entre los juncos distinguís dos siluetas con arcos tensos.",
    );
    expect(a1Text).not.toContain("<resumen_motor>");
    expect(a1Text).not.toContain("resolve_check");
    expect(a1Text).not.toContain("suggest_actions");
    expect(a1Text).not.toContain("Voy a pedir tirada");

    // Historical a2 keeps clean narrative prose without verbose tool payloads
    expect(pruned[3]!.parts).toHaveLength(1);
    const a2Text =
      pruned[3]!.parts[0]!.type === "text" ? pruned[3]!.parts[0]!.text : "";
    expect(a2Text).toBe(
      "Tu estocada hace retroceder al bandido hacia el barro.",
    );
    expect(a2Text).not.toContain("<resumen_motor>");
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
      text: "Llegás al claro.",
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

describe("Phase 4: Stable prompt prefix caching & on-demand Lorebook", () => {
  it("produces byte-identical staticSystemPrompt across turns even when state, combat, events, and memory change", async () => {
    const store = new InMemoryGameStore();
    const loaded = await store.createCampaign({
      guestId: GUEST,
      presetId: "pc_kael",
      ruleset: "5e-full",
    });

    const turn1 = buildDmPromptLayers(loaded.state, loaded.events, {
      sessionNumber: 1,
      latestUserText: "Miro la orilla.",
      recentConversationTexts: ["Miro la orilla."],
    });

    // Mutate dynamic turn state heavily for turn 2
    const mutatedState = structuredClone(loaded.state);
    mutatedState.lastSeq = 12;
    mutatedState.sceneId = "escena_04_campamento";
    mutatedState.characters.pc_kael!.hp.current = 3;
    mutatedState.characters.pc_kael!.level = 2;
    mutatedState.characters.pc_kael!.conditions = ["poisoned"];
    mutatedState.unlockedClues = {
      escena_04_campamento: ["pista_camp_14"],
    };
    mutatedState.combat = {
      active: true,
      round: 3,
      turnIndex: 0,
      combatants: [
        {
          id: "pc_kael",
          actorId: "pc_kael",
          kind: "pc",
          name: "Kael de Oakhaven",
          initiative: 15,
          hp: { current: 3, max: 11 },
          ac: 14,
          attacks: [],
          vulnerabilities: [],
          resistances: [],
          immunities: [],
          conditions: ["poisoned"],
          defeated: false,
        },
      ],
    };

    const turn2 = buildDmPromptLayers(
      mutatedState,
      [
        {
          id: "ev_1",
          seq: 12,
          type: "COMBAT_STARTED",
          source: "dm-agent",
          actor: "pc_kael",
          timestamp: "2026-11-26T22:00:00.000Z",
          revertedByEventId: null,
          payload: { sceneId: "escena_04_campamento", enemyIds: ["explorador"] },
        } as unknown as (typeof loaded.events)[number],
      ],
      {
        sessionNumber: 2,
        worldSummary: "Frontera en guerra.",
        olderTurnsDigest: "Resumen previo de 8 turnos.",
        latestUserText: "Ataco en el campamento.",
        recentConversationTexts: [
          "Llegamos al embarcadero",
          "Ataco en el campamento.",
        ],
        memoryFacts: [
          {
            id: "mf_1",
            campaignId: loaded.campaignId,
            sessionId: loaded.sessionId,
            category: "npc",
            content: "Pacto con los vigías del campamento.",
            importance: 9,
            eventSeq: 5,
            revertedBySeq: null,
            source: "dm-memory",
            createdAt: "2026-11-26T22:00:00.000Z",
          },
        ],
      },
    );

    expect(turn1.staticSystemPrompt).toBe(turn2.staticSystemPrompt);
    expect(turn1.staticSystemPrompt).toContain("## Contexto estructural de la campaña");
    expect(turn1.staticSystemPrompt).not.toContain("lastSeq");
    expect(turn1.staticSystemPrompt).not.toContain("11/11");
    expect(turn2.dynamicTurnContext).toContain("3/11");
    expect(turn2.dynamicTurnContext).toContain("<lorebook>");
  });

  it("injects <game_state> only into the latest user message without altering earlier messages or adding system messages", () => {
    const firstUser = {
      id: "m1",
      role: "user" as const,
      content: "<player_action>\nHola\n</player_action>",
    };
    const firstAssistant = {
      id: "m2",
      role: "assistant" as const,
      content: "La niebla cubre el río.",
    };
    const secondUserArray = {
      id: "m3",
      role: "user" as const,
      content: [{ type: "text", text: "<player_action>\nAvanzo\n</player_action>" }],
    };

    const injected = injectDynamicContextIntoMessages(
      [firstUser, firstAssistant, secondUserArray],
      "## Estado vivo\n- Escena: orilla",
    );

    expect(injected).toHaveLength(3);
    expect(injected.every((m) => (m.role as string) !== "system")).toBe(true);
    // Earlier messages stay untouched byte-for-byte (preserving reference & cache prefix)
    expect(injected[0]).toBe(firstUser);
    expect(injected[1]).toBe(firstAssistant);

    const updatedParts = injected[2]!.content as Array<{
      type: string;
      text: string;
    }>;
    expect(updatedParts[0]!.text).toContain("<game_state>");
    expect(updatedParts[0]!.text).toContain("## Estado vivo");
    expect(updatedParts[0]!.text).toContain("</game_state>");
    expect(updatedParts[0]!.text).toContain("<player_action>\nAvanzo\n</player_action>");

    // Also supports string content on latest user message
    const injectedString = injectDynamicContextIntoMessages(
      [firstUser],
      "## Estado vivo",
    );
    expect(typeof injectedString[0]!.content).toBe("string");
    expect(injectedString[0]!.content as string).toContain("<game_state>");
    expect(injectedString[0]!.content as string).toContain("<player_action>\nHola");
  });

  it("activates Lorebook entries by recent mentions and respects requiresAnyClue anti-spoiler guard", async () => {
    const store = new InMemoryGameStore();
    const loaded = await store.createCampaign({ guestId: GUEST });
    loaded.state.sceneId = "escena_06_comandante";

    const lockedLayers = buildDmPromptLayers(loaded.state, loaded.events, {
      recentConversationTexts: [
        "Pregunto a Mireia por sus órdenes y el pliego sellado.",
      ],
    });
    expect(
      lockedLayers.lorebook.entries.map((e) => e.entry.id),
    ).not.toContain("lore_desercion_mireia");
    expect(lockedLayers.dynamicTurnContext).not.toContain(
      "desobedeció la retirada",
    );

    loaded.state.unlockedClues = {
      escena_06_comandante: ["pista_mireia_14"],
    };
    const unlockedLayers = buildDmPromptLayers(loaded.state, loaded.events, {
      recentConversationTexts: [
        "Le muestro las órdenes a Mireia en el muelle.",
      ],
    });
    expect(unlockedLayers.lorebook.entries.map((e) => e.entry.id)).toContain(
      "lore_desercion_mireia",
    );
    expect(unlockedLayers.lorebook.usedTokens).toBeLessThanOrEqual(450);
    expect(unlockedLayers.dynamicTurnContext).toContain("<lorebook>");
    expect(unlockedLayers.dynamicTurnContext).toContain(
      "Órdenes Rotas de la Comandante Mireia",
    );
  });
});

describe("Phase 3 & Phase 5: Dynamic tool filtering & <game_state> trims", () => {
  it("filters DM tools dynamically by combat, spellcasting, death saves, rollAuthority, clues, and transitions", async () => {
    const store = new InMemoryGameStore();
    const loaded = await store.createCampaign({
      guestId: GUEST,
      presetId: "pc_kael",
      mode: "digital",
      ruleset: "5e-lite",
    });
    const allTools = createDmTools(makeDummyRuntime(loaded));

    // Exploration, digital, non-caster, clues present, transitions present
    const exploreKeys = Object.keys(
      selectActiveDmTools(allTools, loaded.state),
    );
    expect(exploreKeys).not.toContain("combat_attack");
    expect(exploreKeys).not.toContain("combat_next_turn");
    expect(exploreKeys).not.toContain("combat_end");
    expect(exploreKeys).not.toContain("cast_spell");
    expect(exploreKeys).not.toContain("death_save");
    expect(exploreKeys).not.toContain("declare_check");
    expect(exploreKeys).toContain("resolve_check");
    expect(exploreKeys).toContain("investigate");
    expect(exploreKeys).toContain("transition_scene");
    expect(exploreKeys).toContain("combat_start");

    // Active combat in 5e-full with dying spellcaster in hybrid mode, no clues/transitions
    const combatState = structuredClone(loaded.state);
    combatState.ruleset = "5e-full";
    combatState.sceneId = "escena_08_otra_orilla";
    combatState.combat = {
      active: true,
      round: 1,
      turnIndex: 0,
      combatants: [],
    };
    combatState.characters.pc_kael!.hp.current = 0;
    combatState.characters.pc_kael!.rollAuthority = "player-declared";
    combatState.characters.pc_kael!.spellSlots = { "1": { current: 1, max: 1 } };
    combatState.characters.pc_kael!.spellcastingAbility = "wis";

    const combatKeys = Object.keys(
      selectActiveDmTools(allTools, combatState),
    );
    expect(combatKeys).toContain("combat_attack");
    expect(combatKeys).toContain("combat_next_turn");
    expect(combatKeys).toContain("combat_end");
    expect(combatKeys).toContain("cast_spell");
    expect(combatKeys).toContain("death_save");
    expect(combatKeys).toContain("declare_check");
    expect(combatKeys).not.toContain("combat_start");
    expect(combatKeys).not.toContain("take_rest");
    expect(combatKeys).not.toContain("transition_scene");
    expect(combatKeys).not.toContain("investigate");
    expect(combatKeys).not.toContain("resolve_check");
    expect(combatKeys).not.toContain("resolve_save");
  });

  it("trims narrativeHook after seq 0, limits proficient skills, and tightens active window defaults", async () => {
    expect(DEFAULT_MAX_RECENT_MESSAGES).toBe(10);
    expect(DEFAULT_MAX_ESTIMATED_CHARS).toBe(12_000);

    const store = new InMemoryGameStore();
    const loaded = await store.createCampaign({
      guestId: GUEST,
      presetId: "pc_kael",
    });

    const seq0 = buildDmPromptLayers(loaded.state, loaded.events);
    expect(seq0.dynamicTurnContext).toContain("Gancho narrativo");
    expect(seq0.dynamicTurnContext).toContain("Competencias clave:");
    expect(seq0.dynamicTurnContext).not.toContain("deception:");

    const afterTurn1 = structuredClone(loaded.state);
    afterTurn1.lastSeq = 1;
    const seq1 = buildDmPromptLayers(afterTurn1, loaded.events);
    expect(seq1.dynamicTurnContext).not.toContain("Gancho narrativo");

    const prevEnv = process.env.MAX_CONTEXT_CHARS;
    process.env.MAX_CONTEXT_CHARS = "120";
    try {
      const longMessages: DmChatUIMessage[] = [
        {
          id: "u1",
          role: "user",
          parts: [{ type: "text", text: "Mensaje viejo ".repeat(10) }],
        },
        {
          id: "a1",
          role: "assistant",
          parts: [{ type: "text", text: "Respuesta vieja ".repeat(10) }],
        },
        {
          id: "u2",
          role: "user",
          parts: [{ type: "text", text: "Último turno." }],
        },
      ];
      const compacted = compactConversationContext({ messages: longMessages });
      expect(compacted.recentMessages).toHaveLength(1);
      expect(compacted.trimmedCount).toBe(2);
    } finally {
      if (prevEnv === undefined) {
        delete process.env.MAX_CONTEXT_CHARS;
      } else {
        process.env.MAX_CONTEXT_CHARS = prevEnv;
      }
    }
  });
});
