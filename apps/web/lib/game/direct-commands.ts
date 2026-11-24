import type { GameState } from "@dungeons/rules";

export interface DirectCommandSpec {
  command: string;
  usage: string;
  description: string;
  template: string;
  toolHint: string;
}

export const DIRECT_COMMANDS: readonly DirectCommandSpec[] = [
  {
    command: "/investigar",
    usage: "/investigar [percepcion|investigacion]",
    description: "Inspeccioná la escena buscando pistas ocultas.",
    template: "/investigar ",
    toolHint: "investigate",
  },
  {
    command: "/hechizo",
    usage: "/hechizo <conjuro> [@objetivo]",
    description: "Lanzá un conjuro conocido (p. ej. /hechizo cure-wounds @Seraphina).",
    template: "/hechizo ",
    toolHint: "cast_spell",
  },
  {
    command: "/atacar",
    usage: "/atacar [@objetivo]",
    description: "Ejecutá un ataque en combate activo.",
    template: "/atacar @",
    toolHint: "combat_attack",
  },
  {
    command: "/descanso",
    usage: "/descanso <corto|largo>",
    description: "Tomá un descanso corto o largo fuera de combate.",
    template: "/descanso corto",
    toolHint: "take_rest",
  },
  {
    command: "/curar",
    usage: "/curar [@objetivo]",
    description: "Usá una poción o medicina para curar o estabilizar.",
    template: "/curar ",
    toolHint: "heal",
  },
  {
    command: "/ir",
    usage: "/ir <escena>",
    description: "Avanzá hacia una escena conectada permitida.",
    template: "/ir ",
    toolHint: "transition_scene",
  },
  {
    command: "/siguiente",
    usage: "/siguiente",
    description: "Pasá al siguiente turno en combate activo.",
    template: "/siguiente",
    toolHint: "combat_next_turn",
  },
  {
    command: "/mision",
    usage: "/mision",
    description: "Pedile al DM un recordatorio breve de tu objetivo actual.",
    template: "/mision",
    toolHint: "quest",
  },
];

export interface MentionCandidate {
  id: string;
  handle: string;
  label: string;
  kind: "pc" | "enemy" | "ally" | "npc";
  detail: string;
}

function normalizeToken(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function makeHandle(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? name.trim();
  return first.replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ_-]/g, "");
}

const SCENE_NPCS: Record<
  string,
  Array<{ id: string; handle: string; label: string; detail: string }>
> = {
  escena_01_orilla: [
    {
      id: "npc_exploradores",
      handle: "Exploradores",
      label: "Exploradores de la Espesura",
      detail: "Vigías ocultos en los juncos",
    },
  ],
  escena_03_parlamento: [
    {
      id: "npc_exploradores",
      handle: "Exploradores",
      label: "Exploradores de la Espesura",
      detail: "Patrulla fronteriza",
    },
  ],
  escena_04_campamento: [
    {
      id: "npc_mireia",
      handle: "Mireia",
      label: "Comandante Mireia",
      detail: "Líder del campamento",
    },
    {
      id: "npc_exploradores",
      handle: "Exploradores",
      label: "Vigías del embarcadero",
      detail: "Guarnición de la empalizada",
    },
  ],
  escena_04b_reparar_porton: [
    {
      id: "npc_exploradores",
      handle: "Exploradores",
      label: "Vigías del portón",
      detail: "Supervisan la reparación",
    },
  ],
  escena_06_comandante: [
    {
      id: "npc_mireia",
      handle: "Mireia",
      label: "Comandante Mireia",
      detail: "Jefa de la guarnición",
    },
  ],
};

export function getMentionCandidates(state: GameState | null): MentionCandidate[] {
  if (!state) return [];
  const out: MentionCandidate[] = [];
  const seenHandles = new Set<string>();

  for (const char of Object.values(state.characters)) {
    const handle = makeHandle(char.name) || char.id;
    seenHandles.add(normalizeToken(handle));
    out.push({
      id: char.id,
      handle,
      label: char.name,
      kind: "pc",
      detail: `PG ${char.hp.current}/${char.hp.max} · CA ${char.ac}`,
    });
  }

  if (state.combat?.active) {
    for (const c of state.combat.combatants) {
      if (c.kind === "pc" || c.defeated) continue;
      const baseHandle = c.name
        .replace(/\s+/g, "_")
        .replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ_-]/g, "");
      const handle = baseHandle || c.id;
      seenHandles.add(normalizeToken(handle));
      out.push({
        id: c.id,
        handle,
        label: c.name,
        kind: c.kind === "ally" ? "ally" : "enemy",
        detail: `PG ${c.hp.current}/${c.hp.max} · CA ${c.ac}`,
      });
    }
  }

  const sceneNpcs = SCENE_NPCS[state.sceneId] ?? [];
  for (const npc of sceneNpcs) {
    if (!seenHandles.has(normalizeToken(npc.handle))) {
      seenHandles.add(normalizeToken(npc.handle));
      out.push({
        id: npc.id,
        handle: npc.handle,
        label: npc.label,
        kind: "npc",
        detail: npc.detail,
      });
    }
  }

  return out;
}

export type ParsedDirectCommand =
  | { kind: "investigate"; skill: "investigation" | "perception" }
  | { kind: "spell"; spellQuery: string; targetMention?: string }
  | { kind: "attack"; targetMention?: string }
  | { kind: "rest"; restType: "short" | "long" }
  | { kind: "heal"; targetMention?: string }
  | { kind: "transition"; sceneQuery: string }
  | { kind: "next_turn" }
  | { kind: "quest" }
  | { kind: "unknown"; commandName: string };

export function parseDirectCommand(raw: string): ParsedDirectCommand | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }

  const tokens = trimmed.split(/\s+/);
  const cmd = normalizeToken(tokens[0] ?? "");
  const args = tokens.slice(1);

  const mentionToken = args.find((t) => t.startsWith("@"));
  const targetMention = mentionToken ? mentionToken.slice(1) : undefined;
  const cleanArgs = args.filter((t) => !t.startsWith("@"));

  if (cmd === "/investigar" || cmd === "/buscar" || cmd === "/pista") {
    const first = normalizeToken(cleanArgs[0] ?? "");
    const skill: "investigation" | "perception" = first.startsWith("perc")
      ? "perception"
      : "investigation";
    return { kind: "investigate", skill };
  }

  if (
    cmd === "/mision" ||
    cmd === "/quest" ||
    cmd === "/pistas" ||
    cmd === "/objetivo"
  ) {
    return { kind: "quest" };
  }

  if (cmd === "/hechizo" || cmd === "/conjuro" || cmd === "/cast") {
    const spellQuery = cleanArgs.join("-").trim();
    return { kind: "spell", spellQuery, targetMention };
  }

  if (cmd === "/atacar" || cmd === "/attack") {
    return { kind: "attack", targetMention };
  }

  if (cmd === "/descanso" || cmd === "/descansar" || cmd === "/rest") {
    const arg = normalizeToken(cleanArgs[0] ?? "corto");
    const restType: "short" | "long" =
      arg === "largo" || arg === "long" ? "long" : "short";
    return { kind: "rest", restType };
  }

  if (cmd === "/curar" || cmd === "/heal") {
    return { kind: "heal", targetMention };
  }

  if (cmd === "/ir" || cmd === "/viajar" || cmd === "/escena") {
    return { kind: "transition", sceneQuery: cleanArgs.join(" ").trim() };
  }

  if (cmd === "/siguiente" || cmd === "/turno" || cmd === "/next") {
    return { kind: "next_turn" };
  }

  return { kind: "unknown", commandName: tokens[0] ?? "/" };
}

export function resolveMentionToTargetId(
  mention: string | undefined,
  state: GameState,
): string | undefined {
  if (!mention) return undefined;
  const norm = normalizeToken(mention).replace(/_/g, " ");
  if (!norm) return undefined;

  for (const char of Object.values(state.characters)) {
    if (
      normalizeToken(char.id) === norm ||
      normalizeToken(char.name) === norm ||
      normalizeToken(makeHandle(char.name)) === norm ||
      normalizeToken(char.name).includes(norm)
    ) {
      return char.id;
    }
  }

  if (state.combat?.active) {
    for (const c of state.combat.combatants) {
      if (c.defeated) continue;
      if (
        normalizeToken(c.id) === norm ||
        normalizeToken(c.name) === norm ||
        normalizeToken(c.name).includes(norm)
      ) {
        return c.id;
      }
    }
  }

  return undefined;
}
