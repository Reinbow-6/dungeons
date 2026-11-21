import { z } from 'zod';

export class RulesError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'RulesError';
    this.code = code;
  }
}

export interface Rng {
  /** Returns a pseudo-random float in [0, 1). */
  next(): number;
  /** Returns a pseudo-random integer in [min, max] inclusive. */
  nextInt(min: number, max: number): number;
}

function hashSeed(seed: number | string): number {
  if (typeof seed === 'number') {
    if (!Number.isFinite(seed)) {
      throw new RulesError('INVALID_SEED', 'La semilla numérica del RNG debe ser finita.');
    }
    return seed >>> 0;
  }

  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Creates a deterministic Mulberry32 PRNG seeded by a number or string.
 */
export function createRng(seed: number | string): Rng {
  let state = hashSeed(seed);

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const nextInt = (min: number, max: number): number => {
    if (!Number.isInteger(min) || !Number.isInteger(max) || min > max) {
      throw new RulesError(
        'INVALID_RANGE',
        `Rango inválido para nextInt: [${min}, ${max}].`,
      );
    }
    return min + Math.floor(next() * (max - min + 1));
  };

  return { next, nextInt };
}

export const RollModeSchema = z.enum(['normal', 'advantage', 'disadvantage']);
export type RollMode = z.infer<typeof RollModeSchema>;

export interface ParsedDiceExpression {
  expression: string;
  count: number;
  sides: number;
  modifier: number;
}

const DICE_EXPR_REGEX = /^\s*(\d*)\s*d\s*(\d+)\s*(?:([+-])\s*(\d+))?\s*$/i;

export function parseDiceExpression(expr: string): ParsedDiceExpression {
  const match = DICE_EXPR_REGEX.exec(expr);
  if (!match) {
    throw new RulesError(
      'INVALID_DICE_EXPRESSION',
      `Expresión de dados inválida: "${expr}". Formato esperado: NdM(+/-K).`,
    );
  }

  const rawCount = match[1];
  const rawSides = match[2];
  const sign = match[3];
  const rawMod = match[4];

  const count = rawCount && rawCount.length > 0 ? Number.parseInt(rawCount, 10) : 1;
  const sides = Number.parseInt(rawSides ?? '', 10);
  const absMod = rawMod ? Number.parseInt(rawMod, 10) : 0;
  const modifier = sign === '-' ? -absMod : absMod;

  if (!Number.isInteger(count) || count < 1 || count > 100) {
    throw new RulesError(
      'INVALID_DICE_EXPRESSION',
      `Cantidad de dados fuera de rango (1..100): ${count}.`,
    );
  }

  if (!Number.isInteger(sides) || sides < 2 || sides > 1000) {
    throw new RulesError(
      'INVALID_DICE_EXPRESSION',
      `Caras de dado fuera de rango (2..1000): ${sides}.`,
    );
  }

  return {
    expression: expr.trim(),
    count,
    sides,
    modifier,
  };
}

export interface DiceRollResult {
  expression: string;
  count: number;
  sides: number;
  modifier: number;
  rolls: number[];
  total: number;
}

export function rollDice(expr: string, rng: Rng): DiceRollResult {
  const parsed = parseDiceExpression(expr);
  const rolls: number[] = [];
  let sum = 0;

  for (let i = 0; i < parsed.count; i += 1) {
    const roll = rng.nextInt(1, parsed.sides);
    rolls.push(roll);
    sum += roll;
  }

  return {
    ...parsed,
    rolls,
    total: sum + parsed.modifier,
  };
}

export interface D20RollResult {
  mode: RollMode;
  rolls: number[];
  chosen: number;
  isNatural20: boolean;
  isNatural1: boolean;
}

export function rollD20(rng: Rng, mode: RollMode = 'normal'): D20RollResult {
  if (mode === 'normal') {
    const first = rng.nextInt(1, 20);
    return {
      mode,
      rolls: [first],
      chosen: first,
      isNatural20: first === 20,
      isNatural1: first === 1,
    };
  }

  const first = rng.nextInt(1, 20);
  const second = rng.nextInt(1, 20);
  const chosen = mode === 'advantage' ? Math.max(first, second) : Math.min(first, second);

  return {
    mode,
    rolls: [first, second],
    chosen,
    isNatural20: chosen === 20,
    isNatural1: chosen === 1,
  };
}
