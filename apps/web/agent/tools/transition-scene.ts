import { transitionScene } from "@dungeons/rules";
import { tool } from "ai";
import { z } from "zod";

import type { TransitionSceneToolOutput } from "@/agent/types";
import type { DmToolRuntime } from "./runtime";

export function createTransitionSceneTool(rt: DmToolRuntime) {
  return tool({
    description:
      "Cambia la escena activa hacia una transición permitida en el grafo de la aventura.",
    inputSchema: z
      .object({
        targetSceneId: z.string().min(1),
        actorId: z.string().min(1).optional(),
        reason: z.string().min(1),
      })
      .strict(),
    execute: async (input): Promise<TransitionSceneToolOutput> => {
      const state = rt.getState();
      const res = transitionScene(state, input, {
        rng: rt.rng,
        createId: rt.createId,
        now: rt.now,
      });

      if (!res.ok) {
        return { ok: false, messageEs: res.messageEs };
      }

      await rt.commitEvent(res.event, res.nextState);
      const nextScene = res.nextState.scenes[res.toSceneId];
      return {
        ok: true,
        messageEs: `Escena cambiada a "${nextScene?.titleEs ?? res.toSceneId}".`,
        fromSceneId: res.fromSceneId,
        toSceneId: res.toSceneId,
        titleEs: nextScene?.titleEs,
        summaryEs: nextScene?.summaryEs,
        narrativeHookEs: nextScene?.narrativeHookEs,
        allowedTransitions: nextScene?.allowedTransitions ?? [],
        seq: res.event.seq,
      };
    },
  });
}
