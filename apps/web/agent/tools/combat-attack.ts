import { resolveCombatAttack } from "@dungeons/rules";
import { tool } from "ai";
import { z } from "zod";

import type { CombatAttackToolOutput } from "@/agent/types";
import { RollModeZod, type DmToolRuntime } from "./runtime";

export function createCombatAttackTool(rt: DmToolRuntime) {
  return tool({
    description:
      "Resuelve un ataque en combate 5e-lite (tirada 1d20 contra CA, críticos nat 20 / pifias nat 1, dados de daño, vulnerabilidades e inmunidades). Prohibido enviar tiradas, bonificadores o daño manuales.",
    inputSchema: z
      .object({
        sceneId: z.string().min(1),
        attackerId: z.string().min(1),
        targetId: z.string().min(1),
        attackId: z.string().min(1).optional(),
        mode: RollModeZod.optional(),
      })
      .strict(),
    execute: async (input): Promise<CombatAttackToolOutput> => {
      const state = rt.getState();
      const res = resolveCombatAttack(state, input, {
        rng: rt.rng,
        createId: rt.createId,
        now: rt.now,
      });

      if (!res.ok) {
        return { ok: false, messageEs: res.messageEs };
      }

      await rt.commitEvent(res.event, res.nextState);

      let messageEs: string;
      if (!res.hit) {
        messageEs = res.isCriticalMiss
          ? `${res.attackerName} falla críticamente (1 natural) con ${res.attackNameEs} contra ${res.targetName}.`
          : `${res.attackerName} falla con ${res.attackNameEs} (${res.attackTotal} vs CA ${res.targetAc}) contra ${res.targetName}.`;
      } else {
        const critTag = res.isCritical ? " ¡IMPACTO CRÍTICO!" : "";
        const relTag =
          res.damageRelation === "vulnerable"
            ? " (vulnerable ×2)"
            : res.damageRelation === "immune"
              ? " (inmune: 0 daño)"
              : "";
        const defeatedTag = res.targetDefeated ? " ¡Derrotado!" : "";
        messageEs = `${res.attackerName} impacta con ${res.attackNameEs} (${res.attackTotal} vs CA ${res.targetAc})${critTag} e inflige ${res.damageApplied} de daño (${res.damageType})${relTag} a ${res.targetName} (${res.targetHpAfter} PG restantes).${defeatedTag}`;
      }

      return {
        ok: true,
        messageEs,
        attackerId: res.attackerId,
        attackerName: res.attackerName,
        targetId: res.targetId,
        targetName: res.targetName,
        attackId: res.attackId,
        attackNameEs: res.attackNameEs,
        attackRolls: res.attackRolls,
        naturalRoll: res.naturalRoll,
        attackBonus: res.attackBonus,
        attackTotal: res.attackTotal,
        targetAc: res.targetAc,
        hit: res.hit,
        isCritical: res.isCritical,
        isCriticalMiss: res.isCriticalMiss,
        damageType: res.damageType,
        damageExpressionUsed: res.damageExpressionUsed,
        damageRolls: res.damageRolls,
        rawDamage: res.rawDamage,
        damageRelation: res.damageRelation,
        damageApplied: res.damageApplied,
        targetHpBefore: res.targetHpBefore,
        targetHpAfter: res.targetHpAfter,
        targetDefeated: res.targetDefeated,
        allEnemiesDefeated: res.allEnemiesDefeated,
        allPcsDefeated: res.allPcsDefeated,
        seq: res.event.seq,
      };
    },
  });
}
