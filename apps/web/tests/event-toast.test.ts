import type { GameEvent } from "@dungeons/rules";
import { describe, expect, it } from "vitest";

import { formatGameEventToast } from "@/lib/game/event-toast";

function makeEvent(
  overrides: Partial<GameEvent> & Pick<GameEvent, "type">,
): GameEvent {
  return {
    id: "ev-1",
    campaignId: "camp-1",
    sessionId: "sess-1",
    seq: 7,
    source: "engine",
    actor: "pc_kael",
    visibility: "public",
    checkId: null,
    declaredTotal: null,
    dieResults: null,
    payload: {},
    stateDelta: {},
    revertedByEventId: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("formatGameEventToast", () => {
  it("formats CHECK_RESOLVED success and failure cleanly", () => {
    const okToast = formatGameEventToast(
      makeEvent({
        type: "CHECK_RESOLVED",
        seq: 4,
        payload: { skill: "perception", total: 17, dc: 12, success: true },
      }),
    );
    expect(okToast.title).toContain("Éxito");
    expect(okToast.description).toContain("17");
    expect(okToast.tone).toBe("emerald");
    expect(okToast.meta).toBe("#4");

    const failToast = formatGameEventToast(
      makeEvent({
        type: "CHECK_RESOLVED",
        seq: 5,
        payload: { skill: "stealth", total: 8, dc: 14, success: false },
      }),
    );
    expect(failToast.title).toContain("Fallo");
    expect(failToast.tone).toBe("rose");
  });

  it("formats COMBAT_ATTACK crits, SPELL_CAST, REST_TAKEN and ROLLBACK", () => {
    const crit = formatGameEventToast(
      makeEvent({
        type: "COMBAT_ATTACK",
        payload: { hit: true, isCritical: true, damageApplied: 14 },
      }),
    );
    expect(crit.title).toContain("crítico");
    expect(crit.tone).toBe("amber");

    const spell = formatGameEventToast(
      makeEvent({
        type: "SPELL_CAST",
        payload: { spellNameEs: "Proyectil Mágico", slotLevel: 1 },
      }),
    );
    expect(spell.title).toContain("Proyectil Mágico");
    expect(spell.tone).toBe("violet");

    const rest = formatGameEventToast(
      makeEvent({
        type: "REST_TAKEN",
        payload: { restType: "long" },
      }),
    );
    expect(rest.title).toContain("Descanso largo");
    expect(rest.tone).toBe("emerald");

    const rb = formatGameEventToast(
      makeEvent({
        type: "ROLLBACK",
        payload: { targetSeq: 2 },
      }),
    );
    expect(rb.description).toContain("#2");
    expect(rb.tone).toBe("amber");
  });
});
