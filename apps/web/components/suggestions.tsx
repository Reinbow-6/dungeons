"use client";

import { ArrowRightIcon, CompassIcon } from "lucide-react";

import { usePlaySound } from "@/components/ui/sensory-ui/config/use-play-sound";

const CAMPAIGN_START = {
  label: "Comenzar campaña",
  subtitle:
    "El Dungeon Master narrará la introducción de Aguas Quietas y abrirá la primera escena.",
  prompt:
    "Comenzamos la campaña Aguas Quietas. Narrá la introducción atmosférica de la historia, presentá la situación inicial de mi personaje junto al río brumoso y proponeme cómo actuar.",
} as const;

export function Suggestions({
  onSelect,
}: {
  onSelect: (prompt: string) => void;
}) {
  const { play } = usePlaySound({ sound: "interaction.confirm" });

  return (
    <div className="mx-auto flex w-full max-w-md justify-center">
      <button
        type="button"
        onClick={() => {
          play();
          onSelect(CAMPAIGN_START.prompt);
        }}
        className="group flex min-h-14 w-full items-center gap-3.5 rounded-2xl border border-amber-500/35 bg-amber-500/[0.08] px-4 py-3.5 text-left shadow-xs transition-all hover:border-amber-500/55 hover:bg-amber-500/[0.13] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-amber-500/35 bg-background/85 text-amber-600 transition-transform group-hover:scale-105 dark:text-amber-300">
          <CompassIcon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-serif text-sm font-semibold text-foreground">
            {CAMPAIGN_START.label}
          </span>
          <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">
            {CAMPAIGN_START.subtitle}
          </span>
        </span>
        <ArrowRightIcon className="size-4 shrink-0 text-amber-600/80 transition-transform group-hover:translate-x-0.5 dark:text-amber-300/80" />
      </button>
    </div>
  );
}
