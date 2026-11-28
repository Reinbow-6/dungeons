import {
  AGUAS_QUIETAS_PACK,
  type AdventurePack,
  type GameState,
} from "@dungeons/rules";

import type {
  DmChatMessagePart,
  SuggestedActionItem,
} from "@/agent/types";

export const SEEDED_INTRO_TOOL_CALL_ID = "seeded-intro-suggest-actions";

function formatIntroParagraphs(
  paragraphs: readonly string[],
  vars: { charName: string; partyNames: string },
): string {
  return paragraphs
    .map((p) =>
      p
        .replaceAll("{{charName}}", vars.charName)
        .replaceAll("{{partyNames}}", vars.partyNames),
    )
    .join("\n\n");
}

/**
 * Deterministic opening assistant turn seeded into any campaign from its AdventurePack.
 * Consumes 0 LLM tokens at turn 0 while giving immediate narrative framing + action buttons.
 */
export function buildSeededIntroParts(
  state: GameState,
  pack?: AdventurePack | null,
): DmChatMessagePart[] {
  const resolvedPack = pack ?? AGUAS_QUIETAS_PACK;
  const pcs = Object.values(state.characters);
  const activeChar = pcs[0];
  const charName = activeChar?.name ?? "viajero";
  const isGroup = pcs.length > 1;

  const namesList = pcs.map((pc) =>
    pc.playerName ? `${pc.name} (${pc.playerName})` : pc.name,
  );
  const partyNames =
    namesList.length === 0
      ? charName
      : namesList.length === 1
        ? namesList[0]!
        : namesList.length === 2
          ? `${namesList[0]} y ${namesList[1]}`
          : `${namesList.slice(0, -1).join(", ")} y ${namesList.at(-1)}`;

  const paragraphs = isGroup
    ? resolvedPack.intro.groupParagraphsEs
    : resolvedPack.intro.soloParagraphsEs;
  const introText = formatIntroParagraphs(paragraphs, { charName, partyNames });

  const sceneLabel = `${resolvedPack.titleEs.toUpperCase()} · ${state.ruleset.toUpperCase()}`;
  const actions: SuggestedActionItem[] = resolvedPack.intro.suggestedActions.map(
    (a) => ({
      skill: a.skill,
      tone: a.tone === "rose" ? "amber" : a.tone,
      label: a.label,
    }),
  );

  return [
    {
      type: "text",
      text: introText,
    },
    {
      type: "tool-suggest_actions",
      toolCallId: SEEDED_INTRO_TOOL_CALL_ID,
      state: "output-available",
      input: {
        sceneLabel,
        actions,
      },
      output: {
        ok: true,
        sceneLabel,
        actions,
      },
    },
  ];
}
