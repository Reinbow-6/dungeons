import {
  getAbilityModifier,
  startCombat,
  type AdventureCreature,
  type CombatEnemyDefinition,
} from "@dungeons/rules";
import { AGUAS_QUIETAS_BESTIARY, getAguasQuietasCreature } from "@dungeons/srd";
import { tool } from "ai";
import { z } from "zod";

import type { CombatStartToolOutput } from "@/agent/types";
import type { DmToolRuntime } from "./runtime";

function slugifyAttackId(nameEs: string): string {
  return nameEs
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function resolveCampaignCreature(
  rt: DmToolRuntime,
  creatureId: string,
): AdventureCreature | null {
  const fromPack = rt.adventurePack?.bestiary.find((c) => c.id === creatureId);
  if (fromPack) {
    return fromPack;
  }
  if (!rt.adventurePack || rt.adventurePack.id === "aguas-quietas") {
    return getAguasQuietasCreature(creatureId) ?? null;
  }
  return null;
}

export function createCombatStartTool(rt: DmToolRuntime) {
  const allowedIds = (
    rt.adventurePack
      ? rt.adventurePack.bestiary
      : AGUAS_QUIETAS_BESTIARY
  ).map((c) => c.id);
  const creatureIdSchema =
    allowedIds.length > 0
      ? z.enum(allowedIds as [string, ...string[]])
      : z.string().min(1);

  return tool({
    description:
      "Inicia un encuentro de combate tirando iniciativa para los PJs y criaturas oficiales del bestiario de la campaña actual (PG, CA y ataques declarados en el módulo; prohibido inventar estadísticas).",
    inputSchema: z
      .object({
        sceneId: z.string().min(1),
        enemies: z
          .array(
            z
              .object({
                creatureId: creatureIdSchema,
                count: z.number().int().min(1).max(6),
              })
              .strict(),
          )
          .min(1)
          .max(6),
      })
      .strict(),
    execute: async (input): Promise<CombatStartToolOutput> => {
      const totalEnemies = input.enemies.reduce(
        (sum, group) => sum + group.count,
        0,
      );
      if (totalEnemies > 12) {
        return {
          ok: false,
          messageEs:
            "Demasiados enemigos en un solo encuentro (máximo permitido: 12).",
        };
      }

      const totalsByCreature = new Map<string, number>();
      for (const group of input.enemies) {
        totalsByCreature.set(
          group.creatureId,
          (totalsByCreature.get(group.creatureId) ?? 0) + group.count,
        );
      }

      const indexByCreature = new Map<string, number>();
      const resolvedEnemies: CombatEnemyDefinition[] = [];

      for (const group of input.enemies) {
        const statBlock = resolveCampaignCreature(rt, group.creatureId);
        if (!statBlock) {
          const validIds = (rt.adventurePack?.bestiary ?? [])
            .map((c) => c.id)
            .join(", ");
          return {
            ok: false,
            messageEs: `Criatura desconocida en el bestiario de la campaña: "${group.creatureId}".${validIds ? ` Válidas: ${validIds}.` : ""}`,
          };
        }

        const totalOfKind = totalsByCreature.get(group.creatureId) ?? 1;
        const dexMod = getAbilityModifier(statBlock.abilities.dex);
        const attacks = statBlock.attacks.map((atk, idx) => ({
          id: slugifyAttackId(atk.nameEs) || `ataque_${idx + 1}`,
          nameEs: atk.nameEs,
          attackBonus: atk.attackBonus,
          damageDice: atk.damageDice,
          damageType: atk.damageType,
        }));

        for (let i = 0; i < group.count; i += 1) {
          const nextNum = (indexByCreature.get(group.creatureId) ?? 0) + 1;
          indexByCreature.set(group.creatureId, nextNum);

          const id =
            totalOfKind === 1
              ? statBlock.id
              : `${statBlock.id}_${nextNum}`;
          const name =
            totalOfKind === 1
              ? statBlock.nameEs
              : `${statBlock.nameEs} #${nextNum}`;

          resolvedEnemies.push({
            id,
            name,
            creatureId: statBlock.id,
            hp: statBlock.hp,
            ac: statBlock.ac,
            dexMod,
            attacks,
            vulnerabilities: [...statBlock.vulnerabilities],
            immunities: [...statBlock.immunities],
            ...(statBlock.resistances && statBlock.resistances.length > 0
              ? { resistances: [...statBlock.resistances] }
              : {}),
          });
        }
      }

      const state = rt.getState();
      const res = startCombat(
        state,
        {
          sceneId: input.sceneId,
          enemies: resolvedEnemies,
        },
        {
          rng: rt.rng,
          createId: rt.createId,
          now: rt.now,
        },
      );

      if (!res.ok) {
        return { ok: false, messageEs: res.messageEs };
      }

      await rt.commitEvent(res.event, res.nextState);

      return {
        ok: true,
        messageEs: `Combate iniciado (Ronda ${res.combat.round}). Comienza el turno de ${res.activeCombatant.name} (iniciativa ${res.activeCombatant.initiative}).`,
        round: res.combat.round,
        activeCombatant: {
          id: res.activeCombatant.id,
          name: res.activeCombatant.name,
          kind: res.activeCombatant.kind,
          initiative: res.activeCombatant.initiative,
        },
        initiativeOrder: res.combat.combatants.map((c) => ({
          id: c.id,
          name: c.name,
          kind: c.kind,
          initiative: c.initiative,
          hp: { ...c.hp },
          ac: c.ac,
          attacks: c.attacks.map((a) => ({ ...a })),
        })),
        seq: res.event.seq,
      };
    },
  });
}
