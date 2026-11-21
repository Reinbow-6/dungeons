import {
  AGUAS_QUIETAS_SCENES,
  createDefaultAuthority,
  type Character,
  type GameState,
  type RulesetProfile,
} from "@dungeons/rules";

export type CharacterPresetId =
  | "pc_kael"
  | "pc_brenna"
  | "pc_lira"
  | "pc_seraphina"
  | "pc_theron";

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
  {
    id: "pc_seraphina",
    name: "Seraphina Voss",
    species: "Humana",
    className: "Clériga",
    summaryEs:
      "CA 16 · Magia divina (SAB CD 13, +5) · Saeta guía, Curar heridas, Bendición",
  },
  {
    id: "pc_theron",
    name: "Theron Ashveil",
    species: "Alto Elfo",
    className: "Mago",
    summaryEs:
      "Magia arcana (INT CD 13, +5) · Descarga de fuego, Proyectil mágico, Escudo",
  },
];

export function isPresetId(value: string): value is CharacterPresetId {
  return (
    value === "pc_kael" ||
    value === "pc_brenna" ||
    value === "pc_lira" ||
    value === "pc_seraphina" ||
    value === "pc_theron"
  );
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
        { itemId: "potion-of-healing", name: "Poción de curación", quantity: 1 },
        { itemId: "rations", name: "Raciones de viaje", quantity: 3 },
      ],
      spellSlots: {},
      hitDice: { die: "d10", current: 1, max: 1 },
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
        { itemId: "potion-of-healing", name: "Poción de curación", quantity: 1 },
        { itemId: "rations", name: "Raciones de viaje", quantity: 2 },
      ],
      spellSlots: {},
      hitDice: { die: "d8", current: 1, max: 1 },
      concentratingOn: null,
      authority,
      rollAuthority,
    };
  }

  if (presetId === "pc_seraphina") {
    return {
      id: "pc_seraphina",
      name: "Seraphina Voss",
      species: "Humana",
      className: "Clériga",
      level: 1,
      abilities: {
        str: 12, // +1
        dex: 10, // +0
        con: 14, // +2
        int: 10, // +0
        wis: 16, // +3
        cha: 14, // +2
      },
      skillProficiencies: {
        insight: "proficient", // +5
        medicine: "proficient", // +5
        persuasion: "proficient", // +4
        religion: "proficient", // +2
      },
      savingThrowProficiencies: ["wis", "cha"],
      hp: { current: 10, max: 10, temp: 0 },
      ac: 16,
      speed: 30,
      conditions: [],
      exhaustionLevel: 0,
      inventory: [
        { itemId: "mace", name: "Maza", quantity: 1 },
        { itemId: "shield", name: "Escudo", quantity: 1 },
        { itemId: "potion-of-healing", name: "Poción de curación", quantity: 1 },
        { itemId: "rations", name: "Raciones de viaje", quantity: 3 },
      ],
      spellSlots: {
        "1": { current: 2, max: 2 },
      },
      spellcastingAbility: "wis",
      knownSpells: [
        "sacred-flame",
        "guidance",
        "guiding-bolt",
        "cure-wounds",
        "healing-word",
        "bless",
        "shield-of-faith",
      ],
      hitDice: { die: "d8", current: 1, max: 1 },
      concentratingOn: null,
      authority,
      rollAuthority,
    };
  }

  if (presetId === "pc_theron") {
    return {
      id: "pc_theron",
      name: "Theron Ashveil",
      species: "Alto Elfo",
      className: "Mago",
      level: 1,
      abilities: {
        str: 8, // -1
        dex: 14, // +2
        con: 14, // +2
        int: 16, // +3
        wis: 12, // +1
        cha: 10, // +0
      },
      skillProficiencies: {
        arcana: "proficient", // +5
        history: "proficient", // +5
        investigation: "proficient", // +5
        perception: "proficient", // +3
      },
      savingThrowProficiencies: ["int", "wis"],
      hp: { current: 8, max: 8, temp: 0 },
      ac: 12,
      speed: 30,
      conditions: [],
      exhaustionLevel: 0,
      inventory: [
        { itemId: "quarterstaff", name: "Bastón arcano", quantity: 1 },
        { itemId: "dagger", name: "Daga", quantity: 1 },
        { itemId: "potion-of-healing", name: "Poción de curación", quantity: 1 },
        { itemId: "rations", name: "Raciones de viaje", quantity: 2 },
      ],
      spellSlots: {
        "1": { current: 2, max: 2 },
      },
      spellcastingAbility: "int",
      knownSpells: [
        "fire-bolt",
        "ray-of-frost",
        "magic-missile",
        "burning-hands",
        "shield",
        "sleep",
      ],
      hitDice: { die: "d6", current: 1, max: 1 },
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
      { itemId: "potion-of-healing", name: "Poción de curación", quantity: 1 },
      { itemId: "rations", name: "Raciones de viaje", quantity: 3 },
    ],
    spellSlots: {},
    hitDice: { die: "d10", current: 1, max: 1 },
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
