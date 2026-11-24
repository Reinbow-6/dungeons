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
  const pcs = Object.values(state.characters);
  const activeChar = pcs[0];
  const charName = activeChar?.name ?? "viajero";
  const isGroup = pcs.length > 1;
  const hook =
    scene?.narrativeHookEs ??
    "Tras huir del asedio en la capital del sur, llegás al atardecer a un banco de tierra firme rodeado de ciénaga.";

  let introText: string;
  if (isGroup) {
    const namesList = pcs.map((pc) =>
      pc.playerName ? `${pc.name} (${pc.playerName})` : pc.name,
    );
    const partyNames =
      namesList.length === 2
        ? `${namesList[0]} y ${namesList[1]}`
        : `${namesList.slice(0, -1).join(", ")} y ${namesList.at(-1)}`;
    const groupHook = hook
      .replace("llegás al atardecer", "llegan al atardecer")
      .replace("cruzarlo", "cruzarlo");

    introText = [
      `${groupHook}`,
      `El agua oscura del río fronterizo arrastra ramas y ceniza, demasiado ancha y helada para cruzarla a nado. Bajo las botas de **${partyNames}** el barro cruje entre los juncos altos; a lo lejos se distingue el roce seco de madera tensada y figuras inmóviles midiendo cada uno de sus pasos.`,
      `**Objetivo principal del grupo:** consigan paso en la barcaza del campamento al este (por trato, ayuda o sigilo) y crucen hacia la Otra Orilla antes de que las patrullas del asedio los alcancen. Pueden investigar cada escena con \`/investigar\` o coordinar con el modo **DM en pausa** antes de enviar sus acciones. La iniciativa es suya: ¿qué hacen?`,
    ].join("\n\n");
  } else {
    introText = [
      `${hook}`,
      `El agua oscura del río fronterizo arrastra ramas y ceniza, demasiado ancha y helada para cruzarla a nado. A tus pies el barro cruje bajo las botas, ${charName}; entre los juncos altos creés distinguir el roce seco de madera tensada y figuras inmóviles midiendo cada uno de tus pasos.`,
      `**Objetivo principal:** conseguí paso en la barcaza del campamento al este (por trato, ayuda o sigilo) y cruzá hacia la Otra Orilla antes de que las patrullas del asedio te alcancen. Podés investigar cada escena con \`/investigar\` para descubrir pistas ocultas que abren rutas y finales alternativos. La iniciativa es tuya: ¿qué hacés?`,
    ].join("\n\n");
  }

  const sceneLabel = `AGUAS INQUIETAS · ${state.ruleset.toUpperCase()}`;

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
