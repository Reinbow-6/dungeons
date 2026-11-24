"use client";

import {
  ArrowRightIcon,
  BookOpenIcon,
  CompassIcon,
  SparklesIcon,
} from "lucide-react";

import { usePlaySound } from "@/components/ui/sensory-ui/config/use-play-sound";

const CAMPAIGN_START = {
  label: "Comenzar campaña",
  subtitle: "Entrá en Aguas Quietas y descubrí qué oculta la niebla.",
} as const;

const STARTING_POINTS = [
  {
    label: "¿Cómo se juega?",
    prompt:
      "Soy nuevo en Dungeons & Dragons. Explicame brevemente cómo puedo interactuar con el mundo y qué puedo intentar en una escena.",
    icon: BookOpenIcon,
  },
  {
    label: "Sorprendeme",
    prompt:
      "Quiero empezar Aguas Quietas con una escena breve e intrigante. Presentame un misterio cerca del río y dejame decidir qué hacer.",
    icon: SparklesIcon,
  },
] as const;

export function Suggestions({
  onStartCampaign,
  onSelect,
  disabled = false,
}: {
  onStartCampaign: () => void;
  onSelect: (prompt: string) => void;
  disabled?: boolean;
}) {
  const { play } = usePlaySound({ sound: "interaction.confirm" });

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-3">
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          play();
          onStartCampaign();
        }}
        className="group flex min-h-16 w-full items-center gap-4 rounded-2xl border border-amber-500/35 bg-gradient-to-br from-amber-500/[0.12] to-amber-500/[0.04] px-4 py-4 text-left shadow-sm transition-all hover:border-amber-500/60 hover:from-amber-500/[0.17] hover:to-amber-500/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-60 sm:px-5"
      >
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl border border-amber-500/35 bg-background/85 text-amber-600 transition-transform group-hover:scale-105 dark:text-amber-300">
          <CompassIcon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-serif text-base font-semibold text-foreground">
            {CAMPAIGN_START.label}
          </span>
          <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
            {CAMPAIGN_START.subtitle}
          </span>
        </span>
        <ArrowRightIcon className="size-4 shrink-0 text-amber-600/80 transition-transform group-hover:translate-x-0.5 dark:text-amber-300/80" />
      </button>

      <div className="flex flex-col gap-2 sm:flex-row">
        {STARTING_POINTS.map(({ label, prompt, icon: Icon }) => (
          <button
            key={label}
            type="button"
            disabled={disabled}
            onClick={() => {
              play();
              onSelect(prompt);
            }}
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-border/70 bg-card/45 px-3 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:bg-accent/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-60"
          >
            <Icon className="size-3.5" aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
      <p className="text-center text-[11px] leading-relaxed text-muted-foreground/80">
        También podés escribir tu propia acción o dictarla con el micrófono.
      </p>
    </div>
  );
}
