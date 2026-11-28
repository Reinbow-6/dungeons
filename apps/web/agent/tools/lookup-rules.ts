import type { AdventurePack } from "@dungeons/rules";
import { lookupRules } from "@dungeons/srd";
import { tool } from "ai";
import { z } from "zod";

import type { LookupRulesToolOutput } from "@/agent/types";

type LookupEntry = LookupRulesToolOutput["results"][number];

function matchBestiaryEntries(
  pack: AdventurePack | undefined,
  query: string,
): LookupEntry[] {
  if (!pack || pack.bestiary.length === 0) return [];
  const q = query
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  if (!q) return [];

  return pack.bestiary
    .filter((c) => {
      const hay = `${c.id} ${c.nameEs} ${c.traitsEs.join(" ")}`
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
      return hay.includes(q) || q.includes(c.id.toLowerCase());
    })
    .map((c) => ({
      category: "monster",
      index: c.id,
      name: c.nameEs,
      nameEs: c.nameEs,
      rulesetVersion: "5.2.1",
      summaryEs: `CR ${c.cr} · CA ${c.ac} · PG ${c.hp} · ${c.speedTextEs}. Ataques: ${c.attacks
        .map((a) => `${a.nameEs} (+${a.attackBonus}, ${a.damageDice} ${a.damageType})`)
        .join("; ")}.${c.traitsEs.length > 0 ? ` ${c.traitsEs.join(" ")}` : ""}`,
    }));
}

export function createLookupRulesTool(adventurePack?: AdventurePack) {
  return tool({
    description:
      "Consulta reglas vigentes SRD 5.2.1 en español o inglés (condiciones, habilidades, equipo, conjuros y bestiario oficial de la campaña actual).",
    inputSchema: z
      .object({
        query: z.string().min(1),
        category: z
          .enum(["condition", "skill", "equipment", "spell", "monster"])
          .optional(),
        limit: z.number().int().min(1).max(15).optional(),
      })
      .strict(),
    execute: async (input): Promise<LookupRulesToolOutput> => {
      const limit = input.limit ?? 5;
      const localMonsters =
        !input.category || input.category === "monster"
          ? matchBestiaryEntries(adventurePack, input.query)
          : [];
      const srdResults = lookupRules({
        query: input.query,
        category: input.category,
        limit,
      });

      const seen = new Set(localMonsters.map((m) => m.index));
      const merged = [
        ...localMonsters,
        ...srdResults.filter((r) => !seen.has(r.index)),
      ].slice(0, limit);

      return {
        ok: true,
        results: merged,
      };
    },
  });
}
