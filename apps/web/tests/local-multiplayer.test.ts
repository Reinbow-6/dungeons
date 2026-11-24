import { randomUUID } from "node:crypto";
import { addPartyMember, createRng } from "@dungeons/rules";
import { describe, expect, it } from "vitest";

import { buildDmSystemPrompt } from "@/agent/agent";
import { buildSeededIntroParts } from "@/lib/game/intro";
import {
  expandPartyMessageForDm,
  formatGroupRoundMessage,
  formatSingleActorMessage,
  parsePartyMessage,
} from "@/lib/game/party-messages";
import { createPresetCharacter } from "@/lib/game/presets";
import { InMemoryGameStore } from "@/lib/game/store";

describe("Local Multiplayer Integration (apps/web)", () => {
  it("creates 3-PC local party in InMemoryGameStore, propagates global table mode, and survives rollback", async () => {
    const store = new InMemoryGameStore();
    const created = await store.createCampaign({
      guestId: "guest-mp-1",
      party: [
        { presetId: "pc_kael", playerName: "Eze" },
        { presetId: "pc_brenna", playerName: "Mati" },
        { presetId: "pc_seraphina", playerName: "Sofi" },
      ],
      mode: "digital",
      ruleset: "5e-full",
    });

    expect(Object.keys(created.state.characters)).toEqual([
      "pc_kael",
      "pc_brenna",
      "pc_seraphina",
    ]);
    expect(created.state.characters.pc_brenna?.playerName).toBe("Mati");
    expect(created.state.characters.pc_kael?.rollAuthority).toBe("engine-rolled");
    expect(created.state.characters.pc_seraphina?.rollAuthority).toBe(
      "engine-rolled",
    );

    // Add 4th PC mid-campaign in digital mode
    const theron = createPresetCharacter("pc_theron", "digital", {
      playerName: "Leo",
    });
    const added = addPartyMember(
      created.state,
      { character: theron },
      {
        rng: createRng(7),
        createId: () => randomUUID(),
        now: () => "2026-11-24T11:45:00.000Z",
      },
    );
    expect(added.ok).toBe(true);
    if (!added.ok) return;

    await store.appendEvent(
      created.campaignId,
      created.sessionId,
      added.event,
      added.nextState,
      created.logHeadSeq,
    );

    // Switch entire table to hybrid: all 4 PCs including mid-campaign pc_theron become player-declared
    const updated = await store.updateTableMode(
      created.campaignId,
      "guest-mp-1",
      "hybrid",
    );
    expect(updated).not.toBeNull();
    if (!updated) return;

    for (const ch of Object.values(updated.state.characters)) {
      expect(ch.rollAuthority).toBe("player-declared");
    }

    // Rollback to seq 0 removes pc_theron while keeping the 3 founders in hybrid mode
    const rb = await store.rollbackCampaign(
      created.campaignId,
      "guest-mp-1",
      0,
    );
    expect(rb.ok).toBe(true);
    if (!rb.ok) return;
    expect(Object.keys(rb.state.characters)).toEqual([
      "pc_kael",
      "pc_brenna",
      "pc_seraphina",
    ]);
    expect(rb.state.characters.pc_brenna?.rollAuthority).toBe(
      "player-declared",
    );
  });

  it("formats, parses, and expands single-actor and paused-round party messages cleanly", async () => {
    const store = new InMemoryGameStore();
    const created = await store.createCampaign({
      guestId: "guest-mp-2",
      party: [
        { presetId: "pc_kael", playerName: "Eze" },
        { presetId: "pc_brenna", playerName: "Mati" },
      ],
    });

    const single = formatSingleActorMessage("pc_brenna", "Empujo el portón");
    expect(parsePartyMessage(single)).toEqual({
      kind: "single",
      actorId: "pc_brenna",
      text: "Empujo el portón",
    });
    expect(expandPartyMessageForDm(single, created.state.characters)).toBe(
      "[Acción de Brenna de Piedrafría (actorId: pc_brenna, Jugador: Mati)]: Empujo el portón",
    );

    const round = formatGroupRoundMessage([
      { actorId: "pc_kael", text: "Vigilo los juncos con mi arco" },
      { actorId: "pc_brenna", text: "Avanzo con el escudo en alto" },
    ]);
    expect(parsePartyMessage(round)).toEqual({
      kind: "round",
      entries: [
        { actorId: "pc_kael", text: "Vigilo los juncos con mi arco" },
        { actorId: "pc_brenna", text: "Avanzo con el escudo en alto" },
      ],
    });

    const expandedRound = expandPartyMessageForDm(
      round,
      created.state.characters,
    );
    expect(expandedRound).toContain("[Escena grupal — acciones acumuladas en mesa]");
    expect(expandedRound).toContain("Kael de Oakhaven (actorId: pc_kael, Jugador: Eze)");
    expect(expandedRound).toContain("Brenna de Piedrafría (actorId: pc_brenna, Jugador: Mati)");

    // Plain solo messages pass through untouched
    expect(parsePartyMessage("Miro alrededor")).toEqual({
      kind: "plain",
      text: "Miro alrededor",
    });
    expect(
      expandPartyMessageForDm("Miro alrededor", created.state.characters),
    ).toBe("Miro alrededor");
  });

  it("generates plural opening intro and injects local multiplayer DM guidance & scaling", async () => {
    const store = new InMemoryGameStore();
    const solo = await store.createCampaign({
      guestId: "guest-solo",
      presetId: "pc_kael",
    });
    const soloIntro = buildSeededIntroParts(solo.state);
    expect(soloIntro[0]).toMatchObject({ type: "text" });
    if (soloIntro[0]?.type === "text") {
      expect(soloIntro[0].text).toContain("¿qué hacés?");
    }

    const group = await store.createCampaign({
      guestId: "guest-group",
      party: [
        { presetId: "pc_kael", playerName: "Eze" },
        { presetId: "pc_brenna", playerName: "Mati" },
        { presetId: "pc_seraphina", playerName: "Sofi" },
      ],
    });
    const groupIntro = buildSeededIntroParts(group.state);
    if (groupIntro[0]?.type === "text") {
      expect(groupIntro[0].text).toContain("Kael de Oakhaven (Eze)");
      expect(groupIntro[0].text).toContain("Brenna de Piedrafría (Mati)");
      expect(groupIntro[0].text).toContain("Seraphina Voss (Sofi)");
      expect(groupIntro[0].text).toContain("¿qué hacen?");
    }

    const prompt = buildDmSystemPrompt(group.state, [], {
      activeActorId: "pc_brenna",
    });
    expect(prompt).toContain("Mesa multijugador local (3 jugadores)");
    expect(prompt).toContain("Brenna de Piedrafría");
    expect(prompt).toContain("Jugador: Mati");
    expect(prompt).toContain("3–4 enemigos");
  });
});
