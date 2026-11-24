"use client";

import { Popover } from "@base-ui/react/popover";
import {
  CompassIcon,
  Loader2Icon,
  MessageSquareIcon,
  RefreshCwIcon,
  SearchIcon,
  SparklesIcon,
  SwordsIcon,
  XIcon,
} from "lucide-react";
import * as React from "react";

import { InputGroupButton } from "@/components/ui/input-group";
import { useSensoryUI } from "@/components/ui/sensory-ui/config/provider";
import { cn } from "@/lib/utils";

export type SparkleCategory = "general" | "social" | "fight" | "travel";

export interface SparkleSuggestionItem {
  skill: string;
  modifier: number;
  label: string;
}

const CATEGORIES: ReadonlyArray<{
  id: SparkleCategory;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: "general", label: "General", icon: SearchIcon },
  { id: "social", label: "Social", icon: MessageSquareIcon },
  { id: "fight", label: "Combate", icon: SwordsIcon },
  { id: "travel", label: "Explorar", icon: CompassIcon },
];

const MAX_REGENS_PER_TURN = 3;

interface TurnCacheState {
  turnKey: string;
  byCategory: Partial<Record<SparkleCategory, SparkleSuggestionItem[]>>;
  regenUsed: number;
}

export function SparklesSuggestions({
  campaignId,
  actorId,
  actorName,
  lastDmText,
  disabled,
  onSelectAction,
}: {
  campaignId?: string | null;
  actorId?: string | null;
  actorName?: string | null;
  lastDmText?: string;
  disabled?: boolean;
  onSelectAction: (text: string) => void;
}) {
  const { playSound } = useSensoryUI();
  const [open, setOpen] = React.useState(false);
  const [category, setCategory] = React.useState<SparkleCategory>("general");
  const [loading, setLoading] = React.useState(false);

  const turnKey = `${campaignId ?? ""}::${actorId ?? ""}::${lastDmText ?? ""}`;
  const [turnCache, setTurnCache] = React.useState<TurnCacheState>(() => ({
    turnKey,
    byCategory: {},
    regenUsed: 0,
  }));

  const effectiveCache =
    turnCache.turnKey === turnKey
      ? turnCache
      : { turnKey, byCategory: {}, regenUsed: 0 };

  const items = effectiveCache.byCategory[category] ?? [];
  const regenLeft = Math.max(0, MAX_REGENS_PER_TURN - effectiveCache.regenUsed);

  const fetchSuggestions = React.useCallback(
    async (targetCategory: SparkleCategory, forceRefresh = false) => {
      if (!campaignId) return;
      if (
        !forceRefresh &&
        effectiveCache.byCategory[targetCategory] &&
        effectiveCache.byCategory[targetCategory]!.length > 0
      ) {
        return;
      }

      setLoading(true);
      try {
        const res = await fetch("/api/suggestions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            campaignId,
            ...(actorId ? { actorId } : {}),
            category: targetCategory,
            lastDmText,
          }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          ok: boolean;
          suggestions?: SparkleSuggestionItem[];
        };
        if (data.ok && Array.isArray(data.suggestions)) {
          const nextSuggestions = data.suggestions;
          setTurnCache((prev) => {
            const base =
              prev.turnKey === turnKey
                ? prev
                : { turnKey, byCategory: {}, regenUsed: 0 };
            return {
              turnKey,
              regenUsed: forceRefresh ? base.regenUsed + 1 : base.regenUsed,
              byCategory: {
                ...base.byCategory,
                [targetCategory]: nextSuggestions,
              },
            };
          });
        }
      } finally {
        setLoading(false);
      }
    },
    [campaignId, actorId, effectiveCache.byCategory, lastDmText, turnKey],
  );

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (nextOpen) {
      playSound("overlay.open");
      void fetchSuggestions(category, false);
    } else {
      playSound("overlay.close");
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger
        render={
          <InputGroupButton
            type="button"
            size="icon-sm"
            variant="ghost"
            disabled={disabled || !campaignId}
            aria-label="Sugerir acciones tácticas"
            title="Ideas de acción según tus mejores habilidades (modelo Free)"
            className="text-sky-600 hover:bg-sky-500/15 hover:text-sky-500 dark:text-sky-400"
          >
            <SparklesIcon className="size-4" />
          </InputGroupButton>
        }
      />

      <Popover.Portal>
        <Popover.Positioner
          side="top"
          align="end"
          sideOffset={10}
          className="isolate z-50"
        >
          <Popover.Popup className="w-[360px] max-w-[92vw] origin-(--transform-origin) rounded-2xl border border-border/80 bg-popover p-3 text-popover-foreground shadow-xl outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
            <div className="mb-2.5 flex items-center justify-between gap-1.5">
              <button
                type="button"
                onClick={() => handleOpenChange(false)}
                aria-label="Cerrar sugerencias"
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-border/70 bg-background/70 text-muted-foreground hover:text-foreground"
              >
                <XIcon className="size-3.5" />
              </button>

              <div className="flex flex-1 items-center gap-1 overflow-x-auto">
                {CATEGORIES.map(({ id, label, icon: Icon }) => {
                  const active = category === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        playSound("interaction.subtle");
                        setCategory(id);
                        void fetchSuggestions(id, false);
                      }}
                      className={cn(
                        "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                        active
                          ? "bg-sky-500 text-white shadow-xs"
                          : "border border-border/70 bg-background/60 text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <Icon className="size-3" />
                      {label}
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                disabled={loading || regenLeft <= 0}
                title={
                  regenLeft > 0
                    ? `Regenerar ideas (${regenLeft} restantes este turno)`
                    : "Límite de regeneraciones alcanzado para este turno"
                }
                onClick={() => {
                  if (regenLeft <= 0 || loading) return;
                  playSound("interaction.tap");
                  void fetchSuggestions(category, true);
                }}
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-border/70 bg-background/70 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
              >
                <RefreshCwIcon
                  className={cn("size-3.5", loading && "animate-spin")}
                />
              </button>
            </div>

            <div className="flex flex-col gap-2">
              {actorName && (
                <p className="px-0.5 text-[10.5px] font-medium text-muted-foreground">
                  Para <span className="text-foreground">{actorName}</span>
                </p>
              )}
              {loading && items.length === 0 ? (
                <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                  <Loader2Icon className="size-4 animate-spin text-sky-500" />
                  <span>Generando ideas según tus habilidades…</span>
                </div>
              ) : (
                items.map((item, idx) => (
                  <button
                    key={`${item.skill}-${idx}`}
                    type="button"
                    onClick={() => {
                      playSound("interaction.confirm");
                      setOpen(false);
                      onSelectAction(item.label);
                    }}
                    className="group flex flex-col gap-1 rounded-xl border border-border/70 bg-card/70 p-2.5 text-left transition-colors hover:border-sky-500/45 hover:bg-sky-500/[0.06]"
                  >
                    <span className="inline-flex w-fit items-center gap-1 rounded-md border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-sky-700 dark:text-sky-300">
                      {item.skill}{" "}
                      {item.modifier >= 0
                        ? `+${item.modifier}`
                        : item.modifier}
                    </span>
                    <span className="text-xs leading-relaxed text-foreground/95">
                      {item.label}
                    </span>
                  </button>
                ))
              )}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
