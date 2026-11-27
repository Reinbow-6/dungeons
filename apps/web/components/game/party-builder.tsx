"use client";

import type { RulesetProfile } from "@dungeons/rules";
import { CheckIcon, UsersIcon } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { useSensoryUI } from "@/components/ui/sensory-ui/config/provider";
import type {
  CharacterPresetId,
  CharacterPresetInfo,
  PartyMemberSpec,
} from "@/lib/game/presets";
import { cn } from "@/lib/utils";

const MAX_PARTY_MEMBERS = 4;

export function PartyBuilder({
  presets,
  initialParty,
  initialMode = "digital",
  initialRuleset = "5e-full",
  busy = false,
  submitLabel = "Crear campaña",
  compact = false,
  onSubmit,
}: {
  presets: readonly CharacterPresetInfo[];
  initialParty?: readonly PartyMemberSpec[];
  initialMode?: "digital" | "hybrid";
  initialRuleset?: RulesetProfile;
  busy?: boolean;
  submitLabel?: string;
  compact?: boolean;
  onSubmit: (
    party: PartyMemberSpec[],
    mode: "digital" | "hybrid",
    ruleset: RulesetProfile,
  ) => Promise<void>;
}) {
  const { playSound } = useSensoryUI();
  const [selectedParty, setSelectedParty] = React.useState<PartyMemberSpec[]>(
    () =>
      initialParty && initialParty.length > 0
        ? [...initialParty]
        : [{ presetId: "pc_kael" }],
  );
  const [mode, setMode] = React.useState<"digital" | "hybrid">(initialMode);
  const [ruleset, setRuleset] = React.useState<RulesetProfile>(initialRuleset);

  function togglePreset(presetId: CharacterPresetId) {
    setSelectedParty((prev) => {
      const exists = prev.some((m) => m.presetId === presetId);
      if (exists) {
        if (prev.length <= 1) {
          playSound("notification.warning");
          return prev;
        }
        playSound("interaction.subtle");
        return prev.filter((m) => m.presetId !== presetId);
      }
      if (prev.length >= MAX_PARTY_MEMBERS) {
        playSound("notification.warning");
        return prev;
      }
      playSound("interaction.tap");
      return [...prev, { presetId }];
    });
  }

  function updatePlayerName(presetId: CharacterPresetId, value: string) {
    setSelectedParty((prev) =>
      prev.map((m) =>
        m.presetId === presetId
          ? { ...m, playerName: value.slice(0, 40) }
          : m,
      ),
    );
  }

  async function handleSubmit() {
    if (busy || selectedParty.length === 0) return;
    const cleaned = selectedParty.map((m) => {
      const playerName = m.playerName?.trim();
      return {
        presetId: m.presetId,
        ...(playerName ? { playerName } : {}),
      };
    });
    await onSubmit(cleaned, mode, ruleset);
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2 border-b border-border pb-1.5 text-[11px]">
        <span className="inline-flex items-center gap-1.5 font-medium text-foreground/90">
          <UsersIcon className="size-3.5 text-amber-500" />
          Mesa local ({selectedParty.length}/{MAX_PARTY_MEMBERS} jugadores)
        </span>
        <span className="text-[10px] text-muted-foreground">
          Elegí 1 a 4 héroes
        </span>
      </div>

      <div
        className={cn(
          "grid gap-1.5",
          compact ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2",
        )}
      >
        {presets.map((preset) => {
          const seatIndex = selectedParty.findIndex(
            (m) => m.presetId === preset.id,
          );
          const isSelected = seatIndex >= 0;
          const member = isSelected ? selectedParty[seatIndex] : undefined;

          return (
            <div
              key={preset.id}
              className={cn(
                "flex flex-col gap-1.5 rounded-none border p-2 transition-colors",
                isSelected
                  ? "border-amber-500/45 border-l-2 border-l-amber-500 bg-amber-500/[0.08]"
                  : "border-border bg-background/60 hover:border-foreground/30",
              )}
            >
              <button
                type="button"
                onClick={() => togglePreset(preset.id)}
                className="flex items-start justify-between gap-2 rounded-none text-left"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-xs font-semibold text-foreground">
                      {preset.name}
                    </span>
                    <span className="shrink-0 rounded-none border border-border bg-muted px-1 py-0.5 text-[9.5px] font-medium text-muted-foreground">
                      {preset.className}
                    </span>
                  </div>
                  <p className="mt-0.5 line-clamp-1 text-[10.5px] text-muted-foreground">
                    {preset.summaryEs}
                  </p>
                </div>

                <span
                  className={cn(
                    "mt-0.5 inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-none border px-1 font-mono text-[10px] font-semibold",
                    isSelected
                      ? "border-amber-500 bg-amber-500 text-amber-950"
                      : "border-border bg-background text-muted-foreground",
                  )}
                >
                  {isSelected ? `J${seatIndex + 1}` : <CheckIcon className="size-2.5 opacity-30" />}
                </span>
              </button>

              {isSelected && (
                <input
                  type="text"
                  value={member?.playerName ?? ""}
                  maxLength={40}
                  onChange={(e) => updatePlayerName(preset.id, e.target.value)}
                  placeholder={`Jugador ${seatIndex + 1} (nombre opcional)`}
                  aria-label={`Nombre del jugador para ${preset.name}`}
                  className="h-7 w-full rounded-none border border-border bg-background/85 px-2 text-[11px] text-foreground placeholder:text-muted-foreground/60 focus:border-amber-500/60 focus:outline-none"
                />
              )}
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-2 border-t border-border pt-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted-foreground">
            Modo de mesa
          </span>
          <select
            className="h-8 rounded-none border border-border bg-background px-2 text-xs"
            value={mode}
            onChange={(e) => setMode(e.target.value as "digital" | "hybrid")}
          >
            <option value="digital">Digital (dados IA)</option>
            <option value="hybrid">Híbrido (papel + dado)</option>
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted-foreground">Reglas</span>
          <select
            className="h-8 rounded-none border border-border bg-background px-2 text-xs"
            value={ruleset}
            onChange={(e) => setRuleset(e.target.value as RulesetProfile)}
          >
            <option value="5e-full">5e-full (completo)</option>
            <option value="5e-lite">5e-lite (rápido)</option>
          </select>
        </label>
      </div>

      <Button
        type="button"
        size="sm"
        className="w-full rounded-none"
        onClick={() => void handleSubmit()}
        disabled={busy || selectedParty.length === 0}
      >
        {busy
          ? "Creando campaña…"
          : selectedParty.length > 1
            ? `${submitLabel} (${selectedParty.length} jugadores)`
            : submitLabel}
      </Button>
    </div>
  );
}
