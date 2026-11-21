import { CORE_SPELLS_521, resolveCastSpell } from "@dungeons/rules";
import { getSpell } from "@dungeons/srd";
import { tool } from "ai";
import { z } from "zod";

import type { CastSpellToolOutput } from "@/agent/types";
import { isStaleSeqError } from "@/lib/game/store";
import { RollModeZod, type DmToolRuntime } from "./runtime";

export function createCastSpellTool(rt: DmToolRuntime) {
  return tool({
    description:
      "Lanza un conjuro 5e SRD 5.2.1 de forma determinista: valida y descuenta spellSlots (si nivel >= 1), gestiona concentración y resuelve ataques mágicos, salvaciones, auto-impacto o curación. Nunca inventes números de daño ni CD.",
    inputSchema: z
      .object({
        sceneId: z.string().min(1),
        casterId: z.string().min(1),
        spellId: z
          .string()
          .min(1)
          .describe(
            "Slug SRD del conjuro en minúsculas (p. ej. fire-bolt, guiding-bolt, magic-missile, cure-wounds, healing-word, sacred-flame, burning-hands, bless, shield, sleep).",
          ),
        slotLevel: z.number().int().min(0).max(9).optional(),
        targetId: z.string().min(1).optional(),
        mode: RollModeZod.optional(),
      })
      .strict(),
    execute: async (input): Promise<CastSpellToolOutput> => {
      const state = rt.getState();
      const normalizedId = input.spellId.trim().toLowerCase().replace(/\s+/g, "-");
      const srdFallback = !CORE_SPELLS_521[normalizedId]
        ? getSpell(normalizedId)
        : undefined;

      const fallbackDamage = srdFallback?.damageAtSlotLevel
        ? (srdFallback.damageAtSlotLevel[
            String(input.slotLevel ?? srdFallback.level)
          ] ?? Object.values(srdFallback.damageAtSlotLevel)[0])
        : undefined;

      const res = resolveCastSpell(
        state,
        {
          ...input,
          spellId: normalizedId,
          ...(srdFallback
            ? {
                spellMetaFallback: {
                  id: srdFallback.index,
                  nameEs: srdFallback.nameEs,
                  level: srdFallback.level,
                  concentration: srdFallback.concentration,
                  attackType: srdFallback.attackType,
                  damageType: srdFallback.damageType,
                  damageDice: fallbackDamage ?? null,
                },
              }
            : {}),
        },
        {
          rng: rt.rng,
          createId: rt.createId,
          now: rt.now,
        },
      );

      if (!res.ok) {
        return { ok: false, code: res.code, messageEs: res.messageEs };
      }

      try {
        await rt.commitEvent(
          res.event,
          res.nextState,
          rt.getLogHeadSeq?.(),
        );
      } catch (err) {
        if (isStaleSeqError(err)) {
          return { ok: false, code: "STALE_SEQ", messageEs: err.message };
        }
        throw err;
      }

      const parts: string[] = [
        `${res.spellNameEs}${res.slotLevelUsed > 0 ? ` (Nv.${res.slotLevelUsed})` : " (Truco)"}`,
      ];
      if (res.attackRoll) {
        parts.push(
          res.attackRoll.hit
            ? `${res.attackRoll.isCritical ? "CRÍTICO" : "Impacto"} (${res.attackRoll.total} vs CA ${res.attackRoll.targetAc})`
            : `Fallo (${res.attackRoll.total} vs CA ${res.attackRoll.targetAc})`,
        );
      }
      if (res.savingThrow) {
        parts.push(
          `Salvación ${res.savingThrow.ability.toUpperCase()} ${res.savingThrow.total} vs CD ${res.savingThrow.dc} (${res.savingThrow.saved ? "superada" : "fallida"})`,
        );
      }
      if (res.damageApplied !== undefined && res.damageApplied > 0) {
        parts.push(`${res.damageApplied} daño ${res.damageType ?? ""}`.trim());
      }
      if (res.healingApplied !== undefined && res.healingApplied > 0) {
        parts.push(`+${res.healingApplied} PG`);
      }
      if (res.slotPoolAfter) {
        parts.push(
          `slots Nv.${res.slotLevelUsed}: ${res.slotPoolAfter.current}/${res.slotPoolAfter.max}`,
        );
      }

      return {
        ok: true,
        messageEs: parts.join(" · "),
        spellId: res.spellId,
        spellNameEs: res.spellNameEs,
        slotLevelUsed: res.slotLevelUsed,
        kind: res.kind,
        concentration: res.concentration,
        spellAttackBonus: res.spellAttackBonus,
        spellSaveDc: res.spellSaveDc,
        targetId: res.targetId,
        targetName: res.targetName,
        attackRoll: res.attackRoll,
        savingThrow: res.savingThrow,
        damageApplied: res.damageApplied,
        damageType: res.damageType,
        healingApplied: res.healingApplied,
        targetHpAfter: res.targetHpAfter,
        slotPoolAfter: res.slotPoolAfter,
        seq: res.event.seq,
      };
    },
  });
}
