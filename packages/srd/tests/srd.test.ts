import { Condition5eSchema, SkillSchema } from '@dungeons/rules';
import { describe, expect, it } from 'vitest';
import {
  getCondition,
  getMonster,
  listAguasQuietasCreatures,
  listConditions,
  listEquipment,
  listMonsters,
  listSkills,
  listSpells,
  lookupRules,
  resolveSrdConflict,
  SRD_MANIFEST,
} from '../src/index.js';

describe('@dungeons/srd catalog & SRD 5.2.1 precedence', () => {
  it('loads pinned SRD 5.2.1 datasets with expected record counts', () => {
    expect(SRD_MANIFEST.srdVersion).toBe('5.2.1');
    expect(SRD_MANIFEST.license).toBe('CC-BY-4.0');
    expect(listConditions()).toHaveLength(15);
    expect(listSkills()).toHaveLength(18);
    expect(listEquipment().length).toBeGreaterThan(100);
    expect(listSpells().length).toBeGreaterThan(300);
    expect(listMonsters().length).toBeGreaterThan(300);
  });

  it('aligns all 15 conditions and 18 skills with @dungeons/rules schemas and Spanish text', () => {
    for (const cond of listConditions()) {
      expect(Condition5eSchema.safeParse(cond.index).success).toBe(true);
      expect(cond.nameEs.length).toBeGreaterThan(0);
      expect(cond.descriptionEs.length).toBeGreaterThan(0);
      expect(cond.rulesetVersion).toBe('5.2.1');
    }

    for (const skill of listSkills()) {
      expect(SkillSchema.safeParse(skill.ruleSkill).success).toBe(true);
      expect(skill.nameEs.length).toBeGreaterThan(0);
      expect(skill.descriptionEs.length).toBeGreaterThan(0);
      expect(skill.rulesetVersion).toBe('5.2.1');
    }
  });

  it('enforces SRD 5.2.1 precedence over conflicting 5.1 rules', () => {
    const exhaustion = getCondition('exhaustion');
    expect(exhaustion).toBeDefined();
    expect(exhaustion?.mechanicalMeta.d20TestPenaltyPerLevel).toBe(-2);
    expect(exhaustion?.descriptionEs).toContain('-2');

    const conflict = resolveSrdConflict(
      { rule: 'Exhaustion -2 per level (SRD 5.2.1)' },
      { rule: 'Exhaustion disadvantage table (SRD 5.1)' },
    );
    expect(conflict.rulesetVersion).toBe('5.2.1');
    expect(conflict.supersededLegacy51).toBe(true);
    expect(conflict.resolved.rule).toContain('SRD 5.2.1');
  });

  it('supports accent-insensitive Spanish and English lookupQueries', () => {
    const agot = lookupRules({ query: 'agotamiento' });
    expect(agot[0]?.index).toBe('exhaustion');

    const sigilo = lookupRules({ query: 'sigilo', category: 'skill' });
    expect(sigilo[0]?.index).toBe('stealth');

    const necro = lookupRules({ query: 'necrofago', category: 'monster' });
    expect(necro.some((r) => r.index === 'necrofago_de_rio')).toBe(true);

    const curar = lookupRules({ query: 'curar heridas', category: 'spell' });
    expect(curar[0]?.index).toBe('cure-wounds');

    const enExhaustion = lookupRules({ query: 'exhaustion' });
    expect(enExhaustion[0]?.index).toBe('exhaustion');

    const enScout = lookupRules({ query: 'scout', category: 'monster' });
    expect(enScout.some((r) => r.index === 'scout')).toBe(true);

    const enFireball = lookupRules({ query: 'fireball', category: 'spell' });
    expect(enFireball[0]?.index).toBe('fireball');
  });

  it('validates that every Aguas Quietas bestiary entry links to a real SRD 5.2.1 monster', () => {
    const creatures = listAguasQuietasCreatures();
    expect(creatures.length).toBeGreaterThanOrEqual(3);
    for (const c of creatures) {
      const base = getMonster(c.srdBaseIndex);
      expect(base, `Missing SRD base monster: ${c.srdBaseIndex}`).toBeDefined();
      expect(c.rulesetVersion).toBe('5.2.1');
    }
  });
});
