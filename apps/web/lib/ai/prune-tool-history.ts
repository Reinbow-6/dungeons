import type { DmChatMessagePart, DmChatUIMessage } from "@/agent/types";

type GenericToolPart = {
  type: `tool-${string}`;
  state?: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
};

function isToolPart(part: DmChatMessagePart): part is DmChatMessagePart & GenericToolPart {
  return typeof part.type === "string" && part.type.startsWith("tool-");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readStr(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim().length > 0) {
      return v.trim();
    }
  }
  return undefined;
}

function readNum(obj: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) {
      return v;
    }
  }
  return undefined;
}

function readBool(obj: Record<string, unknown>, ...keys: string[]): boolean | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "boolean") {
      return v;
    }
  }
  return undefined;
}

/**
 * Collapses a completed historical tool part into a single canonical line so
 * past turns stay compact while keeping mechanical truth in context.
 * Returns `null` for non-essential UI tools like `suggest_actions`.
 */
export function summarizeToolPartForHistory(
  part: DmChatMessagePart,
): string | null {
  if (!isToolPart(part)) {
    return null;
  }

  const toolName = part.type.slice(5);
  if (toolName === "suggest_actions") {
    return null;
  }

  const input = asRecord(part.input);
  const output = asRecord(part.output);
  const ok = readBool(output, "ok");

  if (ok === false) {
    const code = readStr(output, "code") ?? "error";
    return `[${toolName} → rechazado (${code})]`;
  }

  switch (toolName) {
    case "resolve_check":
    case "declare_check": {
      const skill = readStr(output, "skill") ?? readStr(input, "skill") ?? "prueba";
      const total = readNum(output, "total", "declaredTotal");
      const dc = readNum(output, "dc") ?? readNum(input, "dc");
      const success = readBool(output, "success");
      const outcome =
        success === undefined ? "resuelta" : success ? "éxito" : "fallo";
      if (total !== undefined && dc !== undefined) {
        return `[${toolName} → ${skill} ${total} vs CD ${dc}, ${outcome}]`;
      }
      return `[${toolName} → ${skill}, ${outcome}]`;
    }

    case "resolve_save": {
      const ability = (
        readStr(output, "ability") ??
        readStr(input, "ability") ??
        "salvación"
      ).toUpperCase();
      const total = readNum(output, "total");
      const dc = readNum(output, "dc") ?? readNum(input, "dc");
      const success = readBool(output, "success");
      const outcome =
        success === undefined ? "resuelta" : success ? "superada" : "fallida";
      if (total !== undefined && dc !== undefined) {
        return `[resolve_save → ${ability} ${total} vs CD ${dc}, ${outcome}]`;
      }
      return `[resolve_save → ${ability}, ${outcome}]`;
    }

    case "investigate": {
      const clues = Array.isArray(output.unlockedClues)
        ? output.unlockedClues
        : [];
      const total = readNum(output, "total");
      const countText =
        clues.length > 0
          ? `+${clues.length} pista${clues.length > 1 ? "s" : ""}`
          : "sin pistas nuevas";
      return total !== undefined
        ? `[investigate → total ${total}, ${countText}]`
        : `[investigate → ${countText}]`;
    }

    case "transition_scene": {
      const scene =
        readStr(output, "titleEs", "toSceneId") ??
        readStr(input, "targetSceneId") ??
        "escena";
      return `[transition_scene → ${scene}]`;
    }

    case "inventory": {
      const item =
        readStr(output, "itemName", "itemId") ??
        readStr(input, "itemName", "itemId") ??
        "objeto";
      const qty = readNum(output, "quantityAfter");
      return qty !== undefined
        ? `[inventory → ${item} x${qty}]`
        : `[inventory → ${item}]`;
    }

    case "combat_start": {
      const order = Array.isArray(output.initiativeOrder)
        ? output.initiativeOrder
        : Array.isArray(output.combatants)
          ? output.combatants
          : null;
      return order !== null
        ? `[combat_start → ${order.length} combatientes]`
        : "[combat_start → combate iniciado]";
    }

    case "combat_attack": {
      const hit = readBool(output, "hit");
      const crit = readBool(output, "isCritical");
      const dmg = readNum(output, "damageApplied");
      const target = readStr(output, "targetName", "targetId");
      const targetSuffix = target ? ` a ${target}` : "";
      if (crit) {
        return `[combat_attack → crítico, ${dmg ?? 0} daño${targetSuffix}]`;
      }
      if (hit) {
        return `[combat_attack → impacto, ${dmg ?? 0} daño${targetSuffix}]`;
      }
      return `[combat_attack → fallo${targetSuffix}]`;
    }

    case "combat_next_turn": {
      const activeObj = asRecord(output.activeCombatant);
      const active =
        readStr(activeObj, "name", "id") ??
        readStr(output, "activeCombatantName");
      const round = readNum(output, "round");
      return active
        ? `[combat_next_turn → ${active}${round ? ` (R${round})` : ""}]`
        : "[combat_next_turn → ok]";
    }

    case "combat_end": {
      const outcome =
        readStr(output, "outcome") ?? readStr(input, "outcome") ?? "cerrado";
      return `[combat_end → ${outcome}]`;
    }

    case "cast_spell": {
      const spell =
        readStr(output, "spellNameEs", "spellName", "spellId") ??
        readStr(input, "spellId") ??
        "conjuro";
      const dmg = readNum(output, "damageApplied");
      const heal = readNum(output, "healingApplied");
      if (dmg !== undefined && dmg > 0) {
        return `[cast_spell → ${spell}, ${dmg} daño]`;
      }
      if (heal !== undefined && heal > 0) {
        return `[cast_spell → ${spell}, +${heal} PG]`;
      }
      return `[cast_spell → ${spell}]`;
    }

    case "take_rest": {
      const restType =
        readStr(output, "restType") ?? readStr(input, "restType") ?? "short";
      const healed = readNum(output, "hpHealed");
      return healed !== undefined && healed > 0
        ? `[take_rest → ${restType}, +${healed} PG]`
        : `[take_rest → ${restType}]`;
    }

    case "death_save": {
      const nat = readNum(output, "naturalRoll");
      const outcome = readStr(output, "outcome");
      if (nat === 20 || outcome === "critical_recovery") {
        return "[death_save → NAT 20 (+1 PG)]";
      }
      if (outcome) {
        return `[death_save → ${outcome}]`;
      }
      const success = readBool(output, "success");
      return `[death_save → ${success ? "éxito" : "fallo"}]`;
    }

    case "heal": {
      const healed = readNum(output, "hpHealed");
      const stabilized = readBool(output, "stabilized");
      if (healed !== undefined && healed > 0) {
        return `[heal → +${healed} PG]`;
      }
      return stabilized ? "[heal → estabilizado]" : "[heal → ok]";
    }

    case "apply_condition": {
      const conds = Array.isArray(output.conditionsAfter)
        ? output.conditionsAfter.join(", ")
        : undefined;
      return conds
        ? `[apply_condition → ${conds}]`
        : "[apply_condition → actualizado]";
    }

    case "remember_fact": {
      const cat = readStr(output, "category") ?? readStr(input, "category");
      return cat ? `[remember_fact → ${cat}]` : "[remember_fact → guardado]";
    }

    case "rollback_to_event": {
      const seq = readNum(output, "targetSeq") ?? readNum(input, "targetSeq");
      return seq !== undefined
        ? `[rollback_to_event → seq ${seq}]`
        : "[rollback_to_event → ok]";
    }

    case "lookup_rules": {
      const query = readStr(input, "query");
      return query ? `[lookup_rules → "${query}"]` : "[lookup_rules → ok]";
    }

    case "ask_user":
      return "[ask_user → respondido]";

    default:
      return `[${toolName} → ok]`;
  }
}

/**
 * Prunes verbose tool call/result payloads and reasoning blocks from completed
 * historical assistant turns before `convertToModelMessages`.
 *
 * When the conversation ends on an assistant message (active turn resuming
 * after client-resolved `declare_check` / `ask_user`), that final assistant
 * message retains its full tool outputs verbatim so the model can narrate them.
 */
export function pruneHistoricalToolOutputs(
  messages: readonly DmChatUIMessage[],
): DmChatUIMessage[] {
  if (messages.length === 0) {
    return [];
  }

  const lastIndex = messages.length - 1;
  const preserveLastAssistant = messages[lastIndex]?.role === "assistant";

  return messages.map((msg, idx) => {
    if (msg.role !== "assistant") {
      return msg;
    }

    if (preserveLastAssistant && idx === lastIndex) {
      return msg;
    }

    const toolSummaries: string[] = [];
    const textPieces: string[] = [];
    let hasPrunedParts = false;

    for (const part of msg.parts) {
      if (part.type === "text" && typeof part.text === "string") {
        if (part.text.trim().length > 0) {
          textPieces.push(part.text);
        }
        continue;
      }

      if (part.type === "reasoning") {
        hasPrunedParts = true;
        continue;
      }

      if (isToolPart(part)) {
        hasPrunedParts = true;
        const summary = summarizeToolPartForHistory(part);
        if (summary) {
          toolSummaries.push(summary);
        }
        continue;
      }
    }

    if (!hasPrunedParts) {
      return msg;
    }

    const summaryPrefix =
      toolSummaries.length > 0
        ? `<resumen_motor>\n${toolSummaries.join("\n")}\n</resumen_motor>`
        : "";
    const narrativeBody = textPieces.join("\n\n").trim();
    const combinedText = [summaryPrefix, narrativeBody]
      .filter((chunk) => chunk.length > 0)
      .join("\n\n");

    const nextParts: DmChatMessagePart[] =
      combinedText.length > 0 ? [{ type: "text", text: combinedText }] : [];

    return {
      ...msg,
      parts: nextParts,
    };
  });
}
