import { describe, expect, it } from 'vitest';
import {
  combineRollMode,
  createAguasQuietasInitialState,
  getAbilityModifier,
  getCheckModifier,
  getProficiencyBonus,
  getSavingThrowModifier,
} from '../src/index.js';

describe('5e modifiers & SRD 5.2.1 conditions', () => {
  it('computes 5e ability modifiers and proficiency bonus across levels 1-20', () => {
    expect(getAbilityModifier(8)).toBe(-1);
    expect(getAbilityModifier(10)).toBe(0);
    expect(getAbilityModifier(15)).toBe(2);
    expect(getAbilityModifier(20)).toBe(5);

    expect(getProficiencyBonus(1)).toBe(2);
    expect(getProficiencyBonus(4)).toBe(2);
    expect(getProficiencyBonus(5)).toBe(3);
    expect(getProficiencyBonus(9)).toBe(4);
    expect(getProficiencyBonus(13)).toBe(5);
    expect(getProficiencyBonus(17)).toBe(6);
    expect(getProficiencyBonus(20)).toBe(6);
  });

  it('computes proficient and expertise skill modifiers', () => {
    const state = createAguasQuietasInitialState();
    const kael = state.characters.pc_kael!;

    const inv = getCheckModifier(kael, 'investigation', '5e-lite');
    expect(inv).toEqual({
      ability: 'int',
      abilityMod: 2,
      proficiencyMod: 2,
      conditionMod: 0,
      totalMod: 4,
      imposesDisadvantage: false,
    });

    kael.skillProficiencies.perception = 'expertise';
    const perc = getCheckModifier(kael, 'perception', '5e-full');
    expect(perc.proficiencyMod).toBe(4);
    expect(perc.totalMod).toBe(6);

    const dexSave = getSavingThrowModifier(kael, 'dex', '5e-lite');
    expect(dexSave.totalMod).toBe(5); // +3 dex +2 pb
    const wisSave = getSavingThrowModifier(kael, 'wis', '5e-lite');
    expect(wisSave.totalMod).toBe(2); // +2 wis +0
  });

  it('applies poisoned disadvantage with advantage/disadvantage cancellation', () => {
    const state = createAguasQuietasInitialState();
    const kael = state.characters.pc_kael!;
    kael.conditions.push('poisoned');

    const mod = getCheckModifier(kael, 'stealth', '5e-lite');
    expect(mod.imposesDisadvantage).toBe(true);
    expect(combineRollMode('normal', mod.imposesDisadvantage)).toBe('disadvantage');
    expect(combineRollMode('advantage', mod.imposesDisadvantage)).toBe('normal');
  });

  it('applies SRD 5.2.1 exhaustion penalty (-2 per level to D20 Tests)', () => {
    const state = createAguasQuietasInitialState();
    const kael = state.characters.pc_kael!;
    kael.conditions.push('exhaustion');
    kael.exhaustionLevel = 2;

    const mod = getCheckModifier(kael, 'investigation', '5e-lite');
    expect(mod.conditionMod).toBe(-4);
    expect(mod.totalMod).toBe(0); // +2 int +2 pb -4 exhaustion

    const save = getSavingThrowModifier(kael, 'dex', '5e-full');
    expect(save.conditionMod).toBe(-4);
    expect(save.totalMod).toBe(1); // +3 dex +2 pb -4 exhaustion
  });
});
