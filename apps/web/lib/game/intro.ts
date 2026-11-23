import type { GameState } from "@dungeons/rules";

import type {
  DmChatMessagePart,
  SuggestedActionItem,
} from "@/agent/types";

export const SEEDED_INTRO_TOOL_CALL_ID = "seeded-intro-suggest-actions";

const INTRO_ACTIONS: SuggestedActionItem[] = [
  {
    skill: "Percepción",
    tone: "blue",
    label: "Escudriñar los juncos y la niebla antes de avanzar",
  },
  {
    skill: "Persuasión",
    tone: "violet",
    label: "Alzar las manos y parlamentar con quienes vigilan desde la maleza",
  },
  {
    skill: "Sigilo",
    tone: "emerald",
    label: "Deslizarte en silencio hacia la columna de humo al este",
  },
];

/**
 * Deterministic opening assistant turn seeded into every new Aguas Quietas campaign.
 * Consumes 0 LLM tokens at turn 0 while giving immediate narrative framing + action buttons.
 */
export function buildSeededIntroParts(state: GameState): DmChatMessagePart[] {
  const scene = state.scenes[state.sceneId];
  const activeChar = Object.values(state.characters)[0];
  const charName = activeChar?.name ?? "viajero";
  const hook =
    scene?.narrativeHookEs ??
    "Tras huir del asedio en la capital del sur, llegás al atardecer a un banco de tierra firme rodeado de ciénaga.";

  const introText = [
    `${hook}`,
    `El agua oscura del río fronterizo arrastra ramas y ceniza, demasiado ancha y helada para cruzarla a nado. A tus pies el barro cruje bajo las botas, ${charName}; entre los juncos altos creés distinguir el roce seco de madera tensada y figuras inmóviles midiendo cada uno de tus pasos.`,
    `Al este, más allá de los sauces, una delgada columna de humo asciende hacia el cielo plomizo. La iniciativa es tuya: ¿qué hacés?`,
  ].join("\n\n");

  const sceneLabel = `AGUAS QUIETAS · ${state.ruleset.toUpperCase()}`;

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
        actions: INTRO_ACTIONS,
      },
      output: {
        ok: true,
        sceneLabel,
        actions: INTRO_ACTIONS,
      },
    },
  ];
}
