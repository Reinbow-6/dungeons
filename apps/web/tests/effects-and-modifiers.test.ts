import { randomUUID } from "node:crypto";
import {
  buildSpellActiveEffect,
  createDefaultAuthority,
  createRng,
  type GameState,
} from "@dungeons/rules";
import type { ToolExecutionOptions } from "ai";
import { describe, expect, it } from "vitest";

import { buildDmPromptLayers, createDmTools, type DmToolRuntime } from "@/agent/agent";
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

async function setupClericPartyRuntime(seed = "effects-web-seed") {
  const store = new InMemoryGameStore();
  const guestId = "22222222-2222-4222-8222-222222222222";
  const loaded = await store.createCampaign({
    guestId,
    presetId: "pc_seraphina",
    mode: "digital",
    ruleset: "5e-full",
  });

  let state: GameState = {
    ...loaded.state,
    characters: {
      ...loaded.state.characters,
      pc_seraphina: {
        ...loaded.state.characters.pc_seraphina!,
        knownSpells: [
          ...(loaded.state.characters.pc_seraphina?.knownSpells ?? []),
          "guidance",
          "bless",
          "shield",
        ],
        spellSlots: {
          "1": { current: 4, max: 4 },
        },
        authority: createDefaultAuthority("digital"),
      },
    },
  };
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
    rng: createRng(seed),
    createId: () => randomUUID(),
    now: () => `2026-11-28T03:${String(++idCounter).padStart(2, "0")}:00.000Z`,
  };

  return { rt };
}

describe("Web DM tools & prompt layers for SourcedModifiers + ActiveEffects (P2)", () => {
  it("propagates breakdown on resolve_check/resolve_save and consumes guidance", async () => {
    const { rt } = await setupClericPartyRuntime();
    const tools = createDmTools(rt);

    const guidanceCast = await execTool(tools.cast_spell, {
      sceneId: rt.getState().sceneId,
      casterId: "pc_seraphina",
      spellId: "guidance",
      targetId: "pc_seraphina",
    });
    expect(guidanceCast.ok).toBe(true);
    expect(rt.getState().characters.pc_seraphina?.activeEffects).toHaveLength(1);

    const checkRes = await execTool(tools.resolve_check, {
      sceneId: rt.getState().sceneId,
      actorId: "pc_seraphina",
      skill: "religion",
      dc: 12,
    });
    expect(checkRes.ok).toBe(true);
    expect(checkRes.breakdown?.some((b) => b.slug === "spell:guidance:check")).toBe(true);
    expect(rt.getState().characters.pc_seraphina?.activeEffects ?? []).toHaveLength(0);

    const blessCast = await execTool(tools.cast_spell, {
      sceneId: rt.getState().sceneId,
      casterId: "pc_seraphina",
      spellId: "bless",
      targetId: "pc_seraphina",
    });
    expect(blessCast.ok).toBe(true);

    const saveRes = await execTool(tools.resolve_save, {
      sceneId: rt.getState().sceneId,
      actorId: "pc_seraphina",
      ability: "con",
      dc: 12,
    });
    expect(saveRes.ok).toBe(true);
    expect(saveRes.breakdown?.some((b) => b.slug === "spell:bless:save")).toBe(true);
  });

  it("propagates attack/ac breakdown, timed conditions, expiredEffects, and prompt effective CA", async () => {
    const { rt } = await setupClericPartyRuntime("combat-effects-seed");
    const tools = createDmTools(rt);

    const tr = await execTool(tools.transition_scene, {
      targetSceneId: "escena_02_batalla_orilla",
      actorId: "pc_seraphina",
      reason: "Emboscada en la orilla",
    });
    expect(tr.ok).toBe(true);

    const sceneId = rt.getState().sceneId;
    const started = await execTool(tools.combat_start, {
      sceneId,
      enemies: [{ creatureId: "explorador_espesura", count: 1 }],
    });
    expect(started.ok).toBe(true);

    const shieldCast = await execTool(tools.cast_spell, {
      sceneId,
      casterId: "pc_seraphina",
      spellId: "shield",
      targetId: "pc_seraphina",
    });
    expect(shieldCast.ok).toBe(true);

    const promptLayers = buildDmPromptLayers(rt.getState(), rt.getEvents());
    const baseAc = rt.getState().characters.pc_seraphina!.ac;
    const shieldBoost = buildSpellActiveEffect({
      spellId: "shield",
      effectId: "test",
      sourceActorId: "pc_seraphina",
    })!.modifiers[0]!.value!;
    expect(promptLayers.dynamicTurnContext).toContain(
      `CA: ${baseAc + shieldBoost} (base ${baseAc})`,
    );
    expect(promptLayers.dynamicTurnContext).toContain(
      "Efectos: Escudo arcano [+5 AC, auto en motor] (1r)",
    );

    const enemyId = rt
      .getState()
      .combat!.combatants.find((c) => c.kind === "enemy")!.id;
    const atkRes = await execTool(tools.combat_attack, {
      sceneId,
      attackerId: enemyId,
      targetId: "pc_seraphina",
    });
    expect(atkRes.ok).toBe(true);
    expect(atkRes.targetBaseAc).toBe(baseAc);
    expect(atkRes.targetAc).toBe(baseAc + shieldBoost);
    expect(atkRes.acBreakdown?.some((b) => b.slug === "spell:shield:ac")).toBe(true);
    expect(atkRes.attackBreakdown).toBeDefined();

    // Apply a 1-round condition expiring at end_of_owner_turn
    const condRes = await execTool(tools.apply_condition, {
      sceneId,
      actorId: "pc_seraphina",
      addConditions: ["frightened"],
      reason: "Aullido sombrío",
      durationRounds: 1,
      expiryTiming: "end_of_owner_turn",
    });
    expect(condRes.ok).toBe(true);
    expect(condRes.conditionsAfter).toContain("frightened");

    // Advance turns until frightened expires
    let foundExpired = false;
    for (let i = 0; i < 4; i += 1) {
      const next = await execTool(tools.combat_next_turn, { sceneId });
      expect(next.ok).toBe(true);
      if (next.expiredEffects?.some((e) => e.linkedConditionRemoved === "frightened")) {
        foundExpired = true;
        break;
      }
    }
    expect(foundExpired).toBe(true);
    expect(rt.getState().characters.pc_seraphina?.conditions).not.toContain("frightened");
  });
});
