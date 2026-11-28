import { readFileSync } from "node:fs";
import path from "node:path";
import {
  AGUAS_QUIETAS_PACK,
  computeMacroStoryArc,
  computeTensionMeter,
  deriveTurnContext,
  getAdventureProgress,
  getCheckModifier,
  getEffectiveAc,
  getSpellcastingStats,
  selectActiveNpcMinds,
  selectLorebookEntries,
  selectMentionActivatedMemories,
  type AdventurePack,
  type GameEvent,
  type GameState,
  type LorebookSelectionResult,
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
  recentConversationTexts?: readonly string[];
  activeActorId?: string;
}

export interface DmPromptLayers {
  staticSystemPrompt: string;
  dynamicTurnContext: string;
  lorebook: LorebookSelectionResult;
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

export function buildDmStaticSystemPrompt(
  state?: Pick<GameState, "ruleset" | "characters">,
  adventurePack?: AdventurePack,
): string {
  const base = loadInstructionsMarkdown();
  if (!state) {
    return base;
  }

  const pack = adventurePack ?? AGUAS_QUIETAS_PACK;
  const orderedChars = Object.values(state.characters).sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  const partySize = orderedChars.length;

  const rosterLines = orderedChars.map((char) => {
    const safeName = sanitizeUntrustedText(char.name, 80);
    const safePlayer = char.playerName
      ? ` · Jugador: ${sanitizeUntrustedText(char.playerName, 40)}`
      : "";
    const abilitiesText = `FUE ${char.abilities.str}, DES ${char.abilities.dex}, CON ${char.abilities.con}, INT ${char.abilities.int}, SAB ${char.abilities.wis}, CAR ${char.abilities.cha}`;
    return `- **${safeName}** (\`${char.id}\`, ${char.species}, ${char.className}${safePlayer}) — Atributos base: ${abilitiesText}`;
  });

  const multiplayerGuidance =
    partySize > 1
      ? (() => {
          const scalingGuide =
            partySize === 2
              ? "2 PJs: agregá +1 enemigo menor o subí a 2–3 enemigos básicos en encuentros armados."
              : partySize === 3
                ? "3 PJs: usá 3–4 enemigos o tácticas de flanqueo y cobertura en encuentros armados."
                : "4 PJs: usá 4–5 enemigos o doble frente (arqueros + cuerpo a cuerpo) para sostener el desafío.";
          return `\n### Mesa multijugador local (${partySize} jugadores)
- **Acciones individuales y escenas en pausa (\`[Escena grupal]\`):** si el mensaje del jugador contiene \`[Acción de <PJ> (actorId: ...)]\` o \`[Escena grupal — acciones acumuladas en mesa]\`, resolvé **todas** las acciones declaradas en una respuesta cohesiva usando exactamente el \`actorId\` correspondiente de cada personaje.
- **Tiradas grupales:** cuando intente algo todo el grupo (p. ej. Sigilo o Percepción grupal), en D&D 5e hay éxito grupal si al menos la mitad supera la CD; en modo Digital llamá \`resolve_check\` para cada PJ participante y en modo Híbrido llamá \`declare_check\` por cada PJ participante con su \`actorId\`.
- **Descansos en grupo:** si el grupo descansa junto, llamá a \`take_rest\` con \`applyToParty: true\`.
- **Escalado de encuentros:** ${scalingGuide}`;
        })()
      : "";

  const bestiaryLines =
    pack.bestiary.length > 0
      ? pack.bestiary.map(
          (c) => `- \`${c.id}\` (${c.nameEs}): CR ${c.cr} · CA ${c.ac} · PG ${c.hp}`,
        )
      : ["- (Sin criaturas predefinidas en este módulo)"];

  return `${base}

---

## Tono y campaña (${pack.titleEs})
- **Mundo:** ${pack.worldSummaryEs}
- **Tono:** ${pack.tonePromptEs}

### Bestiario de la campaña (${pack.bestiary.length})
${bestiaryLines.join("\n")}

---

## Contexto estructural de la campaña
- **Ruleset:** \`${state.ruleset}\` | **Tamaño de mesa:** ${partySize} ${partySize === 1 ? "jugador" : "jugadores"}
${rosterLines.join("\n")}${multiplayerGuidance}`;
}

export function buildDmDynamicTurnContext(
  state: GameState,
  events: readonly GameEvent[],
  memoryContext?: DmMemoryPromptContext,
  adventurePack?: AdventurePack,
): { dynamicTurnContext: string; lorebook: LorebookSelectionResult } {
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
              : `- [OCULTA CD ${clue.dc}]`,
          )
          .join("\n")
      : "- Ninguna en esta escena.";

  const charactersText = Object.values(state.characters)
    .map((char) => {
      const proficientSkills = KEY_SKILLS.filter((sk) =>
        Boolean(char.skillProficiencies[sk]),
      );
      const skillsToShow =
        proficientSkills.length > 0 ? proficientSkills : KEY_SKILLS.slice(0, 2);
      const mods = skillsToShow
        .map((sk) => {
          const m = getCheckModifier(char, sk, state.ruleset).totalMod;
          return `${sk}: ${m >= 0 ? `+${m}` : m}`;
        })
        .join(", ");
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
        : null;
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

      const safePlayer = char.playerName
        ? ` | Jugador: ${sanitizeUntrustedText(char.playerName, 40)}`
        : "";
      const extrasHp: string[] = [];
      if (char.hp.temp > 0) extrasHp.push(`temp: ${char.hp.temp}`);
      if (char.exhaustionLevel > 0)
        extrasHp.push(`Agotamiento: ${char.exhaustionLevel}`);
      if (safeConc) extrasHp.push(`Conc: ${safeConc}`);
      if (char.activeEffects && char.activeEffects.length > 0) {
        extrasHp.push(
          `Efectos: ${char.activeEffects
            .map((e) => {
              const diceTag = e.modifiers
                .map((m) => m.dice ?? (m.value ? `${m.value > 0 ? `+${m.value}` : m.value} ${m.target.toUpperCase()}` : m.grantsAdvantage || m.grantsAdvantageAgainst ? "ventaja" : ""))
                .filter(Boolean)
                .join(", ");
              const detail = diceTag ? ` [${diceTag}, auto en motor]` : "";
              return e.remainingRounds !== null
                ? `${e.labelEs}${detail} (${e.remainingRounds}r)`
                : `${e.labelEs}${detail}`;
            })
            .join(", ")}`,
        );
      }
      const effAc = getEffectiveAc(char);
      const acLabel =
        effAc.effectiveAc !== char.ac
          ? `${effAc.effectiveAc} (base ${char.ac})`
          : `${char.ac}`;
      const extrasHpStr =
        extrasHp.length > 0 ? ` | ${extrasHp.join(" | ")}` : "";

      return [
        `- **${safeName}** (actorId: \`${char.id}\`, ${char.species}, ${char.className} Nv.${char.level}${safePlayer})`,
        `  - PG: ${char.hp.current}/${char.hp.max} | CA: ${acLabel} | DG: ${hitDiceText} | Cond: ${cond}${extrasHpStr}`,
        ...(deathSavesLine ? [deathSavesLine] : []),
        ...(spellLine ? [spellLine] : []),
        `  - \`rollAuthority\`: \`${char.rollAuthority}\` (${char.rollAuthority === "player-declared" ? "MODO HÍBRIDO: usá `declare_check` (y `purpose: \"investigate\"` para buscar pistas)" : "MODO DIGITAL: usá `resolve_check` o `investigate`"})`,
        `  - Competencias clave: ${mods}`,
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
            if (c.activeEffects && c.activeEffects.length > 0) {
              extras.push(
                `Efectos: ${c.activeEffects
                  .map((e) =>
                    e.remainingRounds !== null
                      ? `${e.labelEs} (${e.remainingRounds}r)`
                      : e.labelEs,
                  )
                  .join(", ")}`,
              );
            }
            const effAc = getEffectiveAc(c);
            const acLabel =
              effAc.effectiveAc !== c.ac
                ? `${effAc.effectiveAc} (base ${c.ac})`
                : `${c.ac}`;
            const extrasStr = extras.length > 0 ? ` | ${extras.join(" · ")}` : "";
            return `- ${idx + 1}. **${sanitizeUntrustedText(c.name, 80)}** (id: \`${c.id}\`, ${roleLabel})${statusTag} — Ini ${c.initiative} | PG ${c.hp.current}/${c.hp.max} | CA ${acLabel}${extrasStr}\n  - Ataques: ${attacksList || "ninguno"}`;
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
    .slice(-3);
  const eventsText =
    activeEvents.length > 0
      ? activeEvents
          .map((e) => `- #${e.seq} ${e.type} (${e.actor})`)
          .join("\n")
      : "- Sin eventos todavía (seq 0).";

  const latestUserText = memoryContext?.latestUserText ?? "";
  const scanTexts =
    memoryContext?.recentConversationTexts &&
    memoryContext.recentConversationTexts.length > 0
      ? memoryContext.recentConversationTexts
      : latestUserText.trim().length > 0
        ? [latestUserText]
        : [];
  const combinedScanText = scanTexts.join(" ");

  const activeFacts = selectMentionActivatedMemories(
    memoryContext?.memoryFacts ?? [],
    state,
    combinedScanText,
    6,
  );
  const memoryBlock =
    activeFacts.length > 0
      ? `\n### Memoria activada (hitos y menciones relevantes)\n<memory_facts>\n${activeFacts
          .map(
            (f) =>
              `- [imp ${f.importance} · seq ${f.eventSeq} · ${sanitizeUntrustedText(f.category, 20)}] ${sanitizeUntrustedText(f.content, 180)}`,
          )
          .join("\n")}\n</memory_facts>\n`
      : "";

  const pack = adventurePack ?? AGUAS_QUIETAS_PACK;
  const lorebook = selectLorebookEntries(
    pack.lorebook,
    state,
    scanTexts,
    {
      scanDepth: 4,
      tokenBudget: 350,
      maxEntries: 5,
      recursionDepth: 1,
    },
  );
  const lorebookBlock =
    lorebook.entries.length > 0
      ? `\n### Lorebook activado (referencia contextual)\n<lorebook>\n${lorebook.entries
          .map(
            ({ entry }) =>
              `- **[${entry.category}] ${entry.titleEs}:** ${entry.contentEs}`,
          )
          .join("\n")}\n</lorebook>\n`
      : "";

  const activeNpcMinds = selectActiveNpcMinds(
    state,
    events,
    combinedScanText,
    pack,
  );
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
          .slice(-3)
          .map(
            (s) =>
              `- Sesión #${s.sessionNumber}: ${sanitizeUntrustedText(s.summary, 250)}`,
          )
          .join("\n")}\n</session_recaps>\n`
      : "";

  const digestBlock = memoryContext?.olderTurnsDigest?.trim()
    ? `\n### Turnos antiguos compactados\n<older_turns_digest>\n${sanitizeUntrustedText(memoryContext.olderTurnsDigest, 900)}\n</older_turns_digest>\n`
    : "";

  const progress = getAdventureProgress(state, pack);
  const storyArc = computeMacroStoryArc(state, events, pack);
  const tension = computeTensionMeter(state, events, pack);
  const turnCtx = deriveTurnContext(state, {
    activeActorId: memoryContext?.activeActorId,
  });
  const partySize = Object.keys(state.characters).length;
  const partyFocusBlock =
    partySize > 1
      ? `\n### Foco actual de mesa (${partySize} jugadores)\n- **Hablante/actor en foco:** ${turnCtx.activeActorName ?? "Grupo"} (\`${turnCtx.activeActorId ?? "party"}\`).\n`
      : "";
  const defaultEndingTitle =
    pack.scenes[pack.epilogueSceneIds[0] ?? ""]?.titleEs ?? "final estándar";
  const unlockedEndingsStr =
    progress.unlockedAlternativeEndings.length > 0
      ? progress.unlockedAlternativeEndings
          .map((e) => `${e.titleEs} (${e.summaryEs})`)
          .join("; ")
      : `ninguno todavía (solo final estándar: ${defaultEndingTitle})`;

  const dynamicTurnContext = `## Estado vivo de la campaña (fuente autoritativa)
- **Ruleset:** \`${state.ruleset}\` | **Sesión actual:** #${memoryContext?.sessionNumber ?? 1} | **Última secuencia (\`lastSeq\`):** ${state.lastSeq} | **Fase de turno (\`turnPhase\`):** \`${turnCtx.phase}\`${turnCtx.activeActorName ? ` (${turnCtx.activeActorName})` : ""}
- **Misión principal (${progress.quest.titleEs}):** ${progress.quest.objectiveEs}
- **Arco narrativo macro:** ${storyArc.summaryLineEs}${storyArc.stagnationWarningEs ? ` | AVISO DE RITMO: ${storyArc.stagnationWarningEs}` : ""}
- **Termómetro de tensión:** ${tension.score}/100 (${tension.labelEs}) — ${tension.pacingDirectiveEs}
- **Progreso de pistas:** ${progress.discoveredCount}/${progress.totalClues} totales | **Finales alternativos desbloqueados:** ${unlockedEndingsStr}
- **Escena actual (\`sceneId\`):** \`${state.sceneId}\` — **${currentScene?.titleEs ?? state.sceneId}**
- **Resumen de escena:** ${currentScene?.summaryEs ?? ""}
${state.lastSeq === 0 && currentScene?.narrativeHookEs ? `- **Gancho narrativo:** ${currentScene.narrativeHookEs}` : ""}

### Transiciones permitidas desde esta escena
${allowedTransitionsText}

### Pistas en esta escena
${cluesText}

### Personajes en escena
${charactersText}
${partyFocusBlock}${combatText}${npcMindsBlock}${lorebookBlock}${recapsBlock}${memoryBlock}${digestBlock}
### Últimos eventos activos en \`event_log\`
${eventsText}
`;

  return { dynamicTurnContext, lorebook };
}

export function buildDmPromptLayers(
  state: GameState,
  events: readonly GameEvent[],
  memoryContext?: DmMemoryPromptContext,
  adventurePack?: AdventurePack,
): DmPromptLayers {
  const staticSystemPrompt = buildDmStaticSystemPrompt(state, adventurePack);
  const { dynamicTurnContext, lorebook } = buildDmDynamicTurnContext(
    state,
    events,
    memoryContext,
    adventurePack,
  );
  return {
    staticSystemPrompt,
    dynamicTurnContext,
    lorebook,
  };
}

export function buildDmSystemPrompt(
  state: GameState,
  events: readonly GameEvent[],
  memoryContext?: DmMemoryPromptContext,
  adventurePack?: AdventurePack,
): string {
  const layers = buildDmPromptLayers(
    state,
    events,
    memoryContext,
    adventurePack,
  );
  return `${layers.staticSystemPrompt}

---

${layers.dynamicTurnContext}`;
}

/**
 * Injects the live `<game_state>` (including `<lorebook>` and memory) into the
 * latest user message without mutating earlier history messages or inserting
 * non-initial `system` messages (required by prefix caching and single-system providers).
 */
export function injectDynamicContextIntoMessages<
  T extends { role: string; content: unknown },
>(messages: readonly T[], dynamicTurnContext: string): T[] {
  const trimmed = dynamicTurnContext.trim();
  if (!trimmed) {
    return messages.slice();
  }

  let targetIdx = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "user") {
      targetIdx = i;
      break;
    }
  }
  if (targetIdx === -1) {
    return messages.slice();
  }

  const gameStateBlock = `<game_state>\n${trimmed}\n</game_state>`;
  const target = messages[targetIdx]!;

  let updatedTarget = target;
  if (typeof target.content === "string") {
    updatedTarget = {
      ...target,
      content: `${gameStateBlock}\n\n${target.content}`,
    };
  } else if (Array.isArray(target.content)) {
    const firstTextIdx = target.content.findIndex(
      (part) =>
        Boolean(part) &&
        typeof part === "object" &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string",
    );

    const nextContent =
      firstTextIdx >= 0
        ? target.content.map((part, idx) =>
            idx === firstTextIdx
              ? {
                  ...(part as Record<string, unknown>),
                  text: `${gameStateBlock}\n\n${(part as { text: string }).text}`,
                }
              : part,
          )
        : [{ type: "text", text: gameStateBlock }, ...target.content];

    updatedTarget = {
      ...target,
      content: nextContent,
    };
  }

  return messages.map((msg, idx) => (idx === targetIdx ? updatedTarget : msg));
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
    lookup_rules: createLookupRulesTool(rt.adventurePack),
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

export type DmToolSet = ReturnType<typeof createDmTools>;
export type DmToolName = keyof DmToolSet;

/**
 * Filters the DM toolset sent to the LLM based on live game state (Phase 3),
 * reducing schema token overhead and preventing invalid tool selections.
 * Note: `validateUIMessages` must still receive the full `createDmTools()` set.
 */
export function selectActiveDmTools(
  allTools: DmToolSet,
  state: GameState,
): Record<string, DmToolSet[DmToolName]> {
  const inCombat = Boolean(state.combat?.active);
  const chars = Object.values(state.characters);
  const is5eFull = state.ruleset === "5e-full";
  const hasSpellcaster =
    is5eFull && chars.some((c) => getSpellcastingStats(c) !== null);
  const hasDyingPc = is5eFull && chars.some((c) => c.hp.current === 0);
  const hasEngineRolled = chars.some(
    (c) => c.rollAuthority !== "player-declared",
  );
  const hasPlayerDeclared = chars.some(
    (c) => c.rollAuthority === "player-declared",
  );
  const currentScene = state.scenes[state.sceneId];
  const unlockedSet = new Set(state.unlockedClues[state.sceneId] ?? []);
  const hasHiddenClues = (currentScene?.clues ?? []).some(
    (c) => !unlockedSet.has(c.id),
  );
  const hasTransitions = (currentScene?.allowedTransitions.length ?? 0) > 0;

  const excluded = new Set<DmToolName>();

  if (!inCombat) {
    excluded.add("combat_attack");
    excluded.add("combat_next_turn");
    excluded.add("combat_end");
  } else {
    excluded.add("combat_start");
    excluded.add("take_rest");
    excluded.add("transition_scene");
  }

  if (!hasSpellcaster) {
    excluded.add("cast_spell");
  }
  if (!hasDyingPc) {
    excluded.add("death_save");
  }
  if (!hasEngineRolled) {
    excluded.add("resolve_check");
    excluded.add("resolve_save");
    excluded.add("investigate");
  }
  if (!hasPlayerDeclared) {
    excluded.add("declare_check");
  }
  if (!hasHiddenClues) {
    excluded.add("investigate");
  }
  if (!hasTransitions) {
    excluded.add("transition_scene");
  }

  const active: Record<string, DmToolSet[DmToolName]> = {};
  for (const [name, toolDef] of Object.entries(allTools) as Array<
    [DmToolName, DmToolSet[DmToolName]]
  >) {
    if (!excluded.has(name)) {
      active[name] = toolDef;
    }
  }
  return active;
}
