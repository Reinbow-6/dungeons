"use client";

import { getAguasInquietasProgress, type GameState } from "@dungeons/rules";
import { FlagIcon, PlusIcon, SparklesIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

export function EpilogueCard({
  state,
  onStartNewCampaign,
}: {
  state: GameState;
  onStartNewCampaign?: () => void;
}) {
  if (state.sceneId !== "escena_08_otra_orilla") {
    return null;
  }

  const progress = getAguasInquietasProgress(state);
  const standardEnding = progress.endings.find((e) => e.isStandard);
  const altEndings = progress.unlockedAlternativeEndings;

  return (
    <section
      aria-label="Epílogo de campaña"
      className="my-2 flex flex-col gap-3 rounded-none border border-border border-l-2 border-l-primary bg-card p-5"
    >
      <div className="flex items-start justify-between gap-3 border-b border-border pb-3">
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
            Crónica completada
          </p>
          <h3 className="mt-0.5 font-serif text-xl font-semibold text-foreground">
            La Otra Orilla · Aguas Inquietas
          </h3>
        </div>
        <span className="inline-flex items-center gap-1 rounded-none border border-primary/35 bg-primary/10 px-2.5 py-1 font-mono text-[11px] font-semibold text-primary tabular-nums">
          <FlagIcon className="size-3" />
          {progress.discoveredCount}/{progress.totalClues} pistas
        </span>
      </div>

      {standardEnding && (
        <div className="rounded-none border border-border border-l-2 border-l-border bg-background/60 p-3">
          <p className="text-xs font-semibold text-foreground">
            Final: {standardEnding.titleEs}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {standardEnding.summaryEs}
          </p>
        </div>
      )}

      {altEndings.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-primary">
            <SparklesIcon className="size-3" />
            Finales secretos desbloqueados ({altEndings.length})
          </p>
          {altEndings.map((ending) => (
            <div
              key={ending.id}
              className="rounded-none border border-primary/30 border-l-2 border-l-primary bg-primary/[0.05] p-3"
            >
              <p className="text-xs font-semibold text-foreground">
                {ending.titleEs}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {ending.summaryEs}
              </p>
            </div>
          ))}
        </div>
      )}

      {onStartNewCampaign && (
        <div className="flex justify-end border-t border-border pt-3">
          <Button
            type="button"
            size="sm"
            className="rounded-none"
            onClick={onStartNewCampaign}
          >
            <PlusIcon className="size-3.5" />
            Comenzar nueva campaña
          </Button>
        </div>
      )}
    </section>
  );
}
