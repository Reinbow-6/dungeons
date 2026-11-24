import { createAguasQuietasInitialState } from "@dungeons/rules";
import { describe, expect, it } from "vitest";

import {
  DIRECT_COMMANDS,
  getMentionCandidates,
  parseDirectCommand,
  resolveMentionToTargetId,
} from "@/lib/game/direct-commands";

describe("Direct mechanics: /commands as LLM tool guides & @mentions", () => {
  it("excludes /tirar and maps each /command to its target DM tool", () => {
    const names = DIRECT_COMMANDS.map((c) => c.command);
    expect(names).not.toContain("/tirar");
    expect(DIRECT_COMMANDS.find((c) => c.command === "/investigar")?.toolHint).toBe(
      "investigate",
    );
    expect(DIRECT_COMMANDS.find((c) => c.command === "/hechizo")?.toolHint).toBe(
      "cast_spell",
    );
    expect(DIRECT_COMMANDS.find((c) => c.command === "/descanso")?.toolHint).toBe(
      "take_rest",
    );
  });

  it("parses /commands and @mentions cleanly without intercepting /tirar", () => {
    expect(parseDirectCommand("Hablo con @Mireia")).toBeNull();
    expect(parseDirectCommand("/tirar sigilo 15")).toEqual({
      kind: "unknown",
      commandName: "/tirar",
    });
    expect(parseDirectCommand("/investigar percepcion")).toEqual({
      kind: "investigate",
      skill: "perception",
    });
    expect(parseDirectCommand("/hechizo cure-wounds @Seraphina")).toEqual({
      kind: "spell",
      spellQuery: "cure-wounds",
      targetMention: "Seraphina",
    });
    expect(parseDirectCommand("/descanso largo")).toEqual({
      kind: "rest",
      restType: "long",
    });
    expect(parseDirectCommand("/atacar @Explorador_1")).toEqual({
      kind: "attack",
      targetMention: "Explorador_1",
    });
    expect(parseDirectCommand("/ir escena_03_parlamento")).toEqual({
      kind: "transition",
      sceneQuery: "escena_03_parlamento",
    });
    expect(parseDirectCommand("/mision")).toEqual({ kind: "quest" });
  });

  it("lists mention candidates (PCs + scene NPCs) and resolves @mentions to actor IDs", () => {
    const state = createAguasQuietasInitialState();
    const candidates = getMentionCandidates(state);
    expect(candidates.some((c) => c.id === "pc_kael" && c.handle === "Kael")).toBe(
      true,
    );
    expect(candidates.some((c) => c.handle === "Exploradores")).toBe(true);
    expect(resolveMentionToTargetId("Kael", state)).toBe("pc_kael");
  });
});
