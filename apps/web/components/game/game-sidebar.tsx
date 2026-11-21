"use client";

import {
  getAbilityModifier,
  getCheckModifier,
  type GameEvent,
  type GameState,
  type Skill,
} from "@dungeons/rules";
import {
  BookOpenIcon,
  BrainIcon,
  HistoryIcon,
  PlusIcon,
  ShieldIcon,
  UserIcon,
} from "lucide-react";
import * as React from "react";

import type { DeclareCheckToolOutput } from "@/agent/types";
import { CombatTracker } from "@/components/game/combat-tracker";
import { HybridCheckCard } from "@/components/game/hybrid-check-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CharacterPresetInfo } from "@/lib/game/presets";
import type { SessionSummaryItem, StoredMemoryFact } from "@/lib/game/store";
import { cn } from "@/lib/utils";

type SidebarTab = "ficha" | "escena" | "memoria" | "log";

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

function getHpBarColor(current: number, max: number): string {
  if (current <= 0) return "bg-destructive";
  const ratio = max > 0 ? current / max : 0;
  if (ratio > 0.5) return "bg-emerald-500";
  if (ratio > 0.25) return "bg-amber-500";
  return "bg-rose-500";
}

export function GameSidebar({
  campaignId,
  sessionNumber = 1,
  state,
  events,
  sessionSummaries = [],
  memoryFacts = [],
  presets,
  onNewCampaign,
  onStartNewSession,
  onStateUpdated,
  onToggleMode,
  onRollback,
  onManualDeclareVerified,
}: {
  campaignId: string | null;
  sessionNumber?: number;
  state: GameState | null;
  events: GameEvent[];
  sessionSummaries?: SessionSummaryItem[];
  memoryFacts?: StoredMemoryFact[];
  presets: CharacterPresetInfo[];
  onNewCampaign: (presetId: string, mode: "digital" | "hybrid") => Promise<void>;
  onStartNewSession: () => Promise<void>;
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
  const [showNewCampaign, setShowNewCampaign] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState<SidebarTab>("ficha");
  const [busy, setBusy] = React.useState(false);
  const [sessionBusy, setSessionBusy] = React.useState(false);
  const [manualSkill, setManualSkill] = React.useState<Skill>("perception");
  const [manualDc, setManualDc] = React.useState("12");
  const [showManualRoll, setShowManualRoll] = React.useState(false);

  const activeChar = state ? Object.values(state.characters)[0] : undefined;
  const currentScene = state ? state.scenes[state.sceneId] : undefined;
  const unlockedIds = state ? (state.unlockedClues[state.sceneId] ?? []) : [];
  const activeEvents = events.filter(
    (e) => e.revertedByEventId === null && e.type !== "ROLLBACK",
  );
  const closedRecaps = sessionSummaries.filter(
    (s) => s.summary.trim().length > 0,
  );

  async function handleCreate() {
    setBusy(true);
    try {
      await onNewCampaign(selectedPreset, selectedMode);
      setShowNewCampaign(false);
    } finally {
      setBusy(false);
    }
  }

  async function handleRotateSession() {
    setSessionBusy(true);
    try {
      await onStartNewSession();
    } finally {
      setSessionBusy(false);
    }
  }

  const hpPct = activeChar
    ? activeChar.hp.max > 0
      ? Math.max(
          0,
          Math.min(
            100,
            Math.round((activeChar.hp.current / activeChar.hp.max) * 100),
          ),
        )
      : 0
    : 0;

  return (
    <aside className="flex w-full shrink-0 flex-col gap-3 overflow-y-auto border-t border-border/80 bg-sidebar/70 p-3.5 text-xs lg:w-[376px] lg:border-t-0 lg:border-l">
      {/* Cabecera de campaña + acciones de sesión y nueva partida */}
      <section className="flex flex-col gap-2.5 rounded-xl border border-border/80 bg-card/80 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <h2 className="truncate text-sm font-semibold tracking-tight">
              Aguas Quietas
            </h2>
            <span className="rounded border border-border/70 bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
              Sesión #{sessionNumber}
            </span>
          </div>
          {state && (
            <span className="rounded border border-indigo-500/25 bg-indigo-500/10 px-1.5 py-0.5 font-mono text-[10px] font-medium tabular-nums text-indigo-700 dark:text-indigo-300">
              seq {state.lastSeq}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {campaignId && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 flex-1 text-[11px]"
              onClick={handleRotateSession}
              disabled={sessionBusy}
              title="Cierra la sesión actual guardando un resumen y abre la siguiente"
            >
              {sessionBusy ? "Cerrando…" : `Cerrar → #${sessionNumber + 1}`}
            </Button>
          )}
          <Button
            size="sm"
            variant={showNewCampaign ? "secondary" : "ghost"}
            className="h-7 px-2.5 text-[11px]"
            onClick={() => setShowNewCampaign((prev) => !prev)}
          >
            <PlusIcon className="size-3.5" />
            <span>Nueva</span>
          </Button>
        </div>

        {showNewCampaign && (
          <div className="flex flex-col gap-2 border-t border-border/70 pt-2.5">
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-muted-foreground">
                  Personaje inicial
                </span>
                <select
                  className="h-8 rounded-md border border-border bg-background px-2 text-xs"
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
                <span className="text-[11px] text-muted-foreground">
                  Modo inicial
                </span>
                <select
                  className="h-8 rounded-md border border-border bg-background px-2 text-xs"
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
            <Button
              size="sm"
              className="w-full"
              onClick={handleCreate}
              disabled={busy}
            >
              {busy ? "Creando campaña…" : "Crear nueva campaña"}
            </Button>
          </div>
        )}
      </section>

      {/* Combate activo anclado arriba cuando corresponde */}
      {state?.combat?.active && <CombatTracker combat={state.combat} />}

      {/* Tarjeta HUD del Personaje Activo */}
      {state && activeChar && campaignId && (
        <section className="flex flex-col gap-2.5 rounded-xl border border-border/80 bg-card/80 p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold tracking-tight">
                {activeChar.name}
              </h3>
              <p className="text-[11px] text-muted-foreground">
                {activeChar.species} · {activeChar.className} Nv.{" "}
                {activeChar.level}
              </p>
            </div>

            {/* Segmented Mode Control (Digital | Híbrido) */}
            <div
              role="group"
              aria-label="Modo de tiradas del personaje"
              className="inline-flex shrink-0 rounded-lg border border-border/80 bg-muted/60 p-0.5 text-[11px]"
            >
              <button
                type="button"
                onClick={() => {
                  if (activeChar.rollAuthority === "player-declared") {
                    void onToggleMode(activeChar.id, "digital");
                  }
                }}
                className={cn(
                  "rounded-md px-2 py-0.5 font-medium transition-colors",
                  activeChar.rollAuthority !== "player-declared"
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Digital
              </button>
              <button
                type="button"
                onClick={() => {
                  if (activeChar.rollAuthority !== "player-declared") {
                    void onToggleMode(activeChar.id, "hybrid");
                  }
                }}
                className={cn(
                  "rounded-md px-2 py-0.5 font-medium transition-colors",
                  activeChar.rollAuthority === "player-declared"
                    ? "bg-amber-500/20 text-amber-700 dark:text-amber-300 shadow-xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Híbrido
              </button>
            </div>
          </div>

          {/* Barra visual de PG + tiles CA / VEL */}
          <div className="grid grid-cols-4 gap-2">
            <div className="col-span-2 flex flex-col justify-between gap-1 rounded-lg border border-border/70 bg-background/60 p-2">
              <div className="flex items-baseline justify-between gap-1">
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  PG
                </span>
                <div className="flex items-baseline gap-1 font-mono text-xs font-semibold tabular-nums">
                  <span>
                    {activeChar.hp.current}/{activeChar.hp.max}
                  </span>
                  {activeChar.hp.temp > 0 && (
                    <span className="text-[10px] text-cyan-600 dark:text-cyan-400">
                      +{activeChar.hp.temp}
                    </span>
                  )}
                </div>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full transition-all",
                    getHpBarColor(activeChar.hp.current, activeChar.hp.max),
                  )}
                  style={{ width: `${hpPct}%` }}
                />
              </div>
            </div>

            <div className="flex flex-col items-center justify-center rounded-lg border border-border/70 bg-background/60 p-1.5">
              <span className="flex items-center gap-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                <ShieldIcon className="size-2.5" />
                CA
              </span>
              <span className="font-mono text-sm font-semibold tabular-nums">
                {activeChar.ac}
              </span>
            </div>

            <div className="flex flex-col items-center justify-center rounded-lg border border-border/70 bg-background/60 p-1.5">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                VEL
              </span>
              <span className="font-mono text-sm font-semibold tabular-nums">
                {activeChar.speed}
                <span className="text-[10px] font-normal text-muted-foreground">
                  ft
                </span>
              </span>
            </div>
          </div>

          {/* Condiciones, agotamiento o concentración activa */}
          {(activeChar.conditions.length > 0 ||
            activeChar.exhaustionLevel > 0 ||
            activeChar.concentratingOn) && (
            <div className="flex flex-wrap gap-1">
              {activeChar.conditions.map((cond) => (
                <span
                  key={cond}
                  className="rounded border border-rose-500/30 bg-rose-500/10 px-1.5 py-0.5 font-mono text-[10px] text-rose-700 dark:text-rose-300"
                >
                  {cond}
                </span>
              ))}
              {activeChar.exhaustionLevel > 0 && (
                <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-amber-700 dark:text-amber-300">
                  Agotamiento {activeChar.exhaustionLevel}
                </span>
              )}
              {activeChar.concentratingOn && (
                <span className="rounded border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-0.5 text-[10px] text-indigo-700 dark:text-indigo-300">
                  Conc: {activeChar.concentratingOn}
                </span>
              )}
            </div>
          )}

          {/* Grilla de características 6x1 */}
          <div className="grid grid-cols-6 gap-1 text-center font-mono tabular-nums">
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
                <div
                  key={label}
                  className="rounded-md border border-border/60 bg-background/50 py-1"
                >
                  <div className="font-sans text-[9px] font-medium text-muted-foreground">
                    {label}
                  </div>
                  <div className="text-xs font-semibold">
                    {mod >= 0 ? `+${mod}` : mod}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {score}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Barra de 4 pestañas compactas */}
      {state && (
        <div className="flex flex-col gap-2.5">
          <div
            role="tablist"
            aria-label="Secciones de campaña"
            className="grid grid-cols-4 gap-1 rounded-xl border border-border/80 bg-muted/40 p-1"
          >
            {(
              [
                { id: "ficha", label: "Ficha", icon: UserIcon },
                { id: "escena", label: "Escena", icon: BookOpenIcon },
                {
                  id: "memoria",
                  label: "Mem.",
                  count: memoryFacts.length,
                  icon: BrainIcon,
                },
                {
                  id: "log",
                  label: "Log",
                  count: activeEvents.length,
                  icon: HistoryIcon,
                },
              ] as Array<{
                id: SidebarTab;
                label: string;
                count?: number;
                icon: typeof UserIcon;
              }>
            ).map((tab) => {
              const Icon = tab.icon;
              const selected = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  role="tab"
                  type="button"
                  aria-selected={selected}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "flex items-center justify-center gap-1 rounded-lg px-1.5 py-1.5 text-[11px] font-medium transition-colors",
                    selected
                      ? "bg-card text-foreground shadow-xs ring-1 ring-border/70"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="size-3 shrink-0" />
                  <span>{tab.label}</span>
                  {typeof tab.count === "number" && tab.count > 0 && (
                    <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                      {tab.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Contenido de la pestaña Ficha */}
          {activeTab === "ficha" && activeChar && campaignId && (
            <section className="flex flex-col gap-3 rounded-xl border border-border/80 bg-card/80 p-3">
              <div>
                <span className="text-[11px] font-medium text-muted-foreground">
                  Modificadores de habilidad
                </span>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {DISPLAY_SKILLS.map((sk) => {
                    const m = getCheckModifier(
                      activeChar,
                      sk.key,
                      state.ruleset,
                    ).totalMod;
                    return (
                      <span
                        key={sk.key}
                        className="rounded-md border border-border/60 bg-background/60 px-1.5 py-0.5 font-mono text-[11px] tabular-nums"
                      >
                        <span className="font-sans text-muted-foreground">
                          {sk.label}
                        </span>{" "}
                        {m >= 0 ? `+${m}` : m}
                      </span>
                    );
                  })}
                </div>
              </div>

              <div className="border-t border-border/70 pt-2.5">
                <span className="text-[11px] font-medium text-muted-foreground">
                  Inventario
                </span>
                <ul className="mt-1.5 flex flex-col gap-1 text-foreground/90">
                  {activeChar.inventory.map((item) => (
                    <li
                      key={item.itemId}
                      className="flex items-center justify-between rounded-md bg-background/50 px-2 py-1"
                    >
                      <span className="truncate">{item.name}</span>
                      <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                        ×{item.quantity}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="border-t border-border/70 pt-2.5">
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
                        className="h-8 rounded-md border border-border bg-background px-2 text-xs"
                        value={manualSkill}
                        onChange={(e) =>
                          setManualSkill(e.target.value as Skill)
                        }
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
                        className="h-8 font-mono text-xs tabular-nums"
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

          {/* Contenido de la pestaña Escena */}
          {activeTab === "escena" && currentScene && (
            <section className="flex flex-col gap-2 rounded-xl border border-border/80 bg-card/80 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">
                  {currentScene.titleEs}
                </span>
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {currentScene.id}
                </span>
              </div>
              <p className="leading-relaxed text-muted-foreground">
                {currentScene.summaryEs}
              </p>
              {currentScene.narrativeHookEs && (
                <p className="rounded-lg border border-border/60 bg-background/50 p-2 text-[11px] italic text-foreground/85">
                  {currentScene.narrativeHookEs}
                </p>
              )}
              {unlockedIds.length > 0 ? (
                <div className="mt-1 flex flex-col gap-1.5 border-t border-border/70 pt-2">
                  <span className="text-[11px] font-medium text-foreground">
                    Pistas desbloqueadas ({unlockedIds.length})
                  </span>
                  {currentScene.clues
                    .filter((c) => unlockedIds.includes(c.id))
                    .map((clue) => (
                      <div
                        key={clue.id}
                        className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1.5"
                      >
                        <div className="font-mono text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                          [CD {clue.dc}] {clue.titleEs}
                        </div>
                        <p className="mt-0.5 text-[11px] text-foreground/90">
                          {clue.descriptionEs}
                        </p>
                      </div>
                    ))}
                </div>
              ) : (
                <p className="border-t border-border/70 pt-2 text-[11px] text-muted-foreground">
                  Aún no hay pistas desbloqueadas en esta escena.
                </p>
              )}
            </section>
          )}

          {/* Contenido de la pestaña Memoria */}
          {activeTab === "memoria" && (
            <section className="flex flex-col gap-2 rounded-xl border border-border/80 bg-card/80 p-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Memoria de campaña</h3>
                <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                  {memoryFacts.length} hecho(s)
                </span>
              </div>

              {memoryFacts.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  Los hitos, pistas y promesas clave se registrarán acá
                  automáticamente y se sincronizan con el rollback.
                </p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {memoryFacts.slice(0, 10).map((fact) => (
                    <li
                      key={fact.id}
                      className="rounded-lg border border-border/60 bg-background/50 px-2.5 py-1.5 text-[11px]"
                    >
                      <span className="font-mono text-[10px] tabular-nums text-indigo-600 dark:text-indigo-400">
                        [seq {fact.eventSeq}]
                      </span>{" "}
                      {fact.content}
                    </li>
                  ))}
                </ul>
              )}

              {closedRecaps.length > 0 && (
                <div className="flex flex-col gap-1.5 border-t border-border/70 pt-2">
                  <span className="text-[11px] font-medium text-muted-foreground">
                    Sesiones cerradas
                  </span>
                  {closedRecaps.slice(-4).map((recap) => (
                    <p
                      key={recap.id}
                      className="rounded-lg border border-border/60 bg-muted/30 px-2.5 py-1.5 text-[11px] text-muted-foreground"
                    >
                      <strong className="font-mono text-foreground">
                        Sesión #{recap.sessionNumber}:
                      </strong>{" "}
                      {recap.summary}
                    </p>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Contenido de la pestaña Log & Rollback */}
          {activeTab === "log" && (
            <section className="flex flex-col gap-2 rounded-xl border border-border/80 bg-card/80 p-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">
                  Historial (event_log)
                </h3>
                {activeEvents.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px]"
                    onClick={() => onRollback(0)}
                  >
                    Reiniciar a seq 0
                  </Button>
                )}
              </div>

              {activeEvents.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  Sin eventos registrados.
                </p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {activeEvents
                    .slice()
                    .reverse()
                    .slice(0, 14)
                    .map((ev) => (
                      <li
                        key={ev.id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-border/70 bg-background/50 px-2.5 py-1.5"
                      >
                        <div className="min-w-0">
                          <div className="truncate font-mono text-[11px] font-medium tabular-nums">
                            #{ev.seq} {ev.type}
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            {ev.source === "player-declared"
                              ? "papel"
                              : "motor"}{" "}
                            · {ev.actor}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-[11px]"
                          onClick={() => onRollback(ev.seq)}
                          title={`Volver al estado en secuencia ${ev.seq}`}
                        >
                          Volver
                        </Button>
                      </li>
                    ))}
                </ul>
              )}
            </section>
          )}
        </div>
      )}
    </aside>
  );
}
