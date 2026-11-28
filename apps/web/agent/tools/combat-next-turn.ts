import { advanceCombatTurn } from "@dungeons/rules";
import { tool } from "ai";
import { z } from "zod";

import type { CombatNextTurnToolOutput } from "@/agent/types";
import type { DmToolRuntime } from "./runtime";

export function createCombatNextTurnTool(rt: DmToolRuntime) {
  return tool({
    description:
      "Avanza el orden de iniciativa al siguiente combatiente activo (saltando derrotados) e incrementa la ronda al dar la vuelta.",
    inputSchema: z
      .object({
        sceneId: z.string().min(1),
      })
      .strict(),
    execute: async (input): Promise<CombatNextTurnToolOutput> => {
      const state = rt.getState();
      const res = advanceCombatTurn(state, input, {
        rng: rt.rng,
        createId: rt.createId,
        now: rt.now,
      });

      if (!res.ok) {
        return { ok: false, messageEs: res.messageEs };
      }

      await rt.commitEvent(res.event, res.nextState);

      const roundNote = res.roundAdvanced ? ` (nueva Ronda ${res.round})` : "";
      const expiredNote =
        res.expiredEffects.length > 0
          ? ` Expiraron: ${res.expiredEffects.map((e) => `${e.labelEs} (${e.targetName})`).join(", ")}.`
          : "";
      return {
        ok: true,
        messageEs: `Turno de ${res.activeCombatant.name} — Ronda ${res.round}${roundNote}.${expiredNote}`,
        round: res.round,
        roundAdvanced: res.roundAdvanced,
        turnIndex: res.combat.turnIndex,
        previousCombatantId: res.previousCombatant.id,
        activeCombatant: {
          id: res.activeCombatant.id,
          name: res.activeCombatant.name,
          kind: res.activeCombatant.kind,
          hp: { ...res.activeCombatant.hp },
          ac: res.activeCombatant.ac,
        },
        ...(res.expiredEffects.length > 0
          ? { expiredEffects: res.expiredEffects }
          : {}),
        seq: res.event.seq,
      };
    },
  });
}
