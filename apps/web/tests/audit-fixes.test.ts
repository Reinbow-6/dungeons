import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  AGUAS_QUIETAS_PACK,
  createRng,
  type AdventurePack,
  type GameState,
} from "@dungeons/rules";
import type { ToolExecutionOptions } from "ai";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/whitelist", () => ({
  resolveRequestAccess: vi.fn(async () => ({
    tier: "guest" as const,
    userId: null,
    email: null,
  })),
}));

import { createCombatStartTool } from "@/agent/tools/combat-start";
import type { DmToolRuntime } from "@/agent/tools/runtime";
import { POST as chatPost } from "@/app/api/chat/route";
import { POST as sttPost } from "@/app/api/stt/route";
import { resolveGuestSessionFromRequest } from "@/lib/auth/guest-session";
import { InMemoryGameStore } from "@/lib/game/store";

const EXEC_OPTS: ToolExecutionOptions<never> = {
  toolCallId: "audit-test-call",
  messages: [],
  context: undefined as never,
};

describe("Audit Tanda 1 fixes", () => {
  it("preserves enemy damage resistances from AdventurePack bestiary in combat_start", async () => {
    const store = new InMemoryGameStore();
    const guestId = "33333333-3333-4333-8333-333333333333";
    const loaded = await store.createCampaign({
      guestId,
      presetId: "pc_kael",
      mode: "digital",
      ruleset: "5e-full",
    });

    const packWithResistantEnemy: AdventurePack = {
      ...AGUAS_QUIETAS_PACK,
      bestiary: [
        {
          id: "espectro_niebla",
          nameEs: "Espectro de la Niebla",
          cr: 1,
          hp: 22,
          ac: 13,
          speedTextEs: "40 pies (vuelo)",
          abilities: { str: 6, dex: 14, con: 10, int: 10, wis: 10, cha: 11 },
          skills: {},
          traitsEs: ["Movimiento incorpóreo"],
          attacks: [
            {
              id: "life_drain",
              nameEs: "Toque marchitante",
              kind: "melee",
              attackBonus: 4,
              damageDice: "1d8+2",
              damageType: "necrotic",
              rangeText: "5 pies",
            },
          ],
          resistances: ["slashing", "piercing"],
          vulnerabilities: [],
          immunities: ["poison"],
        },
      ],
    };

    let state: GameState = loaded.state;
    const rt: DmToolRuntime = {
      campaignId: loaded.campaignId,
      sessionId: loaded.sessionId,
      guestId,
      adventurePack: packWithResistantEnemy,
      getState: () => state,
      getInitialState: () => loaded.initialState,
      getEvents: () => loaded.events,
      commitEvent: async (_event, nextState) => {
        state = nextState;
      },
      commitRollback: async () => {
        throw new Error("unused");
      },
      rng: createRng("res-seed"),
      createId: () => randomUUID(),
      now: () => "2026-11-28T14:00:00.000Z",
    };

    const combatStart = createCombatStartTool(rt);
    const out = (await combatStart.execute!(
      {
        sceneId: state.sceneId,
        enemies: [{ creatureId: "espectro_niebla", count: 1 }],
      },
      EXEC_OPTS,
    )) as { ok: boolean };

    expect(out.ok).toBe(true);
    const enemy = state.combat?.combatants.find((c) => c.kind === "enemy");
    expect(enemy?.resistances).toEqual(["slashing", "piercing"]);
  });

  it("handles malformed percent-encoding in guest cookie without throwing", () => {
    const req = new Request("http://localhost:3000/api/game/campaigns", {
      headers: {
        cookie: "dungeons_guest_session=%E0%A4%A; other=1",
      },
    });
    const session = resolveGuestSessionFromRequest(req);
    expect(session.isNew).toBe(true);
    expect(session.guestId.length).toBeGreaterThan(10);
  });

  it("returns 404 CAMPAIGN_NOT_FOUND when /api/chat receives an unknown explicit campaignId", async () => {
    const prevKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    try {
      const req = new Request("http://localhost:3000/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId: "00000000-0000-4000-8000-000000000999",
          messages: [
            {
              id: "u1",
              role: "user",
              parts: [{ type: "text", text: "Exploro la orilla" }],
            },
          ],
        }),
      });

      const res = await chatPost(req);
      expect(res.status).toBe(404);
      const body = (await res.json()) as { code?: string };
      expect(body.code).toBe("CAMPAIGN_NOT_FOUND");
    } finally {
      if (prevKey === undefined) {
        delete process.env.OPENROUTER_API_KEY;
      } else {
        process.env.OPENROUTER_API_KEY = prevKey;
      }
    }
  });

  it("rejects oversized audio blobs in /api/stt with 413 before buffering", async () => {
    const fakeLargeBlob = new Blob(["tiny"], { type: "audio/webm" });
    Object.defineProperty(fakeLargeBlob, "size", { value: 11 * 1024 * 1024 });
    const arrayBufferSpy = vi.spyOn(fakeLargeBlob, "arrayBuffer");

    const formData = {
      get: (name: string) => (name === "audio" ? fakeLargeBlob : null),
    };
    const req = new Request("http://localhost:3000/api/stt", { method: "POST" });
    vi.spyOn(req, "formData").mockResolvedValue(formData as unknown as FormData);

    const res = await sttPost(req);
    expect(res.status).toBe(413);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("AUDIO_TOO_LARGE");
    expect(arrayBufferSpy).not.toHaveBeenCalled();
  });

  it("includes migration 0005 for model_usage, provider_health tokens, and hot table indexes", () => {
    const sqlPath = path.join(
      process.cwd(),
      "drizzle",
      "0005_audit_indexes_and_telemetry.sql",
    );
    const sqlText = readFileSync(sqlPath, "utf8");
    expect(sqlText).toContain('CREATE TABLE IF NOT EXISTS "model_usage"');
    expect(sqlText).toContain('"prompt_tokens"');
    expect(sqlText).toContain('"campaigns_owner_updated_idx"');
    expect(sqlText).toContain('"characters_campaign_idx"');
    expect(sqlText).toContain('"messages_campaign_created_idx"');
  });
});
