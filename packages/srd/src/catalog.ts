import type { Ability, Condition5e, Skill } from '@dungeons/rules';
import { AGUAS_QUIETAS_BESTIARY } from './aguas-quietas-bestiary.js';
import conditionsRaw from './data/5e-SRD-Conditions.json' with { type: 'json' };
import equipmentRaw from './data/5e-SRD-Equipment.json' with { type: 'json' };
import manifestRaw from './data/manifest.json' with { type: 'json' };
import monstersRaw from './data/5e-SRD-Monsters.json' with { type: 'json' };
import skillsRaw from './data/5e-SRD-Skills.json' with { type: 'json' };
import spellsRaw from './data/5e-SRD-Spells.json' with { type: 'json' };
import {
  CONDITION_521_RULES,
  resolveSrdConflict,
  SRD_VERSION,
} from './overrides-521.js';
import {
  SrdManifestSchema,
  type AguasQuietasCreatureStatBlock,
  type SrdCondition,
  type SrdEquipment,
  type SrdLookupResult,
  type SrdManifest,
  type SrdMonster,
  type SrdRuleCategory,
  type SrdSkill,
  type SrdSpell,
} from './schemas.js';
import {
  CONDITION_TRANSLATIONS_ES,
  EQUIPMENT_TRANSLATIONS_ES,
  MONSTER_TRANSLATIONS_ES,
  SKILL_TRANSLATIONS_ES,
  SPELL_TRANSLATIONS_ES,
} from './translations-es.js';

export const SRD_MANIFEST: SrdManifest = SrdManifestSchema.parse(manifestRaw);

function normalizeSearchText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

const CONDITIONS: SrdCondition[] = (
  conditionsRaw as unknown as Array<{
    index: string;
    name: string;
    description: string;
  }>
).map((raw) => {
  const idx = raw.index as Condition5e;
  const tr = CONDITION_TRANSLATIONS_ES[idx];
  const normalized: SrdCondition = {
    index: idx,
    name: raw.name,
    nameEs: tr?.nameEs ?? raw.name,
    description: raw.description,
    descriptionEs: tr?.descriptionEs ?? raw.description,
    rulesetVersion: SRD_VERSION,
    mechanicalMeta: CONDITION_521_RULES[idx] ?? {},
  };
  return resolveSrdConflict(normalized).resolved;
});

const SKILLS: SrdSkill[] = (
  skillsRaw as unknown as Array<{
    index: string;
    name: string;
    description: string;
    ability_score: { index: string };
  }>
).map((raw) => {
  const tr = SKILL_TRANSLATIONS_ES[raw.index];
  const ruleSkill = raw.index.replace(/-/g, '_') as Skill;
  return {
    index: raw.index,
    ruleSkill,
    name: raw.name,
    nameEs: tr?.nameEs ?? raw.name,
    ability: raw.ability_score.index as Ability,
    description: raw.description,
    descriptionEs: tr?.descriptionEs ?? raw.description,
    rulesetVersion: SRD_VERSION,
  };
});

interface RawEquipment {
  index: string;
  name: string;
  equipment_categories?: Array<{ name: string }>;
  cost?: { quantity: number; unit: string };
  weight?: number;
  damage?: { damage_dice?: string; damage_type?: { index?: string } };
  armor_class?: { base?: number };
  description?: string;
}

const EQUIPMENT: SrdEquipment[] = (equipmentRaw as unknown as RawEquipment[]).map(
  (raw) => {
  const tr = EQUIPMENT_TRANSLATIONS_ES[raw.index];
  const categories = (raw.equipment_categories ?? []).map((c) => c.name);
  const costText = raw.cost ? `${raw.cost.quantity} ${raw.cost.unit}` : null;
  const fallbackDesc =
    raw.description ??
    [
      categories.join(', '),
      raw.damage?.damage_dice
        ? `Damage: ${raw.damage.damage_dice} ${raw.damage.damage_type?.index ?? ''}`.trim()
        : null,
      raw.armor_class?.base !== undefined
        ? `Base AC: ${raw.armor_class.base}`
        : null,
      costText ? `Cost: ${costText}` : null,
    ]
      .filter(Boolean)
      .join(' · ');

  return {
    index: raw.index,
    name: raw.name,
    nameEs: tr?.nameEs ?? raw.name,
    categories,
    costText,
    weight: typeof raw.weight === 'number' ? raw.weight : null,
    damageDice: raw.damage?.damage_dice ?? null,
    damageType: raw.damage?.damage_type?.index ?? null,
    armorClassBase: raw.armor_class?.base ?? null,
    description: fallbackDesc,
    descriptionEs: tr?.descriptionEs ?? fallbackDesc,
    rulesetVersion: SRD_VERSION,
  };
});

interface RawSpell {
  index: string;
  name: string;
  level: number;
  school?: { name?: string };
  classes?: Array<{ index?: string; name?: string }>;
  casting_time?: string;
  ritual?: boolean;
  range?: string;
  components?: string[];
  duration?: string;
  concentration?: boolean;
  attack_type?: string;
  damage?: {
    damage_type?: { index?: string };
    damage_at_slot_level?: Record<string, string>;
  };
  description: string;
}

const SPELLS: SrdSpell[] = (spellsRaw as unknown as RawSpell[]).map((raw) => {
  const tr = SPELL_TRANSLATIONS_ES[raw.index];
  const attackType =
    raw.attack_type === 'melee' || raw.attack_type === 'ranged'
      ? raw.attack_type
      : null;
  return {
    index: raw.index,
    name: raw.name,
    nameEs: tr?.nameEs ?? raw.name,
    level: raw.level,
    school: raw.school?.name ?? 'Unknown',
    classes: (raw.classes ?? [])
      .map((c) => c.index ?? c.name?.toLowerCase() ?? '')
      .filter(Boolean),
    castingTime: raw.casting_time ?? 'Action',
    ritual: Boolean(raw.ritual),
    range: raw.range ?? 'Self',
    components: raw.components ?? [],
    duration: raw.duration ?? 'Instantaneous',
    concentration: Boolean(raw.concentration),
    attackType,
    damageType: raw.damage?.damage_type?.index ?? null,
    damageAtSlotLevel: raw.damage?.damage_at_slot_level ?? null,
    description: raw.description,
    descriptionEs: tr?.descriptionEs ?? raw.description,
    rulesetVersion: SRD_VERSION,
  };
});

interface RawMonster {
  index: string;
  name: string;
  size: string;
  type: string;
  alignment: string;
  armor_class?: Array<{ value: number }>;
  hit_points: number;
  hit_dice: string;
  challenge_rating: number;
  xp?: number;
  speed?: Record<string, string | boolean | undefined>;
  strength: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
  damage_vulnerabilities?: string[];
  damage_resistances?: string[];
  damage_immunities?: string[];
  condition_immunities?: Array<{ index?: string; name?: string }>;
}

const MONSTERS: SrdMonster[] = (monstersRaw as unknown as RawMonster[]).map(
  (raw) => {
    const tr = MONSTER_TRANSLATIONS_ES[raw.index];
    const speedText = Object.entries(raw.speed ?? {})
      .filter(([, v]) => typeof v === 'string')
      .map(([k, v]) => `${k} ${v}`)
      .join(', ');

  return {
    index: raw.index,
    name: raw.name,
    nameEs: tr?.nameEs ?? raw.name,
    size: raw.size,
    type: raw.type,
    alignment: raw.alignment,
    ac: raw.armor_class?.[0]?.value ?? 10,
    hp: raw.hit_points,
    hitDice: raw.hit_dice,
    challengeRating: raw.challenge_rating,
    xp: raw.xp ?? 0,
    speedText,
    abilities: {
      str: raw.strength,
      dex: raw.dexterity,
      con: raw.constitution,
      int: raw.intelligence,
      wis: raw.wisdom,
      cha: raw.charisma,
    },
    damageVulnerabilities: raw.damage_vulnerabilities ?? [],
    damageResistances: raw.damage_resistances ?? [],
    damageImmunities: raw.damage_immunities ?? [],
    conditionImmunities: (raw.condition_immunities ?? []).map(
      (c) => c.index ?? c.name ?? '',
    ),
    rulesetVersion: SRD_VERSION,
  };
});

const CONDITIONS_BY_INDEX = new Map(CONDITIONS.map((c) => [c.index, c]));
const SKILLS_BY_INDEX = new Map(SKILLS.map((s) => [s.index, s]));
const EQUIPMENT_BY_INDEX = new Map(EQUIPMENT.map((e) => [e.index, e]));
const SPELLS_BY_INDEX = new Map(SPELLS.map((s) => [s.index, s]));
const MONSTERS_BY_INDEX = new Map(MONSTERS.map((m) => [m.index, m]));

export function listConditions(): readonly SrdCondition[] {
  return CONDITIONS;
}

export function getCondition(index: string): SrdCondition | undefined {
  return CONDITIONS_BY_INDEX.get(index as Condition5e);
}

export function listSkills(): readonly SrdSkill[] {
  return SKILLS;
}

export function getSkill(index: string): SrdSkill | undefined {
  const normalized = index.replace(/_/g, '-');
  return SKILLS_BY_INDEX.get(normalized);
}

export function listEquipment(): readonly SrdEquipment[] {
  return EQUIPMENT;
}

export function getEquipment(index: string): SrdEquipment | undefined {
  return EQUIPMENT_BY_INDEX.get(index);
}

export function listSpells(): readonly SrdSpell[] {
  return SPELLS;
}

export function getSpell(index: string): SrdSpell | undefined {
  return SPELLS_BY_INDEX.get(index);
}

export function listMonsters(): readonly SrdMonster[] {
  return MONSTERS;
}

export function getMonster(index: string): SrdMonster | undefined {
  return MONSTERS_BY_INDEX.get(index);
}

export function listAguasQuietasCreatures(): readonly AguasQuietasCreatureStatBlock[] {
  return AGUAS_QUIETAS_BESTIARY;
}

export function getAguasQuietasCreature(
  id: string,
): AguasQuietasCreatureStatBlock | undefined {
  return AGUAS_QUIETAS_BESTIARY.find((c) => c.id === id);
}

export interface LookupRulesInput {
  query: string;
  category?: SrdRuleCategory;
  limit?: number;
}

function scoreMatch(
  q: string,
  index: string,
  name: string,
  nameEs: string,
  extra = '',
): number {
  const nIdx = normalizeSearchText(index);
  const nName = normalizeSearchText(name);
  const nEs = normalizeSearchText(nameEs);
  const nExtra = normalizeSearchText(extra);

  if (nIdx === q || nName === q || nEs === q) return 100;
  if (nEs.startsWith(q) || nName.startsWith(q) || nIdx.startsWith(q)) return 80;
  if (nEs.includes(q) || nName.includes(q) || nIdx.includes(q)) return 60;
  if (nExtra.includes(q)) return 25;
  return 0;
}

/**
 * Accent-insensitive Spanish + English lookup across SRD 5.2.1 rules
 * and Aguas Quietas bestiary creatures.
 */
export function lookupRules(input: LookupRulesInput): SrdLookupResult[] {
  const q = normalizeSearchText(input.query);
  if (!q) return [];
  const limit = Math.max(1, Math.min(50, input.limit ?? 10));

  const scored: Array<{ score: number; item: SrdLookupResult }> = [];
  const allow = (cat: SrdRuleCategory) =>
    !input.category || input.category === cat;

  if (allow('condition')) {
    for (const c of CONDITIONS) {
      const score = scoreMatch(q, c.index, c.name, c.nameEs, c.descriptionEs);
      if (score > 0) {
        scored.push({
          score,
          item: {
            category: 'condition',
            index: c.index,
            name: c.name,
            nameEs: c.nameEs,
            summaryEs: c.descriptionEs,
            rulesetVersion: SRD_VERSION,
          },
        });
      }
    }
  }

  if (allow('skill')) {
    for (const s of SKILLS) {
      const score = scoreMatch(q, s.index, s.name, s.nameEs, s.descriptionEs);
      if (score > 0) {
        scored.push({
          score,
          item: {
            category: 'skill',
            index: s.index,
            name: s.name,
            nameEs: s.nameEs,
            summaryEs: `${s.ability.toUpperCase()} — ${s.descriptionEs}`,
            rulesetVersion: SRD_VERSION,
          },
        });
      }
    }
  }

  if (allow('equipment')) {
    for (const e of EQUIPMENT) {
      const score = scoreMatch(q, e.index, e.name, e.nameEs, e.descriptionEs);
      if (score > 0) {
        scored.push({
          score,
          item: {
            category: 'equipment',
            index: e.index,
            name: e.name,
            nameEs: e.nameEs,
            summaryEs: e.descriptionEs,
            rulesetVersion: SRD_VERSION,
          },
        });
      }
    }
  }

  if (allow('spell')) {
    for (const sp of SPELLS) {
      const score = scoreMatch(
        q,
        sp.index,
        sp.name,
        sp.nameEs,
        sp.descriptionEs,
      );
      if (score > 0) {
        scored.push({
          score,
          item: {
            category: 'spell',
            index: sp.index,
            name: sp.name,
            nameEs: sp.nameEs,
            summaryEs: `Nivel ${sp.level} · ${sp.castingTime} · ${sp.descriptionEs}`,
            rulesetVersion: SRD_VERSION,
          },
        });
      }
    }
  }

  if (allow('monster')) {
    for (const creature of AGUAS_QUIETAS_BESTIARY) {
      const score = scoreMatch(
        q,
        creature.id,
        creature.srdBaseIndex,
        creature.nameEs,
        creature.traitsEs.join(' '),
      );
      if (score > 0) {
        scored.push({
          score: score + 5, // Prefer campaign bestiary entries on exact match
          item: {
            category: 'monster',
            index: creature.id,
            name: creature.srdBaseIndex,
            nameEs: creature.nameEs,
            summaryEs: `CR ${creature.cr} · CA ${creature.ac} · PG ${creature.hp} · ${creature.speedTextEs}`,
            rulesetVersion: SRD_VERSION,
          },
        });
      }
    }

    for (const m of MONSTERS) {
      const score = scoreMatch(q, m.index, m.name, m.nameEs, m.type);
      if (score > 0) {
        scored.push({
          score,
          item: {
            category: 'monster',
            index: m.index,
            name: m.name,
            nameEs: m.nameEs,
            summaryEs: `CR ${m.challengeRating} · CA ${m.ac} · PG ${m.hp} (${m.hitDice})`,
            rulesetVersion: SRD_VERSION,
          },
        });
      }
    }
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.item);
}
