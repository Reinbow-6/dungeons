import { resolveInventoryChange } from "@dungeons/rules";
import { tool } from "ai";
import { z } from "zod";

import type { InventoryToolOutput } from "@/agent/types";
import type { DmToolRuntime } from "./runtime";

export function createInventoryTool(rt: DmToolRuntime) {
  return tool({
    description:
      "Agrega o consume objetos del inventario de un personaje de forma determinista y auditable.",
    inputSchema: z
      .object({
        sceneId: z.string().min(1),
        actorId: z.string().min(1),
        itemId: z.string().min(1),
        itemName: z.string().min(1).optional(),
        qtyDelta: z
          .number()
          .int()
          .min(-99)
          .max(99)
          .refine((v) => v !== 0, "qtyDelta no puede ser 0."),
        reason: z.string().min(1),
      })
      .strict(),
    execute: async (input): Promise<InventoryToolOutput> => {
      const state = rt.getState();
      const res = resolveInventoryChange(state, input, {
        rng: rt.rng,
        createId: rt.createId,
        now: rt.now,
      });

      if (!res.ok) {
        return { ok: false, messageEs: res.messageEs };
      }

      await rt.commitEvent(res.event, res.nextState);
      return {
        ok: true,
        messageEs: `Inventario actualizado (${res.itemName}: ${res.quantityBefore} → ${res.quantityAfter}).`,
        itemId: res.itemId,
        itemName: res.itemName,
        quantityBefore: res.quantityBefore,
        quantityAfter: res.quantityAfter,
        seq: res.event.seq,
      };
    },
  });
}
