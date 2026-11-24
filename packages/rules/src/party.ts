import { z } from 'zod';
import {
  applyDelta,
  type GameEvent,
  type GameStateDelta,
} from './events.js';
import type { ResolverContext } from './resolvers.js';
import {
  CharacterSchema,
  createDefaultAuthority,
  VisibilitySchema,
  type Character,
  type GameState,
} from './types.js';

export const MAX_LOCAL_PARTY_SIZE = 4;

export const AddPartyMemberInputSchema = z
  .object({
    character: CharacterSchema,
    visibility: VisibilitySchema.optional(),
  })
  .strict();
export type AddPartyMemberInput = z.infer<typeof AddPartyMemberInputSchema>;

export type PartyMutationErrorCode =
  | 'INVALID_INPUT'
  | 'IN_COMBAT'
  | 'PARTY_FULL'
  | 'DUPLICATE_ACTOR'
  | 'LAST_MEMBER_REQUIRED'
  | 'UNKNOWN_ACTOR';

export type AddPartyMemberResult =
  | {
      ok: true;
      character: Character;
      event: GameEvent;
      nextState: GameState;
    }
  | {
      ok: false;
      code: PartyMutationErrorCode;
      messageEs: string;
    };

export function addPartyMember(
  state: GameState,
  rawInput: unknown,
  ctx: ResolverContext,
): AddPartyMemberResult {
  const parsed = AddPartyMemberInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      messageEs: `Datos inválidos al sumar personaje al grupo: ${parsed.error.issues[0]?.message ?? 'formato incorrecto'}.`,
    };
  }

  if (state.combat?.active) {
    return {
      ok: false,
      code: 'IN_COMBAT',
      messageEs: 'No se puede sumar un personaje mientras hay un combate activo.',
    };
  }

  const currentChars = Object.values(state.characters);
  if (currentChars.length >= MAX_LOCAL_PARTY_SIZE) {
    return {
      ok: false,
      code: 'PARTY_FULL',
      messageEs: `La mesa local admite hasta ${MAX_LOCAL_PARTY_SIZE} personajes activos.`,
    };
  }

  const inputChar = parsed.data.character;
  if (state.characters[inputChar.id]) {
    return {
      ok: false,
      code: 'DUPLICATE_ACTOR',
      messageEs: `${inputChar.name} ya forma parte de este grupo.`,
    };
  }

  const tableMode: 'digital' | 'hybrid' =
    currentChars[0]?.rollAuthority === 'player-declared' ? 'hybrid' : 'digital';
  const aligned: Character = {
    ...inputChar,
    authority: createDefaultAuthority(tableMode),
    rollAuthority: tableMode === 'hybrid' ? 'player-declared' : 'engine-rolled',
  };

  const nextSeq = state.lastSeq + 1;
  const stateDelta: GameStateDelta = {
    charactersAdded: [aligned],
  };

  const event: GameEvent = {
    id: ctx.createId(),
    campaignId: state.campaignId,
    sessionId: state.sessionId,
    seq: nextSeq,
    type: 'PARTY_MEMBER_ADDED',
    source: 'engine',
    visibility: parsed.data.visibility ?? 'public',
    actor: aligned.id,
    checkId: null,
    declaredTotal: null,
    dieResults: null,
    payload: {
      actorId: aligned.id,
      name: aligned.name,
      className: aligned.className,
      playerName: aligned.playerName ?? null,
      sceneId: state.sceneId,
    },
    stateDelta,
    revertedByEventId: null,
    createdAt: ctx.now(),
  };

  const nextState = applyDelta(state, stateDelta, nextSeq);

  return {
    ok: true,
    character: nextState.characters[aligned.id] ?? aligned,
    event,
    nextState,
  };
}

export const RemovePartyMemberInputSchema = z
  .object({
    actorId: z.string().min(1),
    reason: z.string().max(160).optional(),
    visibility: VisibilitySchema.optional(),
  })
  .strict();
export type RemovePartyMemberInput = z.infer<typeof RemovePartyMemberInputSchema>;

export type RemovePartyMemberResult =
  | {
      ok: true;
      removedActorId: string;
      removedName: string;
      event: GameEvent;
      nextState: GameState;
    }
  | {
      ok: false;
      code: PartyMutationErrorCode;
      messageEs: string;
    };

export function removePartyMember(
  state: GameState,
  rawInput: unknown,
  ctx: ResolverContext,
): RemovePartyMemberResult {
  const parsed = RemovePartyMemberInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      messageEs: `Parámetros inválidos al retirar personaje: ${parsed.error.issues[0]?.message ?? 'formato incorrecto'}.`,
    };
  }

  if (state.combat?.active) {
    return {
      ok: false,
      code: 'IN_COMBAT',
      messageEs: 'No se puede retirar un personaje durante un combate activo.',
    };
  }

  const currentChars = Object.values(state.characters);
  if (currentChars.length <= 1) {
    return {
      ok: false,
      code: 'LAST_MEMBER_REQUIRED',
      messageEs: 'Debe quedar al menos 1 personaje activo en la campaña.',
    };
  }

  const existing = state.characters[parsed.data.actorId];
  if (!existing) {
    return {
      ok: false,
      code: 'UNKNOWN_ACTOR',
      messageEs: `No existe el personaje "${parsed.data.actorId}".`,
    };
  }

  const nextSeq = state.lastSeq + 1;
  const stateDelta: GameStateDelta = {
    charactersRemoved: [existing.id],
  };

  const event: GameEvent = {
    id: ctx.createId(),
    campaignId: state.campaignId,
    sessionId: state.sessionId,
    seq: nextSeq,
    type: 'PARTY_MEMBER_REMOVED',
    source: 'engine',
    visibility: parsed.data.visibility ?? 'public',
    actor: existing.id,
    checkId: null,
    declaredTotal: null,
    dieResults: null,
    payload: {
      actorId: existing.id,
      name: existing.name,
      reason: parsed.data.reason ?? null,
      sceneId: state.sceneId,
    },
    stateDelta,
    revertedByEventId: null,
    createdAt: ctx.now(),
  };

  const nextState = applyDelta(state, stateDelta, nextSeq);

  return {
    ok: true,
    removedActorId: existing.id,
    removedName: existing.name,
    event,
    nextState,
  };
}
