import type { DmChatUIMessage } from "@/agent/types";
import { sanitizeUntrustedText } from "@/lib/ai/prompt-safety";

export const DEFAULT_MAX_RECENT_MESSAGES = 10;
export const DEFAULT_MAX_ESTIMATED_CHARS = 12_000;
const MAX_DIGEST_CHARS = 900;

function extractMessageTextSnippet(msg: DmChatUIMessage): string {
  const textPieces: string[] = [];
  const toolNames: string[] = [];

  for (const part of msg.parts) {
    if (part.type === "text" && typeof part.text === "string") {
      textPieces.push(part.text);
    } else if (
      typeof part.type === "string" &&
      part.type.startsWith("tool-")
    ) {
      toolNames.push(part.type.slice(5));
    }
  }

  const textSummary = sanitizeUntrustedText(textPieces.join(" "), 140);
  const toolsSuffix =
    toolNames.length > 0 ? ` [tools: ${toolNames.slice(0, 4).join(", ")}]` : "";
  return `${textSummary}${toolsSuffix}`.trim();
}

export function estimateMessageChars(msg: DmChatUIMessage): number {
  let total = 24;
  for (const part of msg.parts) {
    if (part.type === "text" && typeof part.text === "string") {
      total += part.text.length;
    } else if (part.type === "reasoning" && typeof part.text === "string") {
      total += Math.min(300, part.text.length);
    } else {
      total += 160;
    }
  }
  return total;
}

export interface CompactContextResult {
  recentMessages: DmChatUIMessage[];
  trimmedCount: number;
  olderTurnsDigest: string;
  maxRecentMessages: number;
  estimatedRecentChars: number;
}

/**
 * Slides the active prompt message window for long sessions, always preserving
 * at least the newest message and aligning the window cut to a user turn when possible.
 * Older trimmed turns are condensed into a bounded sanitized digest for the system prompt.
 */
export function compactConversationContext(params: {
  messages: DmChatUIMessage[];
  maxRecentMessages?: number;
  maxEstimatedChars?: number;
}): CompactContextResult {
  const envMax = Number.parseInt(process.env.MAX_CONTEXT_MESSAGES ?? "", 10);
  const envChars = Number.parseInt(process.env.MAX_CONTEXT_CHARS ?? "", 10);
  const maxRecentMessages =
    params.maxRecentMessages ??
    (Number.isFinite(envMax) && envMax > 0
      ? envMax
      : DEFAULT_MAX_RECENT_MESSAGES);
  const maxEstimatedChars =
    params.maxEstimatedChars ??
    (Number.isFinite(envChars) && envChars > 0
      ? envChars
      : DEFAULT_MAX_ESTIMATED_CHARS);

  const { messages } = params;
  if (messages.length === 0) {
    return {
      recentMessages: [],
      trimmedCount: 0,
      olderTurnsDigest: "",
      maxRecentMessages,
      estimatedRecentChars: 0,
    };
  }

  let startIdx = messages.length - 1;
  let keptCount = 0;
  let keptChars = 0;

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i]!;
    const msgChars = estimateMessageChars(msg);
    const wouldExceedCount = keptCount + 1 > maxRecentMessages;
    const wouldExceedChars = keptChars + msgChars > maxEstimatedChars;

    if (keptCount > 0 && (wouldExceedCount || wouldExceedChars)) {
      break;
    }

    startIdx = i;
    keptCount += 1;
    keptChars += msgChars;
  }

  if (startIdx > 0) {
    const firstUserIdx = messages.findIndex(
      (m, idx) => idx >= startIdx && idx < messages.length - 1 && m.role === "user",
    );
    if (firstUserIdx > startIdx) {
      startIdx = firstUserIdx;
    }
  }

  const trimmed = messages.slice(0, startIdx);
  const recentMessages = messages.slice(startIdx);
  const estimatedRecentChars = recentMessages.reduce(
    (sum, m) => sum + estimateMessageChars(m),
    0,
  );

  if (trimmed.length === 0) {
    return {
      recentMessages,
      trimmedCount: 0,
      olderTurnsDigest: "",
      maxRecentMessages,
      estimatedRecentChars,
    };
  }

  const digestLines: string[] = [];
  let digestLen = 0;
  for (let i = 0; i < trimmed.length; i += 1) {
    const m = trimmed[i]!;
    const speaker =
      m.role === "user" ? "Jugador" : m.role === "assistant" ? "DM" : "Sistema";
    const snippet = extractMessageTextSnippet(m);
    if (!snippet) continue;
    const line = `- Turno #${i + 1} (${speaker}): ${snippet}`;
    if (digestLen + line.length + 1 > MAX_DIGEST_CHARS) {
      break;
    }
    digestLines.push(line);
    digestLen += line.length + 1;
  }

  const header = `Resumen de ${trimmed.length} turno(s) anteriores recortados de la ventana activa:`;
  const olderTurnsDigest =
    digestLines.length > 0 ? `${header}\n${digestLines.join("\n")}` : header;

  return {
    recentMessages,
    trimmedCount: trimmed.length,
    olderTurnsDigest,
    maxRecentMessages,
    estimatedRecentChars,
  };
}
