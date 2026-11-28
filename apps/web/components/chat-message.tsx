"use client";

import type { Character, RulesetProfile } from "@dungeons/rules";
import {
  ChevronDownIcon,
  DicesIcon,
  SparklesIcon,
  UsersIcon,
} from "lucide-react";
import * as React from "react";

import type { SuggestedActionItem } from "@/agent/types";
import {
  DiceRollCard,
  type ResolvedDiceRollToolPart,
  isDiceRollToolPart,
} from "@/components/game/dice-roll-card";
import { SuggestedActions } from "@/components/game/suggested-actions";
import {
  DmToolPartView,
  type TurnOutcomeSummary,
} from "@/components/game/tool-parts";
import { MessageActions } from "@/components/message-actions";
import { AskUserPart } from "@/components/parts/ask-user-part";
import { NarrativeText } from "@/components/parts/narrative-text";
import { ReasoningPart } from "@/components/parts/reasoning-part";
import { SourcesPart } from "@/components/parts/sources-part";
import { Message, MessageContent } from "@/components/ui/message";
import { useSensoryUI } from "@/components/ui/sensory-ui/config/provider";
import { Trace } from "@/components/ui/trace";
import { parsePartyMessage } from "@/lib/game/party-messages";
import type { StreamSpeed } from "@/lib/settings/app-settings";
import { cn } from "@/lib/utils";
import {
  type ChatMessagePart,
  type ChatUIMessage,
  type DmToolPart,
  type SuggestActionsToolPart,
  type TextMessagePart,
} from "@/tools";

type StepPart = Extract<
  ChatMessagePart,
  {
    type:
      | "reasoning"
      | "tool-ask_user"
      | "tool-resolve_check"
      | "tool-resolve_save"
      | "tool-declare_check"
      | "tool-investigate"
      | "tool-transition_scene"
      | "tool-inventory"
      | "tool-rollback_to_event"
      | "tool-lookup_rules"
      | "tool-combat_start"
      | "tool-combat_attack"
      | "tool-combat_next_turn"
      | "tool-combat_end"
      | "tool-apply_condition"
      | "tool-remember_fact"
      | "tool-cast_spell"
      | "tool-take_rest"
      | "tool-death_save"
      | "tool-heal";
  }
>;

function isDmToolPart(part: StepPart): part is DmToolPart {
  return (
    part.type === "tool-resolve_check" ||
    part.type === "tool-resolve_save" ||
    part.type === "tool-declare_check" ||
    part.type === "tool-investigate" ||
    part.type === "tool-transition_scene" ||
    part.type === "tool-inventory" ||
    part.type === "tool-rollback_to_event" ||
    part.type === "tool-lookup_rules" ||
    part.type === "tool-combat_start" ||
    part.type === "tool-combat_attack" ||
    part.type === "tool-combat_next_turn" ||
    part.type === "tool-combat_end" ||
    part.type === "tool-apply_condition" ||
    part.type === "tool-remember_fact" ||
    part.type === "tool-cast_spell" ||
    part.type === "tool-take_rest" ||
    part.type === "tool-death_save" ||
    part.type === "tool-heal"
  );
}

const OUTCOME_TONE_CLASS: Record<TurnOutcomeSummary["tone"], string> = {
  emerald: "text-emerald-600 dark:text-emerald-400",
  rose: "text-rose-600 dark:text-rose-400",
  amber: "text-amber-600 dark:text-amber-300",
  indigo: "text-indigo-600 dark:text-indigo-300",
  neutral: "text-muted-foreground",
};

function CollapsibleEngineTrace({
  block,
  isStreaming,
  reasoningParts,
  message,
  showReasoning = true,
}: {
  block: StepPart[];
  isStreaming: boolean;
  reasoningParts: ChatMessagePart[];
  message: ChatUIMessage;
  showReasoning?: boolean;
}) {
  const { playSound } = useSensoryUI();
  const [expanded, setExpanded] = React.useState(false);

  const filteredBlock = showReasoning
    ? block
    : block.filter((part) => part.type !== "reasoning");

  if (filteredBlock.length === 0) {
    return null;
  }

  const dmParts = filteredBlock.filter(isDmToolPart);
  const highestSeq = dmParts.reduce<number | null>((max, part) => {
    if (part.state !== "output-available") return max;
    const out = part.output as { seq?: number; eventSeq?: number };
    const s = out.seq ?? out.eventSeq;
    if (typeof s === "number" && (max === null || s > max)) {
      return s;
    }
    return max;
  }, null);

  const traceBody = (
    <Trace>
      {filteredBlock.map((part, partIndex) => {
        if (isDmToolPart(part)) {
          return (
            <DmToolPartView
              key={part.toolCallId}
              part={part}
              isStreaming={isStreaming}
            />
          );
        }
        switch (part.type) {
          case "reasoning":
            return (
              <ReasoningPart
                key={partIndex}
                part={part}
                isStreaming={isStreaming}
                duration={
                  message.metadata?.reasoningDurations?.[
                    reasoningParts.indexOf(part)
                  ]
                }
              />
            );
          case "tool-ask_user":
            return <AskUserPart key={part.toolCallId} part={part} />;
        }
      })}
    </Trace>
  );

  // While streaming, keep traces visible in real time; once finished, tuck behind a sleek editorial toggle.
  if (isStreaming) {
    return traceBody;
  }

  return (
    <div className="my-1">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => {
          const next = !expanded;
          playSound(next ? "overlay.expand" : "overlay.collapse");
          setExpanded(next);
        }}
        className="inline-flex min-h-7 items-center gap-1.5 rounded-none border border-border/70 border-l-2 border-l-amber-500/70 bg-card/60 px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-border hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <DicesIcon className="size-3 text-amber-600 dark:text-amber-400/80" />
        <span>
          {dmParts.length > 0
            ? `${dmParts.length} resolución${dmParts.length > 1 ? "es" : ""} del motor`
            : `${filteredBlock.length} paso${filteredBlock.length > 1 ? "s" : ""}`}
        </span>
        {highestSeq !== null && (
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground/80">
            · seq {highestSeq}
          </span>
        )}
        <ChevronDownIcon
          className={cn(
            "size-3 transition-transform",
            expanded && "rotate-180",
          )}
        />
      </button>
      {expanded && (
        <div className="mt-2 rounded-none border border-border border-l-2 border-l-border bg-card/50 p-2.5">
          {traceBody}
        </div>
      )}
    </div>
  );
}

export const ChatMessage = React.memo(function ChatMessage({
  message,
  isStreaming = false,
  streamSpeed = "normal",
  isLastAssistant = false,
  hideSuggestions = false,
  showReasoning = true,
  ttsAvailable = false,
  isSpeaking = false,
  isLoadingAudio = false,
  onSpeak,
  onStopAudio,
  checkpointSeq,
  isRollingBack = false,
  onRollback,
  characterName,
  charactersById,
  activeChar,
  ruleset,
  turnOutcome,
  sceneHeader,
  pcNames = [],
  npcNames = [],
  onSelectSuggestion,
  onRetry,
}: {
  message: ChatUIMessage;
  isStreaming?: boolean;
  streamSpeed?: StreamSpeed;
  isLastAssistant?: boolean;
  hideSuggestions?: boolean;
  showReasoning?: boolean;
  ttsAvailable?: boolean;
  isSpeaking?: boolean;
  isLoadingAudio?: boolean;
  onSpeak?: () => void;
  onStopAudio?: () => void;
  checkpointSeq?: number | null;
  isRollingBack?: boolean;
  onRollback?: (seq: number) => void;
  characterName?: string;
  characterClassName?: string;
  charactersById?: Record<string, Character>;
  activeChar?: Character | null;
  ruleset?: RulesetProfile;
  turnOutcome?: TurnOutcomeSummary | null;
  sceneHeader?: { microLabel: string; title: string } | null;
  pcNames?: readonly string[];
  npcNames?: readonly string[];
  onSelectSuggestion?: (prompt: string) => void;
  onRetry?: () => void;
}) {
  if (message.role === "user") {
    const userText = message.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("");
    const parsedParty = parsePartyMessage(userText);

    if (parsedParty.kind === "round") {
      return (
        <div className="flex justify-end">
          <div className="w-full max-w-[92%] rounded-none border border-border border-l-2 border-l-amber-500/80 bg-amber-500/[0.05] px-3.5 py-3 dark:bg-amber-950/20 sm:max-w-[82%]">
            <div className="mb-2 flex items-center justify-between gap-2 border-b border-border/60 pb-1.5">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-amber-700 uppercase dark:text-amber-300">
                <UsersIcon className="size-3.5" />
                Escena grupal · {parsedParty.entries.length} acciones
              </span>
              {turnOutcome && (
                <span className="flex items-center gap-1 text-[11px] font-medium">
                  <span className="text-muted-foreground">
                    {turnOutcome.skillLabel}
                  </span>
                  <span className="text-muted-foreground/50">·</span>
                  <span className={OUTCOME_TONE_CLASS[turnOutcome.tone]}>
                    {turnOutcome.outcomeLabel}
                  </span>
                </span>
              )}
            </div>
            <ul className="flex flex-col divide-y divide-border/50">
              {parsedParty.entries.map((entry, idx) => {
                const ch = charactersById?.[entry.actorId];
                const speaker = ch?.name ?? entry.actorId;
                return (
                  <li
                    key={`${entry.actorId}-${idx}`}
                    className="py-2 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-xs font-semibold text-amber-700 dark:text-amber-400">
                          {speaker}
                        </span>
                        {ch?.playerName && (
                          <span className="rounded-none border border-border/60 bg-background/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {ch.playerName}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/95">
                        {entry.text}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      );
    }

    const singleChar =
      parsedParty.kind === "single"
        ? charactersById?.[parsedParty.actorId]
        : undefined;
    const displayName = singleChar?.name ?? characterName ?? "Jugador";
    const displayText =
      parsedParty.kind === "single" ? parsedParty.text : parsedParty.text;

    return (
      <div className="flex justify-end">
        <div className="w-full max-w-[88%] rounded-none border border-border border-l-2 border-l-amber-500/80 bg-amber-500/[0.05] px-3.5 py-3 dark:bg-amber-950/20 sm:max-w-[78%]">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-xs font-semibold tracking-tight text-amber-700 dark:text-amber-400">
                  {displayName}
                </span>
                {singleChar?.playerName && (
                  <span className="rounded-none border border-border/60 bg-background/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {singleChar.playerName}
                  </span>
                )}
              </div>
              {turnOutcome && (
                <span className="flex items-center gap-1 text-[11px] font-medium">
                  <span className="text-muted-foreground">
                    {turnOutcome.skillLabel}
                  </span>
                  <span className="text-muted-foreground/50">·</span>
                  <span className={OUTCOME_TONE_CLASS[turnOutcome.tone]}>
                    {turnOutcome.outcomeLabel}
                  </span>
                </span>
              )}
            </div>
            <p className="mt-1 whitespace-pre-wrap text-[13.5px] leading-relaxed text-foreground/95">
              {displayText}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const blocks = groupParts(message.parts);
  const reasoningParts = message.parts.filter(
    (part) => part.type === "reasoning",
  );
  const text = blocks
    .flatMap((block) => (Array.isArray(block) ? [] : block.text))
    .join("\n\n");

  const suggestPart = [...message.parts]
    .reverse()
    .find(
      (part): part is SuggestActionsToolPart =>
        part.type === "tool-suggest_actions" &&
        (part.state === "output-available" || part.state === "input-available"),
    );

  const suggestedActions: SuggestedActionItem[] =
    suggestPart?.state === "output-available"
      ? suggestPart.output.actions
      : suggestPart?.state === "input-available"
        ? (suggestPart.input?.actions ?? [])
        : [];

  const sceneLabelFromSuggest =
    suggestPart?.state === "output-available"
      ? suggestPart.output.sceneLabel
      : suggestPart?.state === "input-available"
        ? suggestPart.input?.sceneLabel
        : undefined;

  const resolvedSceneHeader = sceneHeader
    ? {
        microLabel: sceneLabelFromSuggest ?? sceneHeader.microLabel,
        title: sceneHeader.title,
      }
    : null;

  return (
    <Message align="start" className="w-full">
      <MessageContent className="w-full gap-3">
        {resolvedSceneHeader && (
          <div className="mb-1 border-b border-border pb-3">
            <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              <span className="inline-flex size-5 items-center justify-center rounded-none border border-primary/35 bg-primary/10 text-primary">
                <SparklesIcon className="size-3" />
              </span>
              <span>Director de Juego</span>
            </div>
            <div className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              {resolvedSceneHeader.microLabel}
            </div>
            <h2 className="mt-0.5 font-serif text-xl font-semibold tracking-tight text-foreground">
              {resolvedSceneHeader.title}
            </h2>
          </div>
        )}

        {blocks.map((block, index) => {
          if (Array.isArray(block)) {
            const diceParts = block.filter(
              (part): part is ResolvedDiceRollToolPart =>
                isDiceRollToolPart(part) && part.output?.ok !== false,
            );
            const traceParts = block.filter(
              (part) =>
                !(isDiceRollToolPart(part) && part.output?.ok !== false),
            );
            return (
              <React.Fragment key={index}>
                {diceParts.map((dp) => (
                  <DiceRollCard key={dp.toolCallId} part={dp} />
                ))}
                {traceParts.length > 0 && (
                  <CollapsibleEngineTrace
                    block={traceParts}
                    isStreaming={isStreaming}
                    reasoningParts={reasoningParts}
                    message={message}
                    showReasoning={showReasoning}
                  />
                )}
              </React.Fragment>
            );
          }

          return (
            <NarrativeText
              key={index}
              text={block.text}
              isStreaming={isStreaming}
              streamSpeed={streamSpeed}
              pcNames={pcNames}
              npcNames={npcNames}
            />
          );
        })}

        {isLastAssistant &&
          !isStreaming &&
          !hideSuggestions &&
          suggestedActions.length > 0 &&
          onSelectSuggestion && (
            <SuggestedActions
              actions={suggestedActions}
              disabled={isStreaming}
              activeChar={activeChar}
              ruleset={ruleset}
              onSelect={onSelectSuggestion}
            />
          )}

        {!isStreaming && <SourcesPart parts={message.parts} />}
        {!isStreaming &&
          (Boolean(text) || (checkpointSeq != null && Boolean(onRollback))) && (
            <MessageActions
              text={text}
              onRetry={onRetry}
              ttsAvailable={ttsAvailable && Boolean(text)}
              isSpeaking={isSpeaking}
              isLoadingAudio={isLoadingAudio}
              onSpeak={onSpeak}
              onStopAudio={onStopAudio}
              checkpointSeq={checkpointSeq}
              isRollingBack={isRollingBack}
              onRollback={onRollback}
            />
          )}
      </MessageContent>
    </Message>
  );
});

// Text splits the steps into runs, and each run of steps gets its own Trace.
function groupParts(parts: ChatMessagePart[]) {
  return mergeTextParts(parts).reduce<(TextMessagePart | StepPart[])[]>(
    (blocks, part) => {
      if (part.type === "text") {
        if (part.text.trim()) {
          blocks.push(part);
        }
        return blocks;
      }

      if (!isStepPart(part)) {
        return blocks;
      }

      const last = blocks.at(-1);
      if (Array.isArray(last)) {
        last.push(part);
      } else {
        blocks.push([part]);
      }
      return blocks;
    },
    [],
  );
}

function isStepPart(part: ChatMessagePart): part is StepPart {
  // Pending interactive tools show in sticky cards, not in Trace.
  if (part.type === "tool-ask_user" || part.type === "tool-declare_check") {
    return part.state === "output-available";
  }

  // `suggest_actions` renders as interactive numbered bars below the narrative, never in Trace.
  if (part.type === "tool-suggest_actions") {
    return false;
  }

  return (
    part.type === "reasoning" ||
    part.type === "tool-resolve_check" ||
    part.type === "tool-resolve_save" ||
    part.type === "tool-investigate" ||
    part.type === "tool-transition_scene" ||
    part.type === "tool-inventory" ||
    part.type === "tool-rollback_to_event" ||
    part.type === "tool-lookup_rules" ||
    part.type === "tool-combat_start" ||
    part.type === "tool-combat_attack" ||
    part.type === "tool-combat_next_turn" ||
    part.type === "tool-combat_end" ||
    part.type === "tool-apply_condition" ||
    part.type === "tool-remember_fact" ||
    part.type === "tool-cast_spell" ||
    part.type === "tool-take_rest" ||
    part.type === "tool-death_save" ||
    part.type === "tool-heal"
  );
}

function mergeTextParts(parts: ChatMessagePart[]) {
  return parts
    .filter((part) => part.type !== "source-url")
    .reduce<ChatMessagePart[]>((merged, part) => {
      const last = merged.at(-1);
      if (part.type === "text" && last?.type === "text") {
        merged[merged.length - 1] = { ...part, text: last.text + part.text };
        return merged;
      }
      merged.push(part);
      return merged;
    }, []);
}
