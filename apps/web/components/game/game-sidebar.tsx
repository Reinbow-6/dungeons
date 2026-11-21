"use client";

import {
  getAbilityModifier,
  getCheckModifier,
  type GameEvent,
  type GameState,
  type Skill,
} from "@dungeons/rules";
import * as React from "react";

import type { DeclareCheckToolOutput } from "@/agent/types";
import { CombatTracker } from "@/components/game/combat-tracker";
import { HybridCheckCard } from "@/components/game/hybrid-check-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CharacterPresetInfo } from "@/lib/game/presets";

const DISPLAY_SKILLS: Array<{ key: Skill; label: string }> = [
  { key: "perception", label: "Percepción" },
  { key: "investigation", label: "Investigación" },
  { key: "stealth", label: "Sigilo" },
  { key: "persuasion", label: "Persuasión" },
  { key: "deception", label: "Engaño" },
  { key: "intimidation", label: "Intimidación" },
  { key: "insight", label: "Perspicacia" },
  { key: "athletics", label: "Atletismo" },
  { key: "survival", label: "Supervivencia" },
];

export function GameSidebar({
  campaignId,
  state,
  events,
  presets,
  onNewCampaign,
  onStateUpdated,
  onToggleMode,
  onRollback,
  onManualDeclareVerified,
}: {
  campaignId: string | null;
  state: GameState | null;
  events: GameEvent[];
  presets: CharacterPresetInfo[];
  onNewCampaign: (presetId: string, mode: "digital" | "hybrid") => Promise<void>;
  onStateUpdated: (nextState: GameState) => void;
  onToggleMode: (actorId: string, mode: "digital" | "hybrid") => Promise<void>;
  onRollback: (targetSeq: number) => Promise<void>;
  onManualDeclareVerified: (
    result: DeclareCheckToolOutput,
    nextState: GameState,
    event: GameEvent,
  ) => void;
}) {
  const [selectedPreset, setSelectedPreset] = React.useState("pc_kael");
  const [selectedMode, setSelectedMode] = React.useState<"digital" | "hybrid">(
    "digital",
  );
  const [busy, setBusy] = React.useState(false);
  const [manualSkill, setManualSkill] = React.useState<Skill>("perception");
  const [manualDc, setManualDc] = React.useState("12");
  const [showManualRoll, setShowManualRoll] = React.useState(false);

  const activeChar = state ? Object.values(state.characters)[0] : undefined;
  const currentScene = state ? state.scenes[state.sceneId] : undefined;
  const unlockedIds = state ? (state.unlockedClues[state.sceneId] ?? []) : [];
  const activeEvents = events.filter(
    (e) => e.revertedByEventId === null && e.type !== "ROLLBACK",
  );

  async function handleCreate() {
    setBusy(true);
    try {
      await onNewCampaign(selectedPreset, selectedMode);
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="flex w-full shrink-0 flex-col gap-4 overflow-y-auto border-t bg-muted/20 p-4 text-xs lg:w-96 lg:border-t-0 lg:border-l">
      {/* Nueva aventura */}
      <section className="flex flex-col gap-2 rounded-xl border bg-background p-3">
        <h2 className="text-sm font-semibold">Aguas Quietas (5e Lite)</h2>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Personaje</span>
            <select
              className="h-8 rounded-md border bg-background px-2 text-xs"
              value={selectedPreset}
              onChange={(e) => setSelectedPreset(e.target.value)}
            >
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Modo</span>
            <select
              className="h-8 rounded-md border bg-background px-2 text-xs"
              value={selectedMode}
              onChange={(e) =>
                setSelectedMode(e.target.value as "digital" | "hybrid")
              }
            >
              <option value="digital">Digital (dados IA)</option>
              <option value="hybrid">Híbrido (papel + dado)</option>
            </select>
          </label>
        </div>
        <Button size="sm" onClick={handleCreate} disabled={busy}>
          {busy ? "Creando…" : "Nueva aventura"}
        </Button>
      </section>

      {/* Escena actual */}
      {state && currentScene && (
        <section className="flex flex-col gap-1.5 rounded-xl border bg-background p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-sm">{currentScene.titleEs}</span>
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
              seq {state.lastSeq}
            </span>
          </div>
          <p className="text-muted-foreground">{currentScene.summaryEs}</p>
          {unlockedIds.length > 0 && (
            <div className="mt-1 flex flex-col gap-1 border-t pt-2">
              <span className="font-medium">Pistas desbloqueadas:</span>
              {currentScene.clues
                .filter((c) => unlockedIds.includes(c.id))
                .map((clue) => (
                  <div
                    key={clue.id}
                    className="rounded-md bg-muted/60 px-2 py-1"
                  >
                    <span className="font-medium">
                      [CD {clue.dc}] {clue.titleEs}:
                    </span>{" "}
                    {clue.descriptionEs}
                  </div>
                ))}
            </div>
          )}
        </section>
      )}

      {/* Combate activo */}
      {state?.combat?.active && <CombatTracker combat={state.combat} />}

      {/* Ficha de personaje */}
      {state && activeChar && campaignId && (
        <section className="flex flex-col gap-2 rounded-xl border bg-background p-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold">{activeChar.name}</h3>
              <p className="text-muted-foreground">
                {activeChar.species} · {activeChar.className} Nv.{" "}
                {activeChar.level}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                onToggleMode(
                  activeChar.id,
                  activeChar.rollAuthority === "player-declared"
                    ? "digital"
                    : "hybrid",
                )
              }
            >
              {activeChar.rollAuthority === "player-declared"
                ? "Modo: Híbrido"
                : "Modo: Digital"}
            </Button>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-md border p-1.5">
              <div className="text-[10px] text-muted-foreground">PG</div>
              <div className="font-semibold">
                {activeChar.hp.current}/{activeChar.hp.max}
              </div>
            </div>
            <div className="rounded-md border p-1.5">
              <div className="text-[10px] text-muted-foreground">CA</div>
              <div className="font-semibold">{activeChar.ac}</div>
            </div>
            <div className="rounded-md border p-1.5">
              <div className="text-[10px] text-muted-foreground">VEL</div>
              <div className="font-semibold">{activeChar.speed} ft</div>
            </div>
          </div>

          <div className="grid grid-cols-6 gap-1 text-center">
            {(
              [
                ["FUE", activeChar.abilities.str],
                ["DES", activeChar.abilities.dex],
                ["CON", activeChar.abilities.con],
                ["INT", activeChar.abilities.int],
                ["SAB", activeChar.abilities.wis],
                ["CAR", activeChar.abilities.cha],
              ] as const
            ).map(([label, score]) => {
              const mod = getAbilityModifier(score);
              return (
                <div key={label} className="rounded border py-1">
                  <div className="text-[10px] text-muted-foreground">
                    {label}
                  </div>
                  <div className="font-semibold">
                    {mod >= 0 ? `+${mod}` : mod}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {score}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-1">
            {DISPLAY_SKILLS.map((sk) => {
              const m = getCheckModifier(
                activeChar,
                sk.key,
                state.ruleset,
              ).totalMod;
              return (
                <span
                  key={sk.key}
                  className="rounded bg-muted px-1.5 py-0.5 text-[11px]"
                >
                  {sk.label} {m >= 0 ? `+${m}` : m}
                </span>
              );
            })}
          </div>

          <div className="border-t pt-2">
            <span className="font-medium">Inventario:</span>
            <ul className="mt-1 flex flex-col gap-0.5 text-muted-foreground">
              {activeChar.inventory.map((item) => (
                <li key={item.itemId}>
                  • {item.name} ×{item.quantity}
                </li>
              ))}
            </ul>
          </div>

          <div className="border-t pt-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="w-full"
              onClick={() => setShowManualRoll((prev) => !prev)}
            >
              {showManualRoll
                ? "Ocultar tirada física directa"
                : "Declarar tirada física (Papel)"}
            </Button>

            {showManualRoll && (
              <div className="mt-2 flex flex-col gap-2">
                <div className="grid grid-cols-2 gap-2">
                  <select
                    className="h-8 rounded-md border bg-background px-2 text-xs"
                    value={manualSkill}
                    onChange={(e) => setManualSkill(e.target.value as Skill)}
                  >
                    {DISPLAY_SKILLS.map((sk) => (
                      <option key={sk.key} value={sk.key}>
                        {sk.label}
                      </option>
                    ))}
                  </select>
                  <Input
                    type="number"
                    value={manualDc}
                    onChange={(e) => setManualDc(e.target.value)}
                    placeholder="CD"
                    className="h-8 text-xs"
                  />
                </div>
                <HybridCheckCard
                  sticky={false}
                  campaignId={campaignId}
                  sceneId={state.sceneId}
                  actorId={activeChar.id}
                  skill={manualSkill}
                  dc={Math.max(1, Number.parseInt(manualDc, 10) || 12)}
                  onVerified={(result, nextState, event) => {
                    onStateUpdated(nextState);
                    onManualDeclareVerified(result, nextState, event);
                  }}
                />
              </div>
            )}
          </div>
        </section>
      )}

      {/* Event log & Rollback */}
      {state && (
        <section className="flex flex-col gap-2 rounded-xl border bg-background p-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Historial (event_log)</h3>
            {activeEvents.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onRollback(0)}
              >
                Reiniciar a seq 0
              </Button>
            )}
          </div>

          {activeEvents.length === 0 ? (
            <p className="text-muted-foreground">Sin eventos registrados.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {activeEvents
                .slice()
                .reverse()
                .slice(0, 12)
                .map((ev) => (
                  <li
                    key={ev.id}
                    className="flex items-center justify-between gap-2 rounded-md border px-2 py-1"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">
                        #{ev.seq} {ev.type}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {ev.source === "player-declared" ? "papel" : "motor"} ·{" "}
                        {ev.actor}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onRollback(ev.seq)}
                      title={`Volver al estado en secuencia ${ev.seq}`}
                    >
                      Volver acá
                    </Button>
                  </li>
                ))}
            </ul>
          )}
        </section>
      )}
    </aside>
  );
}
