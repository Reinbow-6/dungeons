import type { Character } from "@dungeons/rules";

export interface PartyRoundEntry {
  actorId: string;
  text: string;
}

export type ParsedPartyMessage =
  | { kind: "plain"; text: string }
  | { kind: "single"; actorId: string; text: string }
  | { kind: "round"; entries: PartyRoundEntry[] };

const SINGLE_ACTOR_REGEX = /^\[\[actor:([a-zA-Z0-9_-]+)\]\]\s*([\s\S]*)$/;
const ROUND_HEADER = "[[round]]";

export function formatSingleActorMessage(actorId: string, text: string): string {
  const trimmed = text.trim();
  return `[[actor:${actorId}]] ${trimmed}`;
}

export function formatGroupRoundMessage(
  entries: readonly PartyRoundEntry[],
): string {
  const clean = entries
    .map((e) => ({
      actorId: e.actorId.trim(),
      text: e.text.replace(/\r?\n/g, " ").trim(),
    }))
    .filter((e) => e.actorId.length > 0 && e.text.length > 0);

  if (clean.length === 0) return "";
  if (clean.length === 1) {
    return formatSingleActorMessage(clean[0]!.actorId, clean[0]!.text);
  }

  return [
    ROUND_HEADER,
    ...clean.map((e) => `[[actor:${e.actorId}]] ${e.text}`),
  ].join("\n");
}

export function parsePartyMessage(rawText: string): ParsedPartyMessage {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return { kind: "plain", text: rawText };
  }

  if (trimmed.startsWith(ROUND_HEADER)) {
    const lines = trimmed
      .slice(ROUND_HEADER.length)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const entries: PartyRoundEntry[] = [];
    for (const line of lines) {
      const m = line.match(SINGLE_ACTOR_REGEX);
      if (m && m[1] && m[2]?.trim()) {
        entries.push({ actorId: m[1], text: m[2].trim() });
      }
    }

    if (entries.length >= 2) {
      return { kind: "round", entries };
    }
    if (entries.length === 1) {
      return {
        kind: "single",
        actorId: entries[0]!.actorId,
        text: entries[0]!.text,
      };
    }
  }

  const singleMatch = trimmed.match(SINGLE_ACTOR_REGEX);
  if (singleMatch && singleMatch[1] && singleMatch[2]?.trim()) {
    return {
      kind: "single",
      actorId: singleMatch[1],
      text: singleMatch[2].trim(),
    };
  }

  return { kind: "plain", text: rawText };
}

function formatSpeakerTag(
  actorId: string,
  characters: Record<string, Character>,
): string {
  const ch = characters[actorId];
  if (!ch) return actorId;
  const playerSuffix = ch.playerName ? `, Jugador: ${ch.playerName}` : "";
  return `${ch.name} (actorId: ${ch.id}${playerSuffix})`;
}

export function expandPartyMessageForDm(
  rawText: string,
  characters: Record<string, Character>,
): string {
  const parsed = parsePartyMessage(rawText);
  if (parsed.kind === "plain") {
    return rawText;
  }
  if (parsed.kind === "single") {
    return `[Acción de ${formatSpeakerTag(parsed.actorId, characters)}]: ${parsed.text}`;
  }
  return [
    "[Escena grupal — acciones acumuladas en mesa]",
    ...parsed.entries.map(
      (e) => `- ${formatSpeakerTag(e.actorId, characters)}: ${e.text}`,
    ),
  ].join("\n");
}
