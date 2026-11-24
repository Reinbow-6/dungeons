"use client";

import type { RulesetProfile } from "@dungeons/rules";
import {
  ArrowRightIcon,
  BookOpenIcon,
  CompassIcon,
  SparklesIcon,
  UsersIcon,
} from "lucide-react";
import * as React from "react";

import { PartyBuilder } from "@/components/game/party-builder";
import { usePlaySound } from "@/components/ui/sensory-ui/config/use-play-sound";
import type { CharacterPresetInfo, PartyMemberSpec } from "@/lib/game/presets";

const CAMPAIGN_START = {
  label: "Comenzar campaña",
  subtitle: "Entrá en Aguas Inquietas y descubrí qué oculta la niebla.",
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
      "Quiero empezar Aguas Inquietas con una escena breve e intrigante. Presentame un misterio cerca del río y dejame decidir qué hacer.",
    icon: SparklesIcon,
  },
] as const;

export function Suggestions({
  onStartCampaign,
  onSelect,
  presets = [],
  onStartLocalParty,
  disabled = false,
}: {
  onStartCampaign: () => void;
  onSelect: (prompt: string) => void;
  presets?: readonly CharacterPresetInfo[];
  onStartLocalParty?: (
    party: PartyMemberSpec[],
    mode: "digital" | "hybrid",
    ruleset: RulesetProfile,
  ) => Promise<void>;
  disabled?: boolean;
}) {
  const { play } = usePlaySound({ sound: "interaction.confirm" });
  const [showPartySetup, setShowPartySetup] = React.useState(false);
  const [creatingParty, setCreatingParty] = React.useState(false);

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
        {onStartLocalParty && presets.length > 0 && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              play();
              setShowPartySetup((prev) => !prev);
            }}
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-amber-500/35 bg-amber-500/[0.06] px-3 py-2.5 text-xs font-medium text-amber-700 transition-colors hover:border-amber-500/55 hover:bg-amber-500/15 dark:text-amber-300 disabled:pointer-events-none disabled:opacity-60"
          >
            <UsersIcon className="size-3.5" aria-hidden="true" />
            Mesa local (1–4)
          </button>
        )}
      </div>

      {showPartySetup && onStartLocalParty && presets.length > 0 && (
        <div className="rounded-2xl border border-border/80 bg-card/90 p-3.5 text-left shadow-md">
          <PartyBuilder
            presets={presets}
            busy={creatingParty || disabled}
            submitLabel="Iniciar partida local"
            onSubmit={async (party, mode, ruleset) => {
              setCreatingParty(true);
              try {
                await onStartLocalParty(party, mode, ruleset);
                setShowPartySetup(false);
              } finally {
                setCreatingParty(false);
              }
            }}
          />
        </div>
      )}

      <p className="text-center text-[11px] leading-relaxed text-muted-foreground/80">
        También podés escribir tu propia acción o dictarla con el micrófono.
      </p>
    </div>
  );
}
