"use client";

import { Popover } from "@base-ui/react/popover";
import { Progress } from "@base-ui/react/progress";
import {
  computeMacroStoryArc,
  computeTensionMeter,
  deriveTurnContext,
  type AdventurePack,
  type GameEvent,
  type GameState,
  type TensionLevel,
} from "@dungeons/rules";
import { FlameIcon } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { usePlaySound } from "@/components/ui/sensory-ui/config/use-play-sound";
import { cn } from "@/lib/utils";

const LEVEL_STYLES: Record<
  TensionLevel,
  { icon: string; bar: string; badge: string }
> = {
  calma: {
    icon: "text-emerald-500",
    bar: "bg-emerald-500",
    badge: "text-emerald-700 dark:text-emerald-300",
  },
  alerta: {
    icon: "text-sky-500",
    bar: "bg-sky-500",
    badge: "text-sky-700 dark:text-sky-300",
  },
  tension: {
    icon: "text-amber-500",
    bar: "bg-amber-500",
    badge: "text-amber-700 dark:text-amber-300",
  },
  peligro: {
    icon: "text-orange-500",
    bar: "bg-orange-500",
    badge: "text-orange-700 dark:text-orange-300",
  },
  climax: {
    icon: "text-rose-500",
    bar: "bg-rose-500",
    badge: "text-rose-700 dark:text-rose-300",
  },
};

export function TensionMeter({
  state,
  events,
  adventurePack,
  pendingPlayerRoll = false,
  isStreaming = false,
}: {
  state: GameState;
  events: readonly GameEvent[];
  adventurePack?: AdventurePack | null;
  pendingPlayerRoll?: boolean;
  isStreaming?: boolean;
}) {
  const { play } = usePlaySound({ sound: "interaction.subtle" });

  const reading = React.useMemo(
    () => computeTensionMeter(state, events, adventurePack ?? undefined),
    [adventurePack, events, state],
  );
  const arc = React.useMemo(
    () => computeMacroStoryArc(state, events, adventurePack ?? undefined),
    [adventurePack, events, state],
  );
  const turnCtx = React.useMemo(
    () => deriveTurnContext(state, { pendingPlayerRoll, isStreaming }),
    [isStreaming, pendingPlayerRoll, state],
  );

  const tone = LEVEL_STYLES[reading.level];

  return (
    <Popover.Root>
      <Popover.Trigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Termómetro de tensión: ${reading.labelEs} (${reading.score}/100)`}
            onClick={() => play()}
            className="h-6 gap-1.5 rounded-none border-0 bg-transparent px-2 text-[11px] font-normal text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground aria-expanded:bg-muted/60 aria-expanded:text-foreground"
          />
        }
      >
        <FlameIcon className={cn("size-3.5 shrink-0", tone.icon)} />
        <span className={cn("font-medium", tone.badge)}>{reading.labelEs}</span>
        <span className="font-mono text-[10.5px] tabular-nums text-foreground/85">
          {reading.score}
        </span>
        <span
          aria-hidden="true"
          className="hidden h-1 w-9 overflow-hidden rounded-none bg-muted sm:inline-block"
        >
          <span
            className={cn("block h-full rounded-none transition-all duration-300", tone.bar)}
            style={{ width: `${Math.max(6, reading.score)}%` }}
          />
        </span>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Positioner
          side="top"
          align="start"
          sideOffset={8}
          className="isolate z-50"
        >
          <Popover.Popup className="w-72 origin-(--transform-origin) divide-y divide-border/70 overflow-hidden rounded-none border border-border bg-popover p-0 text-popover-foreground shadow-lg outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
            <div className="space-y-2 p-3">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className={cn("font-semibold", tone.badge)}>
                  Tensión · {reading.labelEs}
                </span>
                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                  {reading.score}/100
                </span>
              </div>
              <Progress.Root value={reading.score} min={0} max={100}>
                <Progress.Track className="h-1.5 w-full overflow-hidden rounded-none bg-muted">
                  <Progress.Indicator
                    className={cn(
                      "block h-full rounded-none transition-all duration-300",
                      tone.bar,
                    )}
                  />
                </Progress.Track>
              </Progress.Root>
            </div>

            <div className="space-y-1.5 p-3 text-[11px]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Arco macro</span>
                <span className="truncate font-medium text-foreground">
                  {arc.actTitleEs}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Fase de turno</span>
                <span className="font-mono text-[10.5px] text-foreground">
                  {turnCtx.phase}
                </span>
              </div>
              {turnCtx.activeActorName && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Turno activo</span>
                  <span className="truncate text-foreground/90">
                    {turnCtx.activeActorName}
                  </span>
                </div>
              )}
            </div>

            <div className="space-y-1 bg-secondary/45 px-3 py-2 text-[10.5px] text-muted-foreground">
              {reading.factorsEs.map((factor, idx) => (
                <div key={idx} className="truncate">
                  · {factor}
                </div>
              ))}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
