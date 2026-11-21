import { randomUUID } from "node:crypto";
import { createRng, declareCheck, reduceEvents } from "@dungeons/rules";
import type { ToolExecutionOptions } from "ai";
import { describe, expect, it } from "vitest";
import type { z } from "zod";

import {
  buildDmSystemPrompt,
  createDmTools,
  type DmToolRuntime,
} from "@/agent/agent";
import { InMemoryGameStore } from "@/lib/game/store";

const EXEC_OPTS: ToolExecutionOptions<never> = {
  toolCallId: "test-call",
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

async function setupRuntime(options: {
  mode?: "digital" | "hybrid";
  presetId?: "pc_kael" | "pc_brenna" | "pc_lira";
  seed?: string;
} = {}) {
  const store = new InMemoryGameStore();
  const guestId = "11111111-1111-4111-8111-111111111111";
  const loaded = await store.createCampaign({
    guestId,
    presetId: options.presetId ?? "pc_kael",
    mode: options.mode ?? "digital",
    ruleset: "5e-lite",
  });

  let state = loaded.state;
  let events = loaded.events;
  let idCounter = 0;

  const rt: DmToolRuntime = {
    campaignId: loaded.campaignId,
    sessionId: loaded.sessionId,
    guestId,
    getState: () => state,
    getInitialState: () => loaded.initialState,
    getEvents: () => events,
    commitEvent: async (event, nextState) => {
      await store.appendEvent(loaded.campaignId, loaded.sessionId, event, nextState);
      state = nextState;
      events = [...events, event];
    },
    commitRollback: async (targetSeq) => {
      const rb = await store.rollbackCampaign(loaded.campaignId, guestId, targetSeq);
      if (rb.ok) {
        state = rb.state;
        events = rb.events;
      }
      return rb;
    },
    rng: createRng(options.seed ?? "dm-agent-test-seed"),
    createId: () => randomUUID(),
    now: () => `2026-11-18T23:${String(++idCounter).padStart(2, "0")}:00.000Z`,
  };

  return { store, guestId, loaded, rt };
}

describe("DM agent (Eve architecture) & Aguas Quietas E2E", () => {
  it("injects scene context, allowed transitions, modifiers, and hybrid instruction into system prompt", async () => {
    const digital = await setupRuntime({ mode: "digital", presetId: "pc_kael" });
    const promptDigital = buildDmSystemPrompt(
      digital.rt.getState(),
      digital.rt.getEvents(),
    );
    expect(promptDigital).toContain("escena_01_orilla");
    expect(promptDigital).toContain("escena_03_parlamento");
    expect(promptDigital).toContain("investigation: +4");
    expect(promptDigital).toContain("MODO DIGITAL");

    const hybrid = await setupRuntime({ mode: "hybrid", presetId: "pc_lira" });
    const promptHybrid = buildDmSystemPrompt(
      hybrid.rt.getState(),
      hybrid.rt.getEvents(),
    );
    expect(promptHybrid).toContain("player-declared");
    expect(promptHybrid).toContain("MODO HÍBRIDO");
    expect(promptHybrid).toContain("Lira Vael");
  });

  it("rejects LLM-injected numeric roll/total/modifier fields across all DM tool input schemas", async () => {
    const { rt } = await setupRuntime();
    const tools = createDmTools(rt);

    const parse = (schema: unknown, data: unknown) =>
      (schema as z.ZodTypeAny).safeParse(data).success;

    expect(
      parse(tools.resolve_check.inputSchema, {
        sceneId: "escena_01_orilla",
        actorId: "pc_kael",
        skill: "perception",
        dc: 12,
        total: 18,
      }),
    ).toBe(false);

    expect(
      parse(tools.resolve_save.inputSchema, {
        sceneId: "escena_01_orilla",
        actorId: "pc_kael",
        ability: "dex",
        dc: 13,
        modifier: 5,
      }),
    ).toBe(false);

    expect(
      parse(tools.declare_check.inputSchema, {
        sceneId: "escena_01_orilla",
        actorId: "pc_kael",
        skill: "perception",
        dc: 12,
        promptEs: "Tirá percepción",
        declaredTotal: 15,
        dieResults: [11],
      }),
    ).toBe(false);

    // P1.9: declare_check acepta dcRef sin dc numérico explícito, pero exige al menos uno de los dos
    expect(
      parse(tools.declare_check.inputSchema, {
        sceneId: "escena_01_orilla",
        actorId: "pc_kael",
        skill: "perception",
        dcRef: "detectar_emboscada",
        promptEs: "Tirá percepción física",
      }),
    ).toBe(true);

    expect(
      parse(tools.declare_check.inputSchema, {
        sceneId: "escena_01_orilla",
        actorId: "pc_kael",
        skill: "perception",
        promptEs: "Tirá sin CD ni dcRef",
      }),
    ).toBe(false);

    expect(
      parse(tools.investigate.inputSchema, {
        sceneId: "escena_04_campamento",
        actorId: "pc_kael",
        total: 18,
      }),
    ).toBe(false);

    expect(
      parse(tools.transition_scene.inputSchema, {
        targetSceneId: "escena_03_parlamento",
        reason: "Diálogo",
        seq: 99,
      }),
    ).toBe(false);

    expect(
      parse(tools.inventory.inputSchema, {
        sceneId: "escena_01_orilla",
        actorId: "pc_kael",
        itemId: "rations",
        qtyDelta: -1,
        reason: "Consumo",
        total: 1,
      }),
    ).toBe(false);

    expect(
      parse(tools.rollback_to_event.inputSchema, {
        targetSeq: 0,
        reason: "Reiniciar",
        dieResults: [1],
      }),
    ).toBe(false);

    expect(
      parse(tools.lookup_rules.inputSchema, {
        query: "agotamiento",
        modifier: -2,
      }),
    ).toBe(false);

    // Combat tools must reject LLM-invented stats, rolls, totals, and damage numbers
    expect(
      parse(tools.combat_start.inputSchema, {
        sceneId: "escena_01_orilla",
        enemies: [{ creatureId: "explorador_espesura", count: 1, hp: 99, ac: 20 }],
      }),
    ).toBe(false);

    expect(
      parse(tools.combat_start.inputSchema, {
        sceneId: "escena_01_orilla",
        enemies: [{ creatureId: "dragon_inventado", count: 1 }],
      }),
    ).toBe(false);

    expect(
      parse(tools.combat_attack.inputSchema, {
        sceneId: "escena_01_orilla",
        attackerId: "pc_kael",
        targetId: "explorador_espesura",
        damage: 25,
      }),
    ).toBe(false);

    expect(
      parse(tools.combat_attack.inputSchema, {
        sceneId: "escena_01_orilla",
        attackerId: "pc_kael",
        targetId: "explorador_espesura",
        attackBonus: 10,
        damageDice: "10d10",
      }),
    ).toBe(false);

    expect(
      parse(tools.combat_next_turn.inputSchema, {
        sceneId: "escena_01_orilla",
        round: 5,
      }),
    ).toBe(false);

    expect(
      parse(tools.combat_end.inputSchema, {
        sceneId: "escena_01_orilla",
        outcome: "victory",
        reason: "Fin",
        xp: 500,
      }),
    ).toBe(false);
  });

  it("plays Aguas Quietas end-to-end through DM tools with deterministic replay parity", async () => {
    // Seed chosen so investigate produces >= 14 or verify dynamic clues + full route
    const { rt, loaded } = await setupRuntime({
      mode: "digital",
      presetId: "pc_kael",
      seed: "walkthrough-aguas-quietas",
    });
    const tools = createDmTools(rt);

    const checkRes = await execTool(tools.resolve_check, {
      sceneId: "escena_01_orilla",
      actorId: "pc_kael",
      skill: "perception",
      dc: 12,
    });
    expect(checkRes.ok).toBe(true);

    const toParlamento = await execTool(tools.transition_scene, {
      targetSceneId: "escena_03_parlamento",
      actorId: "pc_kael",
      reason: "El jugador inicia diálogo pacífico",
    });
    expect(toParlamento.ok).toBe(true);

    const invSpend = await execTool(tools.inventory, {
      sceneId: "escena_03_parlamento",
      actorId: "pc_kael",
      itemId: "gold-coins",
      itemName: "Monedas de oro",
      qtyDelta: 15,
      reason: "Bolsa recuperada antes del campamento",
    });
    expect(invSpend.ok).toBe(true);

    const toCamp = await execTool(tools.transition_scene, {
      targetSceneId: "escena_04_campamento",
      actorId: "pc_kael",
      reason: "Acuerdo alcanzado con los exploradores",
    });
    expect(toCamp.ok).toBe(true);

    const invRes = await execTool(tools.investigate, {
      sceneId: "escena_04_campamento",
      actorId: "pc_kael",
      skill: "investigation",
    });
    expect(invRes.ok).toBe(true);

    const rulesRes = await execTool(tools.lookup_rules, {
      query: "necrofago",
      category: "monster",
    });
    expect(rulesRes.ok).toBe(true);
    expect(rulesRes.results.some((r) => r.index === "necrofago_de_rio")).toBe(
      true,
    );

    for (const nextId of [
      "escena_06_comandante",
      "escena_07_travesia_barcaza",
      "escena_08_otra_orilla",
    ]) {
      const tr = await execTool(tools.transition_scene, {
        targetSceneId: nextId,
        actorId: "pc_kael",
        reason: `Avance hacia ${nextId}`,
      });
      expect(tr.ok).toBe(true);
    }

    const finalState = rt.getState();
    const events = rt.getEvents();
    expect(finalState.sceneId).toBe("escena_08_otra_orilla");
    expect(events.every((e) => e.source === "engine")).toBe(true);
    expect(reduceEvents(loaded.initialState, events)).toEqual(finalState);
  });

  it("enforces Hybrid Mode declareCheck boundary and rollback_to_event restoration", async () => {
    const { store, guestId, rt } = await setupRuntime({
      mode: "hybrid",
      presetId: "pc_kael",
    });
    const tools = createDmTools(rt);

    // Invalid human roll (die 10 + mod +4 = 14, not 20) must NOT mutate state
    const badDecl = declareCheck(
      rt.getState(),
      {
        sceneId: "escena_01_orilla",
        actorId: "pc_kael",
        skill: "perception",
        dc: 12,
        dieResults: [10],
        declaredTotal: 20,
      },
      { rng: rt.rng, createId: rt.createId, now: rt.now },
    );
    expect(badDecl.ok).toBe(false);
    expect(rt.getEvents()).toHaveLength(0);

    // Valid human roll persists with provenance source: 'player-declared'
    const goodDecl = declareCheck(
      rt.getState(),
      {
        sceneId: "escena_01_orilla",
        actorId: "pc_kael",
        skill: "perception",
        dc: 12,
        dieResults: [11],
        declaredTotal: 15,
      },
      { rng: rt.rng, createId: rt.createId, now: rt.now },
    );
    expect(goodDecl.ok).toBe(true);
    if (!goodDecl.ok) return;

    await rt.commitEvent(goodDecl.event, goodDecl.nextState);
    expect(rt.getEvents()[0]?.source).toBe("player-declared");

    // Advance scene
    const tr = await execTool(tools.transition_scene, {
      targetSceneId: "escena_03_parlamento",
      actorId: "pc_kael",
      reason: "Negociación tras detectar emboscada",
    });
    expect(tr.ok).toBe(true);
    expect(rt.getState().sceneId).toBe("escena_03_parlamento");
    expect(rt.getState().lastSeq).toBe(2);

    // Rollback to seq 1 via DM tool
    const rbOut = await execTool(tools.rollback_to_event, {
      targetSeq: 1,
      reason: "El jugador pidió deshacer la transición",
    });
    expect(rbOut.ok).toBe(true);
    expect(rt.getState().sceneId).toBe("escena_01_orilla");
    expect(rt.getState().lastSeq).toBe(1);

    const reloaded = await store.loadCampaign(rt.campaignId, guestId);
    expect(reloaded?.state).toEqual(rt.getState());

    // Rollback all the way to seq 0, then append a new check: seq must stay monotonic (no duplicate seq 1)
    const rbZero = await execTool(tools.rollback_to_event, {
      targetSeq: 0,
      reason: "Reiniciar event log a seq 0",
    });
    expect(rbZero.ok).toBe(true);
    expect(rt.getState().lastSeq).toBe(0);

    const afterReset = declareCheck(
      rt.getState(),
      {
        sceneId: "escena_01_orilla",
        actorId: "pc_kael",
        skill: "deception",
        dc: 13,
        dieResults: [20],
      },
      { rng: rt.rng, createId: rt.createId, now: rt.now },
    );
    expect(afterReset.ok).toBe(true);
    if (!afterReset.ok) return;

    await rt.commitEvent(afterReset.event, afterReset.nextState);
    expect(afterReset.event.seq).toBeGreaterThan(2);
    const seqs = rt.getEvents().map((e) => e.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it("runs a 5e-lite combat encounter via DM tools with SRD stats, prompt injection, replay parity, and rollback", async () => {
    const { store, guestId, loaded, rt } = await setupRuntime({
      mode: "digital",
      presetId: "pc_kael",
      seed: "combat-e2e-seed",
    });
    const tools = createDmTools(rt);

    // Transition to the shoreline skirmish scene first (seq 1)
    const tr = await execTool(tools.transition_scene, {
      targetSceneId: "escena_02_batalla_orilla",
      actorId: "pc_kael",
      reason: "Estalla la escaramuza en la orilla",
    });
    expect(tr.ok).toBe(true);

    // Start combat with official SRD creatures (seq 2)
    const startOut = await execTool(tools.combat_start, {
      sceneId: "escena_02_batalla_orilla",
      enemies: [
        { creatureId: "explorador_espesura", count: 1 },
        { creatureId: "necrofago_de_rio", count: 1 },
      ],
    });
    expect(startOut.ok).toBe(true);
    expect(startOut.round).toBe(1);
    expect(startOut.initiativeOrder).toHaveLength(3);

    const stateAfterStart = rt.getState();
    expect(stateAfterStart.combat?.active).toBe(true);

    const scout = stateAfterStart.combat?.combatants.find(
      (c) => c.id === "explorador_espesura",
    );
    const necrofago = stateAfterStart.combat?.combatants.find(
      (c) => c.id === "necrofago_de_rio",
    );
    const kael = stateAfterStart.combat?.combatants.find(
      (c) => c.id === "pc_kael",
    );
    expect(scout?.hp).toEqual({ current: 16, max: 16 });
    expect(scout?.ac).toBe(13);
    expect(necrofago?.hp).toEqual({ current: 18, max: 18 });
    expect(necrofago?.ac).toBe(12);
    expect(necrofago?.vulnerabilities).toEqual(["fire"]);
    expect(necrofago?.immunities).toEqual(["poison"]);
    expect(kael?.attacks.map((a) => a.id)).toEqual(["shortbow", "shortsword"]);

    // Verify system prompt includes live combat state, turn, HP, and attack IDs
    const combatPrompt = buildDmSystemPrompt(
      stateAfterStart,
      rt.getEvents(),
    );
    expect(combatPrompt).toContain("Combate activo (Ronda 1)");
    expect(combatPrompt).toContain("Explorador de la Espesura");
    expect(combatPrompt).toContain("Necrófago de río");
    expect(combatPrompt).toContain("`shortbow`");
    expect(combatPrompt).toContain("`garras_fangosas`");

    // PC attacks scout (seq 3)
    const pcAtk = await execTool(tools.combat_attack, {
      sceneId: "escena_02_batalla_orilla",
      attackerId: "pc_kael",
      targetId: "explorador_espesura",
      attackId: "shortbow",
    });
    expect(pcAtk.ok).toBe(true);
    expect(pcAtk.attackBonus).toBe(5);
    expect(pcAtk.targetAc).toBe(13);

    // Advance turn (seq 4)
    const nextTurn = await execTool(tools.combat_next_turn, {
      sceneId: "escena_02_batalla_orilla",
    });
    expect(nextTurn.ok).toBe(true);
    expect(nextTurn.turnIndex).toBe(1);

    // Enemy attacks PC (seq 5)
    const enemyAtk = await execTool(tools.combat_attack, {
      sceneId: "escena_02_batalla_orilla",
      attackerId: "necrofago_de_rio",
      targetId: "pc_kael",
      attackId: "garras_fangosas",
    });
    expect(enemyAtk.ok).toBe(true);
    if (enemyAtk.hit) {
      expect(rt.getState().characters.pc_kael?.hp.current).toBe(
        enemyAtk.targetHpAfter,
      );
    }

    // End combat (seq 6)
    const endOut = await execTool(tools.combat_end, {
      sceneId: "escena_02_batalla_orilla",
      outcome: "fled",
      reason: "Los exploradores se repliegan entre la niebla",
    });
    expect(endOut.ok).toBe(true);
    expect(endOut.outcome).toBe("fled");
    expect(rt.getState().combat).toBeNull();
    expect(rt.getState().flags["combat:lastOutcome"]).toBe("fled");

    // Full event-sourced replay parity
    expect(reduceEvents(loaded.initialState, rt.getEvents())).toEqual(
      rt.getState(),
    );

    // Rollback to seq 2 (just after combat_start): combat active again, all at full HP
    const rbMid = await execTool(tools.rollback_to_event, {
      targetSeq: 2,
      reason: "Volver al inicio del combate",
    });
    expect(rbMid.ok).toBe(true);
    expect(rt.getState().combat?.active).toBe(true);
    expect(rt.getState().combat?.round).toBe(1);
    expect(rt.getState().combat?.turnIndex).toBe(0);
    expect(rt.getState().characters.pc_kael?.hp.current).toBe(11);
    expect(
      rt.getState().combat?.combatants.find(
        (c) => c.id === "explorador_espesura",
      )?.hp.current,
    ).toBe(16);

    const reloadedMid = await store.loadCampaign(rt.campaignId, guestId);
    expect(reloadedMid?.state).toEqual(rt.getState());

    // Rollback to seq 1 (before combat started): no active combat
    const rbBefore = await execTool(tools.rollback_to_event, {
      targetSeq: 1,
      reason: "Deshacer inicio del combate",
    });
    expect(rbBefore.ok).toBe(true);
    expect(rt.getState().combat).toBeUndefined();
  });
});
