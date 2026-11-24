"use client";

import { Popover } from "@base-ui/react/popover";
import { Progress } from "@base-ui/react/progress";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PERCENT_FORMATTER = new Intl.NumberFormat("es-AR", {
  style: "percent",
  maximumFractionDigits: 1,
});

const COMPACT_FORMATTER = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export interface ContextUsageStats {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
}

interface ContextValue {
  usedTokens: number;
  maxTokens: number;
  usage?: ContextUsageStats;
  modelId?: string;
}

const ContextReactContext = React.createContext<ContextValue | null>(null);

function useContextMeterValue(): ContextValue {
  const ctx = React.useContext(ContextReactContext);
  if (!ctx) {
    throw new Error("Context components must be used inside <Context>.");
  }
  return ctx;
}

export function formatCompactTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) {
    return "0";
  }
  if (tokens < 1_000) {
    return String(Math.round(tokens));
  }
  return COMPACT_FORMATTER.format(tokens).toLowerCase();
}

export function Context({
  usedTokens,
  maxTokens,
  usage,
  modelId,
  open,
  onOpenChange,
  children,
}: {
  usedTokens: number;
  maxTokens: number;
  usage?: ContextUsageStats;
  modelId?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}) {
  const value = React.useMemo(
    () => ({ usedTokens, maxTokens, usage, modelId }),
    [usedTokens, maxTokens, usage, modelId],
  );

  return (
    <ContextReactContext.Provider value={value}>
      <Popover.Root
        open={open}
        onOpenChange={(nextOpen) => onOpenChange?.(nextOpen)}
      >
        {children}
      </Popover.Root>
    </ContextReactContext.Provider>
  );
}

const ICON_RADIUS = 9;
const ICON_CIRCUMFERENCE = 2 * Math.PI * ICON_RADIUS;

export function ContextIcon({
  className,
  isBusy = false,
}: {
  className?: string;
  isBusy?: boolean;
}) {
  const { usedTokens, maxTokens } = useContextMeterValue();
  const ratio = maxTokens > 0 ? Math.min(1, Math.max(0, usedTokens / maxTokens)) : 0;
  const dashOffset = ICON_CIRCUMFERENCE * (1 - ratio);

  const strokeTone = isBusy
    ? "text-amber-500"
    : ratio >= 0.85
      ? "text-rose-500"
      : ratio >= 0.65
        ? "text-amber-500"
        : "text-emerald-500";

  return (
    <svg
      aria-hidden="true"
      className={cn(
        "size-4 shrink-0 -rotate-90",
        isBusy && "animate-pulse",
        className,
      )}
      viewBox="0 0 24 24"
    >
      <circle
        cx="12"
        cy="12"
        r={ICON_RADIUS}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        className="text-muted-foreground/25"
      />
      <circle
        cx="12"
        cy="12"
        r={ICON_RADIUS}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={ICON_CIRCUMFERENCE}
        strokeDashoffset={usedTokens > 0 ? Math.min(ICON_CIRCUMFERENCE - 1.5, dashOffset) : ICON_CIRCUMFERENCE}
        className={cn("transition-all duration-300", strokeTone)}
      />
    </svg>
  );
}

export function ContextTrigger({
  className,
  children,
  onClick,
  ...props
}: React.ComponentProps<typeof Button>) {
  const { usedTokens, maxTokens } = useContextMeterValue();
  const ratio = maxTokens > 0 ? Math.min(1, Math.max(0, usedTokens / maxTokens)) : 0;
  const renderedPct = PERCENT_FORMATTER.format(ratio);

  return (
    <Popover.Trigger
      render={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "h-7 gap-2 rounded-full border border-border/60 bg-card/65 px-2.5 text-[11px] font-normal text-muted-foreground transition-colors hover:border-border hover:bg-card hover:text-foreground aria-expanded:border-border aria-expanded:bg-card aria-expanded:text-foreground",
            className,
          )}
          onClick={onClick}
          {...props}
        />
      }
    >
      {children ?? (
        <>
          <span className="font-mono font-medium tabular-nums">{renderedPct}</span>
          <ContextIcon />
        </>
      )}
    </Popover.Trigger>
  );
}

export function ContextContent({
  className,
  side = "top",
  align = "start",
  sideOffset = 8,
  children,
  ...props
}: Popover.Popup.Props &
  Pick<Popover.Positioner.Props, "side" | "align" | "sideOffset">) {
  return (
    <Popover.Portal>
      <Popover.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <Popover.Popup
          data-slot="context-content"
          className={cn(
            "w-72 origin-(--transform-origin) divide-y divide-border/70 overflow-hidden rounded-xl border border-border/80 bg-popover p-0 text-popover-foreground shadow-lg outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className,
          )}
          {...props}
        >
          {children}
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Portal>
  );
}

export function ContextContentHeader({
  className,
  subtitle,
  children,
  ...props
}: React.ComponentProps<"div"> & { subtitle?: string }) {
  const { usedTokens, maxTokens } = useContextMeterValue();
  const ratio = maxTokens > 0 ? Math.min(1, Math.max(0, usedTokens / maxTokens)) : 0;
  const pct = Math.round(ratio * 100);
  const renderedPct = PERCENT_FORMATTER.format(ratio);
  const usedFmt = formatCompactTokens(usedTokens);
  const maxFmt = formatCompactTokens(maxTokens);

  const barTone =
    pct >= 85
      ? "bg-rose-500"
      : pct >= 65
        ? "bg-amber-500"
        : "bg-emerald-500";

  return (
    <div
      data-slot="context-header"
      className={cn("w-full space-y-2 p-3", className)}
      {...props}
    >
      {children ?? (
        <>
          <div className="flex items-center justify-between gap-2 text-xs">
            <div className="flex items-baseline gap-1.5">
              <span className="font-mono font-semibold tabular-nums text-foreground">
                {renderedPct}
              </span>
              {subtitle && (
                <span className="text-[10.5px] text-muted-foreground">
                  {subtitle}
                </span>
              )}
            </div>
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
              {usedFmt} / {maxFmt}
            </span>
          </div>
          <Progress.Root value={pct} min={0} max={100}>
            <Progress.Track className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <Progress.Indicator
                className={cn(
                  "block h-full rounded-full transition-all duration-300",
                  barTone,
                )}
              />
            </Progress.Track>
          </Progress.Root>
        </>
      )}
    </div>
  );
}

export function ContextContentBody({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="context-body"
      className={cn("w-full space-y-1.5 p-3 text-xs", className)}
      {...props}
    />
  );
}

export function ContextContentFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="context-footer"
      className={cn(
        "flex w-full items-center justify-between gap-3 bg-secondary/45 px-3 py-2 text-[11px] text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function UsageRow({
  label,
  tokens,
  extra,
  className,
}: {
  label: string;
  tokens: number;
  extra?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 text-[11.5px]",
        className,
      )}
    >
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums text-foreground">
        {tokens.toLocaleString("es-AR")} tok
        {extra ? (
          <span className="ml-1 text-muted-foreground">{extra}</span>
        ) : null}
      </span>
    </div>
  );
}

export function ContextInputUsage({
  label = "Entrada (contexto)",
  className,
}: {
  label?: string;
  className?: string;
}) {
  const { usage, usedTokens } = useContextMeterValue();
  const tokens = usage?.inputTokens ?? usedTokens;
  return <UsageRow label={label} tokens={tokens} className={className} />;
}

export function ContextOutputUsage({
  label = "Salida último turno",
  className,
}: {
  label?: string;
  className?: string;
}) {
  const { usage } = useContextMeterValue();
  const tokens = usage?.outputTokens ?? 0;
  if (tokens <= 0) return null;
  return <UsageRow label={label} tokens={tokens} className={className} />;
}

export function ContextCacheUsage({
  label = "En caché (turno)",
  hitRate,
  className,
}: {
  label?: string;
  hitRate?: number;
  className?: string;
}) {
  const { usage } = useContextMeterValue();
  const tokens = usage?.cachedInputTokens ?? 0;
  if (tokens <= 0) return null;
  const pct =
    typeof hitRate === "number"
      ? `(${Math.round(hitRate * 100)}%)`
      : undefined;
  return (
    <UsageRow
      label={label}
      tokens={tokens}
      extra={pct}
      className={className}
    />
  );
}

export function ContextReasoningUsage({
  label = "Razonamiento",
  className,
}: {
  label?: string;
  className?: string;
}) {
  const { usage } = useContextMeterValue();
  const tokens = usage?.reasoningTokens ?? 0;
  if (tokens <= 0) return null;
  return <UsageRow label={label} tokens={tokens} className={className} />;
}
