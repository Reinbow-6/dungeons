import { readFileSync } from "node:fs";
import path from "node:path";
import {
  computeMacroStoryArc,
  computeTensionMeter,
  deriveTurnContext,
  getAguasInquietasProgress,
  getCheckModifier,
  getSpellcastingStats,
  selectActiveNpcMinds,
  selectMentionActivatedMemories,
  type GameEvent,
  type GameState,
  type Skill,
} from "@dungeons/rules";

import { createApplyConditionTool } from "@/agent/tools/apply-condition";
import { createCastSpellTool } from "@/agent/tools/cast-spell";
import { createCombatAttackTool } from "@/agent/tools/combat-attack";
import { createCombatEndTool } from "@/agent/tools/combat-end";
import { createCombatNextTurnTool } from "@/agent/tools/combat-next-turn";
import { createCombatStartTool } from "@/agent/tools/combat-start";
import { createDeathSaveTool } from "@/agent/tools/death-save";
import { declareCheckTool } from "@/agent/tools/declare-check";
import { createHealTool } from "@/agent/tools/heal";
import { createInventoryTool } from "@/agent/tools/inventory";
import { createInvestigateTool } from "@/agent/tools/investigate";
import { createLookupRulesTool } from "@/agent/tools/lookup-rules";
import { createRememberFactTool } from "@/agent/tools/remember-fact";
import { createResolveCheckTool } from "@/agent/tools/resolve-check";
import { createResolveSaveTool } from "@/agent/tools/resolve-save";
import { createRollbackTool } from "@/agent/tools/rollback-to-event";
import type { DmToolRuntime } from "@/agent/tools/runtime";
import { createSuggestActionsTool } from "@/agent/tools/suggest-actions";
import { createTakeRestTool } from "@/agent/tools/take-rest";
import { createTransitionSceneTool } from "@/agent/tools/transition-scene";
import { sanitizeUntrustedText } from "@/lib/ai/prompt-safety";
import type { SessionSummaryItem, StoredMemoryFact } from "@/lib/game/store";
import { askUser } from "@/tools/ask_user";

export * from "@/agent/types";
export type { DmToolRuntime } from "@/agent/tools/runtime";

export interface DmMemoryPromptContext {
  sessionNumber?: number;
  worldSummary?: string;
  sessionSummaries?: readonly SessionSummaryItem[];
  memoryFacts?: readonly StoredMemoryFact[];
  olderTurnsDigest?: string;
  latestUserText?: string;
}

const KEY_SKILLS: Skill[] = [
  "perception",
  "investigation",
  "stealth",
  "persuasion",
  "deception",
  "intimidation",
  "insight",
  "athletics",
  "survival",
];

const FALLBACK_INSTRUCTIONS =
  "Sos el Dungeon Master de una partida D&D 5e (SRD 5.2.1) en español. El motor decide mediante tools; vos narrás el mundo y respetás el modo híbrido cuando rollAuthority es player-declared.";

function loadInstructionsMarkdown(): string {
  try {
    const filePath = path.join(process.cwd(), "agent", "instructions.md");
    const content = readFileSync(filePath, "utf8").trim();
    if (content.length > 0) {
      return content;
    }
  } catch {
    // Fallback if instructions.md is unavailable in a test cwd
  }
  return FALLBACK_INSTRUCTIONS;
}

export function buildDmSystemPrompt(
  state: GameState,
  events: readonly GameEvent[],
  memoryContext?: DmMemoryPromptContext,
): string {
  const base = loadInstructionsMarkdown();
  const currentScene = state.scenes[state.sceneId];
  const unlockedIds = state.unlockedClues[state.sceneId] ?? [];
  const unlockedSet = new Set(unlockedIds);

  const allowedTransitionsText =
    currentScene && currentScene.allowedTransitions.length > 0
      ? currentScene.allowedTransitions
          .map((id) => {
            const target = state.scenes[id];
            return `- \`${id}\`: ${target?.titleEs ?? id}`;
          })
          .join("\n")
      : "- (Sin transiciones salientes: fin de acto)";

  const cluesText =
    currentScene && currentScene.clues.length > 0
      ? currentScene.clues
          .map((clue) =>
            unlockedSet.has(clue.id)
              ? `- [DESBLOQUEADA CD ${clue.dc}] ${clue.titleEs}: ${clue.descriptionEs}`
              : `- [OCULTA CD ${clue.dc}] Pista pendiente (requiere tool \`investigate\`)`,
          )
          .join("\n")
      : "- Ninguna en esta escena.";

  const charactersText = Object.values(state.characters)
    .map((char) => {
      const mods = KEY_SKILLS.map((sk) => {
        const m = getCheckModifier(char, sk, state.ruleset).totalMod;
        return `${sk}: ${m >= 0 ? `+${m}` : m}`;
      }).join(", ");
      const inv =
        char.inventory.length > 0
          ? char.inventory
              .map(
                (i) =>
                  `${sanitizeUntrustedText(i.name, 80)} x${i.quantity}`,
              )
              .join(", ")
          : "vacío";
      const cond =
        char.conditions.length > 0 ? char.conditions.join(", ") : "ninguna";
      const safeName = sanitizeUntrustedText(char.name, 80);
      const safeConc = char.concentratingOn
        ? sanitizeUntrustedText(char.concentratingOn, 80)
        : "ninguna";
      const spellStats = getSpellcastingStats(char);
      const slotEntries = Object.entries(char.spellSlots)
        .map(([lvl, pool]) => `Nv.${lvl}: ${pool.current}/${pool.max}`)
        .join(", ");
      const hitDiceText = char.hitDice
        ? `${char.hitDice.current}/${char.hitDice.max} ${char.hitDice.die}`
        : `1/1`;
      const deathSavesLine =
        char.hp.current === 0
          ? `  - Salvaciones de muerte: éxitos ${char.deathSaves?.successes ?? 0}/3, fallos ${char.deathSaves?.failures ?? 0}/3${char.deathSaves?.stable ? " (ESTABLE)" : " (MORIBUNDO — usar death_save o curación)"}`
          : null;
      const spellLine = spellStats
        ? `  - Magia (${spellStats.ability.toUpperCase()}): CD ${spellStats.spellSaveDc} | Ataque +${spellStats.spellAttackBonus} | Espacios: ${slotEntries || "ninguno"}${char.knownSpells && char.knownSpells.length > 0 ? ` | Conjuros: ${char.knownSpells.join(", ")}` : ""}`
        : null;

      return [
        `- **${safeName}** (actorId: \`${char.id}\`, ${char.species}, ${char.className} Nv.${char.level})`,
        `  - PG: ${char.hp.current}/${char.hp.max} (temp: ${char.hp.temp}) | CA: ${char.ac} | Dados de Golpe: ${hitDiceText} | Condiciones: ${cond} | Agotamiento: ${char.exhaustionLevel} | Concentración: ${safeConc}`,
        ...(deathSavesLine ? [deathSavesLine] : []),
        ...(spellLine ? [spellLine] : []),
        `  - Modo de tiradas (\`rollAuthority\`): \`${char.rollAuthority}\` (${char.rollAuthority === "player-declared" ? "MODO HÍBRIDO: usá `declare_check` para las pruebas del jugador" : "MODO DIGITAL: usá `resolve_check`"})`,
        `  - Modificadores clave: ${mods}`,
        `  - Inventario: ${inv}`,
      ].join("\n");
    })
    .join("\n");

  const activeCombat = state.combat?.active ? state.combat : null;
  const combatText = activeCombat
    ? (() => {
        const currentTurn = activeCombat.combatants[activeCombat.turnIndex];
        const rows = activeCombat.combatants
          .map((c, idx) => {
            const isTurn = idx === activeCombat.turnIndex && !c.defeated;
            const roleLabel =
              c.kind === "pc"
                ? "PJ"
                : c.kind === "ally"
                  ? "Aliado"
                  : "Enemigo";
            const statusTag = c.defeated
              ? " [DERROTADO]"
              : isTurn
                ? " [TURNO ACTUAL]"
                : "";
            const attacksList = c.attacks
              .map(
                (a) =>
                  `\`${a.id}\` (${a.nameEs}: ${a.attackBonus >= 0 ? `+${a.attackBonus}` : a.attackBonus}, ${a.damageDice} ${a.damageType})`,
              )
              .join("; ");
            const extras: string[] = [];
            if (c.vulnerabilities.length > 0) {
              extras.push(`Vulnerable: ${c.vulnerabilities.join(", ")}`);
            }
            if (c.resistances && c.resistances.length > 0) {
              extras.push(`Resistente: ${c.resistances.join(", ")}`);
            }
            if (c.immunities.length > 0) {
              extras.push(`Inmune: ${c.immunities.join(", ")}`);
            }
            if (c.conditions && c.conditions.length > 0) {
              extras.push(`Cond: ${c.conditions.join(", ")}`);
            }
            const extrasStr = extras.length > 0 ? ` | ${extras.join(" · ")}` : "";
            return `- ${idx + 1}. **${sanitizeUntrustedText(c.name, 80)}** (id: \`${c.id}\`, ${roleLabel})${statusTag} — Ini ${c.initiative} | PG ${c.hp.current}/${c.hp.max} | CA ${c.ac}${extrasStr}\n  - Ataques: ${attacksList || "ninguno"}`;
          })
          .join("\n");

        return `\n### Combate activo (Ronda ${activeCombat.round})
- **Turno actual:** ${currentTurn ? `${sanitizeUntrustedText(currentTurn.name, 80)} (\`${currentTurn.id}\`)` : "ninguno"}
${rows}
`;
      })()
    : "";

  const activeEvents = events
    .filter((e) => e.revertedByEventId === null && e.type !== "ROLLBACK")
    .slice(-5);
  const eventsText =
    activeEvents.length > 0
      ? activeEvents
          .map(
            (e) =>
              `- seq ${e.seq} [${e.source}] ${e.type} (actor=${e.actor})`,
          )
          .join("\n")
      : "- Sin eventos todavía (seq 0).";

  const latestUserText = memoryContext?.latestUserText ?? "";
  const activeFacts = selectMentionActivatedMemories(
    memoryContext?.memoryFacts ?? [],
    state,
    latestUserText,
    10,
  );
  const memoryBlock =
    activeFacts.length > 0
      ? `\n### Memoria activada (hitos y menciones relevantes)\n<memory_facts>\n${activeFacts
          .map(
            (f) =>
              `- [imp ${f.importance} · seq ${f.eventSeq} · ${sanitizeUntrustedText(f.category, 20)}] ${sanitizeUntrustedText(f.content, 280)}`,
          )
          .join("\n")}\n</memory_facts>\n`
      : "";

  const activeNpcMinds = selectActiveNpcMinds(state, events, latestUserText);
  const npcMindsBlock =
    activeNpcMinds.length > 0
      ? `\n### Mentes compartimentadas de NPCs activos/mencionados\n${activeNpcMinds
          .map(
            (npc) =>
              `- **${npc.nameEs}** (${npc.roleEs}):\n  - Sabe: ${npc.knowsEs}\n  - Ignora (NO metagamear): ${npc.doesNotKnowEs}\n  - Quiere: ${npc.wantsEs}\n  - Oculta: ${npc.hidesEs}\n  - Actitud actual: ${npc.attitudeEs}`,
          )
          .join("\n")}\n`
      : "";

  const closedSessions = (memoryContext?.sessionSummaries ?? []).filter(
    (s) => s.summary.trim().length > 0,
  );
  const worldLine = memoryContext?.worldSummary?.trim()
    ? `Mundo: ${sanitizeUntrustedText(memoryContext.worldSummary, 300)}\n`
    : "";
  const recapsBlock =
    worldLine || closedSessions.length > 0
      ? `\n### Resumen de sesiones anteriores (Sesión activa #${memoryContext?.sessionNumber ?? 1})\n<session_recaps>\n${worldLine}${closedSessions
          .slice(-5)
          .map(
            (s) =>
              `- Sesión #${s.sessionNumber}: ${sanitizeUntrustedText(s.summary, 400)}`,
          )
          .join("\n")}\n</session_recaps>\n`
      : "";

  const digestBlock = memoryContext?.olderTurnsDigest?.trim()
    ? `\n### Turnos antiguos compactados\n<older_turns_digest>\n${sanitizeUntrustedText(memoryContext.olderTurnsDigest, 1200)}\n</older_turns_digest>\n`
    : "";

  const progress = getAguasInquietasProgress(state);
  const storyArc = computeMacroStoryArc(state, events);
  const tension = computeTensionMeter(state, events);
  const turnCtx = deriveTurnContext(state);
  const unlockedEndingsStr =
    progress.unlockedAlternativeEndings.length > 0
      ? progress.unlockedAlternativeEndings
          .map((e) => `${e.titleEs} (${e.summaryEs})`)
          .join("; ")
      : "ninguno todavía (solo final estándar Escape en la Niebla)";

  return `${base}

---

## Estado vivo de la campaña (fuente autoritativa)
- **Ruleset:** \`${state.ruleset}\` | **Sesión actual:** #${memoryContext?.sessionNumber ?? 1} | **Última secuencia (\`lastSeq\`):** ${state.lastSeq} | **Fase de turno (\`turnPhase\`):** \`${turnCtx.phase}\`${turnCtx.activeActorName ? ` (${turnCtx.activeActorName})` : ""}
- **Misión principal (${progress.quest.titleEs}):** ${progress.quest.objectiveEs}
- **Arco narrativo macro:** ${storyArc.summaryLineEs}${storyArc.stagnationWarningEs ? ` | AVISO DE RITMO: ${storyArc.stagnationWarningEs}` : ""}
- **Termómetro de tensión:** ${tension.score}/100 (${tension.labelEs}) — ${tension.pacingDirectiveEs}
- **Progreso de pistas:** ${progress.discoveredCount}/${progress.totalClues} totales | **Finales alternativos desbloqueados:** ${unlockedEndingsStr}
- **Escena actual (\`sceneId\`):** \`${state.sceneId}\` — **${currentScene?.titleEs ?? state.sceneId}**
- **Resumen de escena:** ${currentScene?.summaryEs ?? ""}
${currentScene?.narrativeHookEs ? `- **Gancho narrativo:** ${currentScene.narrativeHookEs}` : ""}

### Transiciones permitidas desde esta escena
${allowedTransitionsText}

### Pistas en esta escena
${cluesText}

### Personajes en escena
${charactersText}
${combatText}${npcMindsBlock}${recapsBlock}${memoryBlock}${digestBlock}
### Últimos eventos activos en \`event_log\`
${eventsText}
`;
}

export function createDmTools(rt: DmToolRuntime) {
  return {
    resolve_check: createResolveCheckTool(rt),
    resolve_save: createResolveSaveTool(rt),
    declare_check: declareCheckTool,
    investigate: createInvestigateTool(rt),
    transition_scene: createTransitionSceneTool(rt),
    inventory: createInventoryTool(rt),
    rollback_to_event: createRollbackTool(rt),
    lookup_rules: createLookupRulesTool(),
    combat_start: createCombatStartTool(rt),
    combat_attack: createCombatAttackTool(rt),
    combat_next_turn: createCombatNextTurnTool(rt),
    combat_end: createCombatEndTool(rt),
    apply_condition: createApplyConditionTool(rt),
    remember_fact: createRememberFactTool(rt),
    cast_spell: createCastSpellTool(rt),
    take_rest: createTakeRestTool(rt),
    death_save: createDeathSaveTool(rt),
    heal: createHealTool(rt),
    suggest_actions: createSuggestActionsTool(),
    ask_user: askUser,
  };
}
