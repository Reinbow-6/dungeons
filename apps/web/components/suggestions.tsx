"use client";

import type { AdventurePack, RulesetProfile } from "@dungeons/rules";
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
import type { AdventurePackSummary } from "@/lib/game/adventure-packs";
import type { CharacterPresetInfo, PartyMemberSpec } from "@/lib/game/presets";
import { cn } from "@/lib/utils";

export function Suggestions({
  onStartCampaign,
  onSelect,
  presets = [],
  adventurePack,
  adventurePacks = [],
  selectedAdventureId,
  onSelectAdventure,
  onStartLocalParty,
  disabled = false,
}: {
  onStartCampaign: () => void;
  onSelect: (prompt: string) => void;
  presets?: readonly CharacterPresetInfo[];
  adventurePack?: AdventurePack | null;
  adventurePacks?: readonly AdventurePackSummary[];
  selectedAdventureId?: string;
  onSelectAdventure?: (adventureId: string) => void;
  onStartLocalParty?: (
    party: PartyMemberSpec[],
    mode: "digital" | "hybrid",
    ruleset: RulesetProfile,
    adventureId?: string,
  ) => Promise<void>;
  disabled?: boolean;
}) {
  const { play } = usePlaySound({ sound: "interaction.confirm" });
  const [showPartySetup, setShowPartySetup] = React.useState(false);
  const [creatingParty, setCreatingParty] = React.useState(false);

  const hasPartyOption = Boolean(onStartLocalParty && presets.length > 0);
  const activeSummary = adventurePacks.find(
    (p) => p.id === (selectedAdventureId ?? adventurePack?.id),
  );
  const activeTitle =
    activeSummary?.titleEs ?? adventurePack?.titleEs ?? "Aguas Quietas";
  const startSubtitle =
    activeSummary?.subtitleEs ??
    adventurePack?.subtitleEs ??
    `Entrá en ${activeTitle} y descubrí qué oculta la primera escena.`;
  const startingPoints = [
    {
      label: "¿Cómo se juega?",
      prompt:
        "Soy nuevo en Dungeons & Dragons. Explicame brevemente cómo puedo interactuar con el mundo y qué puedo intentar en una escena.",
      icon: BookOpenIcon,
    },
    {
      label: "Sorprendeme",
      prompt: `Quiero empezar ${activeTitle} con una escena breve e intrigante. Presentame el primer gancho de la aventura y dejame decidir qué hacer.`,
      icon: SparklesIcon,
    },
  ] as const;

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-2.5">
      {adventurePacks.length > 1 && onSelectAdventure && (
        <div className="flex items-center justify-between gap-2 rounded-none border border-border bg-card px-3 py-2 text-left">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Módulo
          </span>
          <select
            aria-label="Seleccionar módulo de aventura"
            disabled={disabled}
            value={selectedAdventureId ?? adventurePacks[0]?.id ?? "aguas-quietas"}
            onChange={(e) => {
              play();
              onSelectAdventure(e.target.value);
            }}
            className="h-7 min-w-0 flex-1 rounded-none border border-border bg-background px-2 text-xs text-foreground"
          >
            {adventurePacks.map((pack) => (
              <option key={pack.id} value={pack.id}>
                {pack.titleEs}
                {pack.recommendedLevels
                  ? ` (Nv. ${pack.recommendedLevels.min}–${pack.recommendedLevels.max})`
                  : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="w-full rounded-none border border-border bg-card">
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            play();
            onStartCampaign();
          }}
          className="group flex min-h-16 w-full items-center gap-4 rounded-none border-b border-border border-l-2 border-l-primary bg-primary/[0.04] px-4 py-4 text-left transition-colors hover:bg-primary/[0.09] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60 sm:px-5"
        >
          <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-none border border-primary/35 bg-background/90 text-primary transition-colors group-hover:border-primary/60">
            <CompassIcon className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-serif text-base font-semibold text-foreground">
              Comenzar campaña
            </span>
            <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
              {startSubtitle}
            </span>
          </span>
          <ArrowRightIcon className="size-4 shrink-0 text-primary/80 transition-transform group-hover:translate-x-0.5" />
        </button>

        <div
          className={cn(
            "grid grid-cols-1 divide-y divide-border sm:divide-x sm:divide-y-0",
            hasPartyOption ? "sm:grid-cols-3" : "sm:grid-cols-2",
          )}
        >
          {startingPoints.map(({ label, prompt, icon: Icon }) => (
            <button
              key={label}
              type="button"
              disabled={disabled}
              onClick={() => {
                play();
                onSelect(prompt);
              }}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-none bg-transparent px-3 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60"
            >
              <Icon className="size-3.5 shrink-0" aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
          {hasPartyOption && (
            <button
              type="button"
              disabled={disabled}
              aria-expanded={showPartySetup}
              onClick={() => {
                play();
                setShowPartySetup((prev) => !prev);
              }}
              className={cn(
                "inline-flex min-h-11 items-center justify-center gap-2 rounded-none px-3 py-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60",
                showPartySetup
                  ? "bg-amber-500/15 text-amber-800 dark:text-amber-200"
                  : "bg-amber-500/[0.05] text-amber-700 hover:bg-amber-500/12 dark:text-amber-300",
              )}
            >
              <UsersIcon className="size-3.5 shrink-0" aria-hidden="true" />
              <span>Mesa local (1–4)</span>
            </button>
          )}
        </div>
      </div>

      {showPartySetup && onStartLocalParty && presets.length > 0 && (
        <div className="rounded-none border border-border border-l-2 border-l-amber-500 bg-card p-3.5 text-left">
          <PartyBuilder
            presets={presets}
            adventurePacks={adventurePacks}
            selectedAdventureId={selectedAdventureId}
            onAdventureChange={onSelectAdventure}
            busy={creatingParty || disabled}
            submitLabel="Iniciar partida local"
            onSubmit={async (party, mode, ruleset, adventureId) => {
              setCreatingParty(true);
              try {
                await onStartLocalParty(party, mode, ruleset, adventureId);
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
