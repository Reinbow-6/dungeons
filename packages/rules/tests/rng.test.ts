import { describe, expect, it } from 'vitest';
import {
  createRng,
  parseDiceExpression,
  rollD20,
  rollDice,
  RulesError,
} from '../src/index.js';

describe('rng & dice expressions', () => {
  it('produces deterministic sequences for identical numeric or string seeds', () => {
    const rngA = createRng('aguas-quietas-seed');
    const rngB = createRng('aguas-quietas-seed');
    const rngC = createRng(42);
    const rngD = createRng(42);

    const seqA = Array.from({ length: 10 }, () => rngA.nextInt(1, 20));
    const seqB = Array.from({ length: 10 }, () => rngB.nextInt(1, 20));
    const seqC = Array.from({ length: 10 }, () => rngC.nextInt(1, 20));
    const seqD = Array.from({ length: 10 }, () => rngD.nextInt(1, 20));

    expect(seqA).toEqual(seqB);
    expect(seqC).toEqual(seqD);
    expect(seqA).not.toEqual(seqC);
  });

  it('parses valid dice expressions and rejects invalid ones', () => {
    expect(parseDiceExpression('2d6+3')).toEqual({
      expression: '2d6+3',
      count: 2,
      sides: 6,
      modifier: 3,
    });
    expect(parseDiceExpression('d20')).toEqual({
      expression: 'd20',
      count: 1,
      sides: 20,
      modifier: 0,
    });
    expect(parseDiceExpression(' 3d8 - 2 ')).toEqual({
      expression: '3d8 - 2',
      count: 3,
      sides: 8,
      modifier: -2,
    });

    expect(() => parseDiceExpression('')).toThrow(RulesError);
    expect(() => parseDiceExpression('0d6')).toThrow(RulesError);
    expect(() => parseDiceExpression('101d6')).toThrow(RulesError);
    expect(() => parseDiceExpression('2d1')).toThrow(RulesError);
    expect(() => parseDiceExpression('abc')).toThrow(RulesError);
  });

  it('rolls dice expressions deterministically with modifiers', () => {
    const rng = createRng(12345);
    const result = rollDice('2d6+3', rng);

    expect(result.rolls).toHaveLength(2);
    for (const r of result.rolls) {
      expect(r).toBeGreaterThanOrEqual(1);
      expect(r).toBeLessThanOrEqual(6);
    }
    const sum = result.rolls.reduce((acc, v) => acc + v, 0);
    expect(result.total).toBe(sum + 3);
  });

  it('handles normal, advantage, disadvantage, natural 20 and natural 1 on d20', () => {
    const normal = rollD20(createRng(1), 'normal');
    expect(normal.rolls).toHaveLength(1);
    expect(normal.chosen).toBe(normal.rolls[0]);

    const adv = rollD20(createRng(7), 'advantage');
    expect(adv.rolls).toHaveLength(2);
    expect(adv.chosen).toBe(Math.max(adv.rolls[0]!, adv.rolls[1]!));

    const dis = rollD20(createRng(7), 'disadvantage');
    expect(dis.rolls).toHaveLength(2);
    expect(dis.chosen).toBe(Math.min(dis.rolls[0]!, dis.rolls[1]!));

    // Find deterministic seeds that produce natural 20 and natural 1 in single roll
    let nat20Seed = 0;
    while (rollD20(createRng(nat20Seed), 'normal').chosen !== 20) {
      nat20Seed += 1;
    }
    const nat20 = rollD20(createRng(nat20Seed), 'normal');
    expect(nat20.isNatural20).toBe(true);
    expect(nat20.isNatural1).toBe(false);

    let nat1Seed = 0;
    while (rollD20(createRng(nat1Seed), 'normal').chosen !== 1) {
      nat1Seed += 1;
    }
    const nat1 = rollD20(createRng(nat1Seed), 'normal');
    expect(nat1.isNatural1).toBe(true);
    expect(nat1.isNatural20).toBe(false);
  });
});
