"use client";

import { CpuIcon } from "lucide-react";
import * as React from "react";

import type { ContextUsageMetadata } from "@/agent/types";
import { usePlaySound } from "@/components/ui/sensory-ui/config/use-play-sound";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ChatUIMessage } from "@/tools";

const ACTIVE_WINDOW_TOKEN_BUDGET = 8_000;
const DEFAULT_MAX_WINDOW_MESSAGES = 16;
const BASE_SYSTEM_PROMPT_TOKENS_EST = 1_150;

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}k`;
  }
  return String(tokens);
}

function estimateCharsFromMessages(messages: readonly ChatUIMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    total += 24;
    for (const part of msg.parts) {
      if (part.type === "text" && typeof part.text === "string") {
        total += part.text.length;
      } else if (part.type === "reasoning" && typeof part.text === "string") {
        total += Math.min(300, part.text.length);
      } else {
        total += 160;
      }
    }
  }
  return total;
}

export function ContextMeter({
  messages,
  isBusy = false,
}: {
  messages: readonly ChatUIMessage[];
  isBusy?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const { play } = usePlaySound({ sound: "interaction.subtle" });
  const latestUsage = React.useMemo<ContextUsageMetadata | null>(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const msg = messages[i];
      if (msg?.role === "assistant" && msg.metadata?.contextUsage) {
        return msg.metadata.contextUsage;
      }
    }
    return null;
  }, [messages]);

  const metrics = React.useMemo(() => {
    if (latestUsage && messages.at(-1)?.role === "assistant") {
      return latestUsage;
    }

    // If a new user turn was just appended (or no metadata yet), estimate live window
    const maxWindowMessages =
      latestUsage?.maxWindowMessages ?? DEFAULT_MAX_WINDOW_MESSAGES;
    const recentSlice = messages.slice(-maxWindowMessages);
    const trimmedMessages = Math.max(0, messages.length - recentSlice.length);
    const systemPromptTokensEst =
      latestUsage?.systemPromptTokensEst ?? BASE_SYSTEM_PROMPT_TOKENS_EST;
    const recentTokensEst = Math.ceil(
      estimateCharsFromMessages(recentSlice) / 4,
    );

    return {
      contextTokens:
        messages.length === 0
          ? 0
          : systemPromptTokensEst + recentTokensEst,
      outputTokens: latestUsage?.outputTokens ?? 0,
      totalTurnTokens: latestUsage?.totalTurnTokens ?? 0,
      windowMessages: recentSlice.length,
      maxWindowMessages,
      trimmedMessages,
      systemPromptTokensEst,
      isExact: false,
    } satisfies ContextUsageMetadata;
  }, [latestUsage, messages]);

  const pct = Math.min(
    100,
    Math.round((metrics.contextTokens / ACTIVE_WINDOW_TOKEN_BUDGET) * 100),
  );

  const barColor =
    pct >= 85
      ? "bg-rose-500"
      : pct >= 65
        ? "bg-amber-500"
        : "bg-emerald-500/85";

  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={() => {
              play();
              setOpen((prev) => !prev);
            }}
            aria-expanded={open}
            className="group inline-flex min-h-7 items-center gap-2 rounded-full border border-border/55 bg-card/55 px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-border hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Consumo de contexto del LLM"
          />
        }
      >
        <CpuIcon
          className={cn(
            "size-3 shrink-0",
            isBusy ? "animate-pulse text-amber-400" : "text-muted-foreground/80",
          )}
        />
        <span className="font-mono tabular-nums">
          {metrics.isExact ? "" : "~"}
          {formatTokenCount(metrics.contextTokens)} tok
        </span>
        <span
          aria-hidden
          className="h-1 w-12 overflow-hidden rounded-full bg-muted/80"
        >
          <span
            className={cn("block h-full transition-all duration-300", barColor)}
            style={{ width: `${Math.max(metrics.contextTokens > 0 ? 6 : 0, pct)}%` }}
          />
        </span>
        <span className="hidden font-mono text-[10px] tabular-nums text-muted-foreground/80 sm:inline">
          {metrics.windowMessages}/{metrics.maxWindowMessages} msg
        </span>
        {metrics.trimmedMessages > 0 && (
          <span className="rounded bg-amber-500/15 px-1 py-0 font-mono text-[9.5px] font-medium tabular-nums text-amber-700 dark:text-amber-300">
            +{metrics.trimmedMessages} comp.
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent
        side="top"
        align="start"
        className="flex flex-col gap-1 px-3 py-2 text-[11px]"
      >
        <div className="font-semibold">
          Contexto del LLM ({metrics.isExact ? "medición real" : "estimación"})
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 font-mono text-[10.5px] tabular-nums opacity-90">
          <span>Entrada (contexto):</span>
          <span className="text-right">
            {metrics.contextTokens.toLocaleString("es-AR")} tok
          </span>
          {metrics.outputTokens > 0 && (
            <>
              <span>Salida último turno:</span>
              <span className="text-right">
                {metrics.outputTokens.toLocaleString("es-AR")} tok
              </span>
            </>
          )}
          {metrics.totalTurnTokens > 0 && (
            <>
              <span>Total turno (c/ tools):</span>
              <span className="text-right">
                {metrics.totalTurnTokens.toLocaleString("es-AR")} tok
              </span>
            </>
          )}
          <span>Ventana activa:</span>
          <span className="text-right">
            {metrics.windowMessages}/{metrics.maxWindowMessages} msg
          </span>
          {metrics.trimmedMessages > 0 && (
            <>
              <span>Turnos compactados:</span>
              <span className="text-right">{metrics.trimmedMessages}</span>
            </>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
