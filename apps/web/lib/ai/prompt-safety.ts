const CONTROL_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

const DELIMITER_TAGS_RE =
  /<(\/?)\s*(player_action|game_state|lorebook|memory_facts|session_recaps|older_turns_digest|system|assistant|developer|instructions)\s*>/gi;

const INJECTION_SIGNAL_RULES: ReadonlyArray<{
  label: string;
  pattern: RegExp;
}> = [
  {
    label: "ignore_instructions",
    pattern:
      /\b(ignore|disregard|forget|override)\b.{0,40}\b(previous|above|all|system|prior)\b.{0,30}\b(instructions?|prompts?|rules?)\b/i,
  },
  {
    label: "ignora_instrucciones_es",
    pattern:
      /\b(ignor[aáe]|olvid[aá]|anul[aá]|salte[aá])\b.{0,40}\b(instrucciones|reglas|directivas|system\s*prompt|prompt\s*del\s*sistema)\b/i,
  },
  {
    label: "reveal_prompt",
    pattern:
      /\b(revel[aá]|mostr[aá]|imprim[ií]|print|reveal|dump|leak|repeat)\b.{0,35}\b(system\s*prompt|prompt\s*inicial|instrucciones\s*ocultas|pistas?\s*ocultas?|todas\s*las\s*pistas)\b/i,
  },
  {
    label: "dev_or_jailbreak_mode",
    pattern:
      /\b(modo\s+desarrollador|developer\s+mode|jailbreak|dan\s+mode|sin\s+restricciones|act\s+as\s+unrestricted)\b/i,
  },
  {
    label: "force_die_or_bypass_engine",
    pattern:
      /\b(dame\s+un?\s+20\s+natural|poneme\s+20|sin\s+tirar\s+dados?|salt[aá]\s+directo\s+a\s+la\s+escena|override\s+(dc|hp|pg|seq|roll)|set\s+hp\s*=)\b/i,
  },
  {
    label: "delimiter_spoof",
    pattern:
      /<\/?\s*(player_action|game_state|lorebook|memory_facts|session_recaps|older_turns_digest|system|developer|instructions)\s*>/i,
  },
];

/**
 * Normalizes untrusted strings before inserting them into structured prompt blocks.
 * Strips control characters, neutralizes delimiter tag lookalikes, and bounds length.
 */
export function sanitizeUntrustedText(text: string, maxLen = 500): string {
  const cleaned = text
    .replace(CONTROL_CHARS_RE, "")
    .replace(
      DELIMITER_TAGS_RE,
      (_m, slash: string, tag: string) => `[${slash}${tag}]`,
    )
    .replace(/\s+/g, " ")
    .trim();

  if (maxLen > 0 && cleaned.length > maxLen) {
    return `${cleaned.slice(0, Math.max(1, maxLen - 1)).trimEnd()}…`;
  }
  return cleaned;
}

/**
 * Preserves line breaks in multi-paragraph player input while neutralizing control chars and boundary tags.
 */
function sanitizePlayerTurnText(text: string, maxLen = 4000): string {
  const cleaned = text
    .replace(CONTROL_CHARS_RE, "")
    .replace(
      DELIMITER_TAGS_RE,
      (_m, slash: string, tag: string) => `[${slash}${tag}]`,
    )
    .trim();

  if (maxLen > 0 && cleaned.length > maxLen) {
    return `${cleaned.slice(0, Math.max(1, maxLen - 1)).trimEnd()}…`;
  }
  return cleaned;
}

/**
 * Detects prompt-injection or rule-override attempts in player input for server logging.
 */
export function detectPromptInjectionSignals(text: string): {
  flagged: boolean;
  matchedPatterns: string[];
} {
  const matchedPatterns: string[] = [];
  for (const rule of INJECTION_SIGNAL_RULES) {
    if (rule.pattern.test(text)) {
      matchedPatterns.push(rule.label);
    }
  }
  return {
    flagged: matchedPatterns.length > 0,
    matchedPatterns,
  };
}

/**
 * Wraps untrusted player text in an explicit XML-like delimiter that the system prompt instructs the DM not to obey as meta-instructions.
 */
export function wrapUntrustedUserText(text: string): string {
  const safe = sanitizePlayerTurnText(text, 4000);
  return `<player_action>\n${safe}\n</player_action>`;
}

/**
 * Non-destructively wraps user text blocks inside ModelMessage arrays before calling `streamText`.
 */
export function wrapUserMessagesForModel<
  T extends { role: string; content: unknown },
>(messages: readonly T[]): T[] {
  return messages.map((msg) => {
    if (msg.role !== "user") {
      return msg;
    }

    if (typeof msg.content === "string") {
      return {
        ...msg,
        content: wrapUntrustedUserText(msg.content),
      } as T;
    }

    if (Array.isArray(msg.content)) {
      const nextContent = msg.content.map((part) => {
        if (
          part &&
          typeof part === "object" &&
          (part as { type?: unknown }).type === "text" &&
          typeof (part as { text?: unknown }).text === "string"
        ) {
          return {
            ...(part as Record<string, unknown>),
            text: wrapUntrustedUserText((part as { text: string }).text),
          };
        }
        return part;
      });
      return {
        ...msg,
        content: nextContent,
      } as T;
    }

    return msg;
  });
}
