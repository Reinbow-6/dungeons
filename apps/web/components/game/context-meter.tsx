"use client";

import * as React from "react";

import type { ContextUsageMetadata } from "@/agent/types";
import {
  Context,
  ContextCacheUsage,
  ContextContent,
  ContextContentBody,
  ContextContentFooter,
  ContextContentHeader,
  ContextIcon,
  ContextInputUsage,
  ContextOutputUsage,
  ContextTrigger,
  formatCompactTokens,
} from "@/components/ai-elements/context";
import { usePlaySound } from "@/components/ui/sensory-ui/config/use-play-sound";
import type { ChatUIMessage } from "@/tools";

const ACTIVE_WINDOW_TOKEN_BUDGET = 8_000;
const DEFAULT_MAX_WINDOW_MESSAGES = 16;
const BASE_SYSTEM_PROMPT_TOKENS_EST = 1_150;

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
  const [dailyUsage, setDailyUsage] = React.useState<{
    totalRequests: number;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalCachedTokens: number;
    cacheHitRate: number;
  } | null>(null);
  const { play } = usePlaySound({ sound: "interaction.subtle" });

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetch("/api/usage")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data && typeof data.totalRequests === "number") {
          setDailyUsage({
            totalRequests: data.totalRequests,
            totalPromptTokens: data.totalPromptTokens ?? 0,
            totalCompletionTokens: data.totalCompletionTokens ?? 0,
            totalCachedTokens: data.totalCachedTokens ?? 0,
            cacheHitRate: data.cacheHitRate ?? 0,
          });
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, messages.length]);

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

  const usage = React.useMemo(
    () => ({
      inputTokens: metrics.contextTokens,
      outputTokens: metrics.outputTokens,
      totalTokens: metrics.totalTurnTokens,
      cachedInputTokens: metrics.cachedTokens ?? 0,
    }),
    [
      metrics.cachedTokens,
      metrics.contextTokens,
      metrics.outputTokens,
      metrics.totalTurnTokens,
    ],
  );

  return (
    <Context
      usedTokens={metrics.contextTokens}
      maxTokens={ACTIVE_WINDOW_TOKEN_BUDGET}
      usage={usage}
      open={open}
      onOpenChange={setOpen}
    >
      <ContextTrigger
        aria-label="Consumo de contexto del LLM"
        onClick={() => play()}
        className="h-6 gap-1.5 rounded-none border-0 bg-transparent px-2 text-[11px] hover:bg-muted/60 aria-expanded:bg-muted/60"
      >
        <ContextIcon isBusy={isBusy} />
        <span className="font-mono tabular-nums text-foreground/90">
          {metrics.isExact ? "" : "~"}
          {formatCompactTokens(metrics.contextTokens)} tok
        </span>
        <span className="hidden font-mono text-[10px] tabular-nums text-muted-foreground/80 sm:inline">
          {metrics.windowMessages}/{metrics.maxWindowMessages} msg
        </span>
        {metrics.trimmedMessages > 0 && (
          <span className="rounded-none bg-amber-500/15 px-1 py-0 font-mono text-[9.5px] font-medium tabular-nums text-amber-700 dark:text-amber-300">
            +{metrics.trimmedMessages} comp.
          </span>
        )}
      </ContextTrigger>

      <ContextContent
        side="top"
        align="start"
        className="rounded-none border-border shadow-md"
      >
        <ContextContentHeader
          subtitle={metrics.isExact ? "medición real" : "estimación"}
        />
        <ContextContentBody>
          <ContextInputUsage />
          <ContextOutputUsage />
          <ContextCacheUsage hitRate={metrics.cacheHitRate} />
          {metrics.totalTurnTokens > 0 && (
            <div className="flex items-center justify-between gap-3 text-[11.5px]">
              <span className="text-muted-foreground">Total turno (c/ tools)</span>
              <span className="font-mono tabular-nums text-foreground">
                {metrics.totalTurnTokens.toLocaleString("es-AR")} tok
              </span>
            </div>
          )}
          <div className="flex items-center justify-between gap-3 pt-1 text-[11px] text-muted-foreground">
            <span>Ventana activa</span>
            <span className="font-mono tabular-nums">
              {metrics.windowMessages}/{metrics.maxWindowMessages} msg
            </span>
          </div>
          {metrics.trimmedMessages > 0 && (
            <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
              <span>Turnos compactados</span>
              <span className="font-mono tabular-nums">
                {metrics.trimmedMessages}
              </span>
            </div>
          )}
        </ContextContentBody>
        <ContextContentFooter>
          {dailyUsage && dailyUsage.totalRequests > 0 ? (
            <>
              <span>Hoy · {dailyUsage.totalRequests} req</span>
              <span className="font-mono tabular-nums text-foreground/85">
                {formatCompactTokens(dailyUsage.totalPromptTokens)} in ·{" "}
                {Math.round(dailyUsage.cacheHitRate * 100)}% caché
              </span>
            </>
          ) : (
            <>
              <span>Sesión diaria</span>
              <span className="font-mono tabular-nums">
                {dailyUsage ? "Sin consumo hoy" : "Cargando…"}
              </span>
            </>
          )}
        </ContextContentFooter>
      </ContextContent>
    </Context>
  );
}
