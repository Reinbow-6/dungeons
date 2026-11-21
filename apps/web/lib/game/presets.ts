import {
  AGUAS_QUIETAS_SCENES,
  createDefaultAuthority,
  type Character,
  type GameState,
  type RulesetProfile,
} from "@dungeons/rules";

export type CharacterPresetId = "pc_kael" | "pc_brenna" | "pc_lira";

export interface CharacterPresetInfo {
  id: CharacterPresetId;
  name: string;
  species: string;
  className: string;
  summaryEs: string;
}

export const CHARACTER_PRESETS: CharacterPresetInfo[] = [
  {
    id: "pc_kael",
    name: "Kael de Oakhaven",
    species: "Elfo del Bosque",
    className: "Explorador",
    summaryEs: "Sigilo +5 · Percepción/Investigación +4 · Arco corto",
  },
  {
    id: "pc_brenna",
    name: "Brenna de Piedrafría",
    species: "Enana de las Colinas",
    className: "Guerrera",
    summaryEs: "PG 13 · CA 16 · Atletismo +5 · Supervivencia/Intimidación",
  },
  {
    id: "pc_lira",
    name: "Lira Vael",
    species: "Humana",
    className: "Pícara",
    summaryEs:
      "Engaño/Persuasión +4 · Sigilo/Investigación +5 (genera tensión con exploradores)",
  },
];

export function isPresetId(value: string): value is CharacterPresetId {
  return value === "pc_kael" || value === "pc_brenna" || value === "pc_lira";
}

export function createPresetCharacter(
  presetId: CharacterPresetId,
  mode: "digital" | "hybrid" = "digital",
): Character {
  const authority = createDefaultAuthority(mode);
  const rollAuthority = mode === "hybrid" ? "player-declared" : "engine-rolled";

  if (presetId === "pc_brenna") {
    return {
      id: "pc_brenna",
      name: "Brenna de Piedrafría",
      species: "Enana de las Colinas",
      className: "Guerrera",
      level: 1,
      abilities: {
        str: 16, // +3
        dex: 12, // +1
        con: 16, // +3
        int: 10, // +0
        wis: 12, // +1
        cha: 8, // -1
      },
      skillProficiencies: {
        athletics: "proficient", // +5
        intimidation: "proficient", // +1
        perception: "proficient", // +3
        survival: "proficient", // +3
      },
      savingThrowProficiencies: ["str", "con"],
      hp: { current: 13, max: 13, temp: 0 },
      ac: 16,
      speed: 25,
      conditions: [],
      exhaustionLevel: 0,
      inventory: [
        { itemId: "longsword", name: "Espada larga", quantity: 1 },
        { itemId: "shield", name: "Escudo", quantity: 1 },
        { itemId: "rations", name: "Raciones de viaje", quantity: 3 },
      ],
      spellSlots: {},
      concentratingOn: null,
      authority,
      rollAuthority,
    };
  }

  if (presetId === "pc_lira") {
    return {
      id: "pc_lira",
      name: "Lira Vael",
      species: "Humana",
      className: "Pícara",
      level: 1,
      abilities: {
        str: 8, // -1
        dex: 16, // +3
        con: 12, // +1
        int: 14, // +2
        wis: 12, // +1
        cha: 14, // +2
      },
      skillProficiencies: {
        deception: "proficient", // +4
        insight: "proficient", // +3
        investigation: "expertise", // +6
        persuasion: "proficient", // +4
        stealth: "expertise", // +7
      },
      savingThrowProficiencies: ["dex", "int"],
      hp: { current: 9, max: 9, temp: 0 },
      ac: 13,
      speed: 30,
      conditions: [],
      exhaustionLevel: 0,
      inventory: [
        { itemId: "dagger", name: "Daga", quantity: 2 },
        { itemId: "thieves-tools", name: "Herramientas de ladrón", quantity: 1 },
        { itemId: "rations", name: "Raciones de viaje", quantity: 2 },
      ],
      spellSlots: {},
      concentratingOn: null,
      authority,
      rollAuthority,
    };
  }

  return {
    id: "pc_kael",
    name: "Kael de Oakhaven",
    species: "Elfo del Bosque",
    className: "Explorador",
    level: 1,
    abilities: {
      str: 12, // +1
      dex: 16, // +3
      con: 12, // +1
      int: 14, // +2
      wis: 14, // +2
      cha: 10, // +0
    },
    skillProficiencies: {
      investigation: "proficient", // +4
      perception: "proficient", // +4
      stealth: "proficient", // +5
      survival: "proficient", // +4
    },
    savingThrowProficiencies: ["str", "dex"],
    hp: { current: 11, max: 11, temp: 0 },
    ac: 14,
    speed: 35,
    conditions: [],
    exhaustionLevel: 0,
    inventory: [
      { itemId: "shortbow", name: "Arco corto", quantity: 1 },
      { itemId: "shortsword", name: "Espada corta", quantity: 1 },
      { itemId: "rations", name: "Raciones de viaje", quantity: 3 },
    ],
    spellSlots: {},
    concentratingOn: null,
    authority,
    rollAuthority,
  };
}

export function buildInitialCampaignState(params: {
  campaignId: string;
  sessionId: string;
  presetId: CharacterPresetId;
  mode: "digital" | "hybrid";
  ruleset: RulesetProfile;
}): GameState {
  const character = createPresetCharacter(params.presetId, params.mode);
  return {
    campaignId: params.campaignId,
    sessionId: params.sessionId,
    ruleset: params.ruleset,
    sceneId: "escena_01_orilla",
    lastSeq: 0,
    characters: {
      [character.id]: character,
    },
    flags: {},
    unlockedClues: {},
    scenes: AGUAS_QUIETAS_SCENES,
  };
}
