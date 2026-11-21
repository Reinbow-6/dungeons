"use client";

import {
  ChevronDownIcon,
  DicesIcon,
  FlameIcon,
  ShieldIcon,
  SparklesIcon,
  SwordsIcon,
  Wand2Icon,
} from "lucide-react";
import * as React from "react";

import type { SuggestedActionItem } from "@/agent/types";
import { SuggestedActions } from "@/components/game/suggested-actions";
import {
  DmToolPartView,
  type TurnOutcomeSummary,
} from "@/components/game/tool-parts";
import { MessageActions } from "@/components/message-actions";
import { AskUserPart } from "@/components/parts/ask-user-part";
import { GithubRepoPart } from "@/components/parts/github-repo-part";
import { NarrativeText } from "@/components/parts/narrative-text";
import { ReasoningPart } from "@/components/parts/reasoning-part";
import { SourcesPart } from "@/components/parts/sources-part";
import { WebSearchPart } from "@/components/parts/web-search-part";
import { Message, MessageContent } from "@/components/ui/message";
import { Trace } from "@/components/ui/trace";
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
      | "tool-github_repo"
      | "tool-ask_user"
      | "tool-web_search"
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

function CharacterEmblem({
  classNameLabel,
  characterName,
}: {
  classNameLabel?: string;
  characterName?: string;
}) {
  const cls = (classNameLabel ?? "").toLowerCase();
  if (cls.includes("mag")) {
    return (
      <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-sky-500/30 bg-gradient-to-br from-sky-500/20 to-indigo-950/60 text-sky-400">
        <Wand2Icon className="size-4" />
      </span>
    );
  }
  if (cls.includes("clér") || cls.includes("cler")) {
    return (
      <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-amber-400/35 bg-gradient-to-br from-amber-500/25 to-orange-950/60 text-amber-300">
        <SparklesIcon className="size-4" />
      </span>
    );
  }
  if (cls.includes("guerr")) {
    return (
      <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-rose-500/30 bg-gradient-to-br from-rose-500/20 to-stone-950/60 text-rose-300">
        <ShieldIcon className="size-4" />
      </span>
    );
  }
  if (cls.includes("píc") || cls.includes("pic")) {
    return (
      <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-violet-500/30 bg-gradient-to-br from-violet-500/20 to-slate-950/60 text-violet-300">
        <SwordsIcon className="size-4" />
      </span>
    );
  }
  const initial = (characterName ?? "J").slice(0, 1).toUpperCase();
  return (
    <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-amber-500/30 bg-gradient-to-br from-amber-600/20 to-emerald-950/50 font-serif text-sm font-semibold text-amber-300">
      {initial || <FlameIcon className="size-4" />}
    </span>
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
}: {
  block: StepPart[];
  isStreaming: boolean;
  reasoningParts: ChatMessagePart[];
  message: ChatUIMessage;
}) {
  const [expanded, setExpanded] = React.useState(false);

  const dmParts = block.filter(isDmToolPart);
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
      {block.map((part, partIndex) => {
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
          case "tool-github_repo":
            return (
              <GithubRepoPart
                key={part.toolCallId}
                part={part}
                isStreaming={isStreaming}
              />
            );
          case "tool-ask_user":
            return <AskUserPart key={part.toolCallId} part={part} />;
          case "tool-web_search":
            return (
              <WebSearchPart
                key={part.toolCallId}
                part={part}
                isStreaming={isStreaming}
              />
            );
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
        onClick={() => setExpanded((prev) => !prev)}
        className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/60 px-2.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-border hover:text-foreground"
      >
        <DicesIcon className="size-3 text-amber-600 dark:text-amber-400/80" />
        <span>
          {dmParts.length > 0
            ? `${dmParts.length} resolución${dmParts.length > 1 ? "es" : ""} del motor`
            : `${block.length} paso${block.length > 1 ? "s" : ""}`}
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
        <div className="mt-2 rounded-xl border border-border/60 bg-card/50 p-2.5">
          {traceBody}
        </div>
      )}
    </div>
  );
}

export function ChatMessage({
  message,
  isStreaming = false,
  isLastAssistant = false,
  hideSuggestions = false,
  characterName,
  characterClassName,
  turnOutcome,
  sceneHeader,
  pcNames = [],
  npcNames = [],
  onSelectSuggestion,
  onRetry,
}: {
  message: ChatUIMessage;
  isStreaming?: boolean;
  isLastAssistant?: boolean;
  hideSuggestions?: boolean;
  characterName?: string;
  characterClassName?: string;
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

    return (
      <div className="flex justify-end">
        <div className="w-full max-w-[88%] rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-3.5 py-3 shadow-xs dark:border-amber-700/35 dark:bg-[#1a120d]/80 sm:max-w-[78%]">
          <div className="flex items-start gap-3">
            <CharacterEmblem
              characterName={characterName}
              classNameLabel={characterClassName}
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="truncate text-xs font-semibold tracking-tight text-amber-700 dark:text-amber-400">
                  {characterName ?? "Jugador"}
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
              <p className="mt-1 whitespace-pre-wrap text-[13.5px] leading-relaxed text-foreground/95">
                {userText}
              </p>
            </div>
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
          <div className="mb-1 border-b border-border/50 pb-2.5">
            <div className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              {resolvedSceneHeader.microLabel}
            </div>
            <h2 className="mt-0.5 font-serif text-xl font-semibold tracking-tight text-foreground">
              {resolvedSceneHeader.title}
            </h2>
          </div>
        )}

        {blocks.map((block, index) =>
          Array.isArray(block) ? (
            <CollapsibleEngineTrace
              key={index}
              block={block}
              isStreaming={isStreaming}
              reasoningParts={reasoningParts}
              message={message}
            />
          ) : (
            <NarrativeText
              key={index}
              text={block.text}
              pcNames={pcNames}
              npcNames={npcNames}
            />
          ),
        )}

        {isLastAssistant &&
          !isStreaming &&
          !hideSuggestions &&
          suggestedActions.length > 0 &&
          onSelectSuggestion && (
            <SuggestedActions
              actions={suggestedActions}
              disabled={isStreaming}
              onSelect={onSelectSuggestion}
            />
          )}

        {!isStreaming && <SourcesPart parts={message.parts} />}
        {!isStreaming && text && (
          <MessageActions text={text} onRetry={onRetry} />
        )}
      </MessageContent>
    </Message>
  );
}

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
    part.type === "tool-github_repo" ||
    part.type === "tool-web_search" ||
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
