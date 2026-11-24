"use client";

import {
  CORE_SPELLS_521,
  getAbilityModifier,
  getAguasInquietasProgress,
  getCheckModifier,
  getSpellcastingStats,
  type GameEvent,
  type GameState,
  type RulesetProfile,
  type Skill,
} from "@dungeons/rules";
import {
  BookOpenIcon,
  BrainIcon,
  CheckCircle2Icon,
  CompassIcon,
  HistoryIcon,
  LockIcon,
  MoonIcon,
  PlusIcon,
  ShieldIcon,
  SkullIcon,
  SparklesIcon,
  UserIcon,
  XIcon,
} from "lucide-react";
import * as React from "react";

import { CombatTracker } from "@/components/game/combat-tracker";
import { Button } from "@/components/ui/button";
import { useSensoryUI } from "@/components/ui/sensory-ui/config/provider";
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
  { key: "arcana", label: "Arcano" },
  { key: "medicine", label: "Medicina" },
];

function getHpBarColor(current: number, max: number): string {
  if (current <= 0) return "bg-destructive";
  const ratio = max > 0 ? current / max : 0;
  if (ratio > 0.5) return "bg-emerald-500";
  if (ratio > 0.25) return "bg-amber-500";
  return "bg-rose-500";
}

export function GameSidebar({
  open,
  onClose,
  campaignId,
  sessionNumber = 1,
  state,
  events,
  sessionSummaries = [],
  memoryFacts = [],
  presets,
  onNewCampaign,
  onStartNewSession,
  onToggleMode,
  onRollback,
  onQuickAction,
}: {
  open: boolean;
  onClose: () => void;
  campaignId: string | null;
  sessionNumber?: number;
  state: GameState | null;
  events: GameEvent[];
  sessionSummaries?: SessionSummaryItem[];
  memoryFacts?: StoredMemoryFact[];
  presets: CharacterPresetInfo[];
  onNewCampaign: (
    presetId: string,
    mode: "digital" | "hybrid",
    ruleset: RulesetProfile,
  ) => Promise<void>;
  onStartNewSession: () => Promise<void>;
  onToggleMode: (actorId: string, mode: "digital" | "hybrid") => Promise<void>;
  onRollback: (targetSeq: number) => Promise<void>;
  onQuickAction?: (prompt: string) => void;
}) {
  const { playSound } = useSensoryUI();
  const [selectedPreset, setSelectedPreset] = React.useState("pc_seraphina");
  const [selectedMode, setSelectedMode] = React.useState<"digital" | "hybrid">(
    "digital",
  );
  const [selectedRuleset, setSelectedRuleset] =
    React.useState<RulesetProfile>("5e-full");
  const [showNewCampaign, setShowNewCampaign] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState<SidebarTab>("ficha");
  const [busy, setBusy] = React.useState(false);
  const [sessionBusy, setSessionBusy] = React.useState(false);

  const activeChar = state ? Object.values(state.characters)[0] : undefined;
  const currentScene = state ? state.scenes[state.sceneId] : undefined;
  const unlockedIds = state ? (state.unlockedClues[state.sceneId] ?? []) : [];
  const activeEvents = events.filter(
    (e) => e.revertedByEventId === null && e.type !== "ROLLBACK",
  );
  const closedRecaps = sessionSummaries.filter(
    (s) => s.summary.trim().length > 0,
  );
  const spellStats = activeChar ? getSpellcastingStats(activeChar) : null;
  const slotLevels = activeChar
    ? Object.entries(activeChar.spellSlots).sort(
        ([a], [b]) => Number(a) - Number(b),
      )
    : [];

  function handleClose() {
    playSound("overlay.close");
    onClose();
  }

  async function handleCreate() {
    setBusy(true);
    try {
      await onNewCampaign(selectedPreset, selectedMode, selectedRuleset);
      playSound("notification.success");
      setShowNewCampaign(false);
    } finally {
      setBusy(false);
    }
  }

  async function handleRotateSession() {
    setSessionBusy(true);
    try {
      await onStartNewSession();
      playSound("notification.success");
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
    <>
      {open && (
        <div
          aria-hidden
          onClick={handleClose}
          className="fixed inset-0 z-30 bg-black/45 backdrop-blur-[2px] transition-opacity lg:hidden"
        />
      )}

      <aside
        id="campaign-hud-panel"
        aria-label="Panel HUD de campaña"
        aria-hidden={!open}
        inert={!open || undefined}
        className={cn(
          "fixed inset-y-0 right-0 z-40 flex w-[388px] max-w-[92vw] flex-col gap-3 overflow-y-auto border-l border-border/80 bg-sidebar/95 p-3.5 text-xs shadow-2xl backdrop-blur-xl transition-transform duration-200 ease-out lg:top-12 lg:z-20 lg:shadow-none",
          open ? "translate-x-0" : "pointer-events-none translate-x-full",
        )}
      >
        {/* Cabecera de campaña + cierre del drawer */}
        <section className="flex flex-col gap-2.5 rounded-xl border border-border/80 bg-card/85 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <h2 className="truncate font-serif text-base font-semibold tracking-tight">
                Aguas Inquietas
              </h2>
              <span className="rounded border border-border/70 bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                #{sessionNumber}
              </span>
              {state && (
                <span className="rounded border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-amber-700 dark:text-amber-300">
                  {state.ruleset}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {state && (
                <span className="rounded border border-border/70 bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] font-medium tabular-nums text-muted-foreground">
                  seq {state.lastSeq}
                </span>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-8 text-muted-foreground hover:text-foreground"
                onClick={handleClose}
                title="Cerrar panel (Esc / Alt+H)"
                aria-label="Cerrar panel lateral"
              >
                <XIcon className="size-4" />
              </Button>
            </div>
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
                      {p.name} — {p.className}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-2 gap-2">
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

                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-muted-foreground">
                    Reglas
                  </span>
                  <select
                    className="h-8 rounded-md border border-border bg-background px-2 text-xs"
                    value={selectedRuleset}
                    onChange={(e) =>
                      setSelectedRuleset(e.target.value as RulesetProfile)
                    }
                  >
                    <option value="5e-full">5e-full (completo)</option>
                    <option value="5e-lite">5e-lite (rápido)</option>
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
          <section className="flex flex-col gap-2.5 rounded-xl border border-border/80 bg-card/85 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="mb-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Ficha del personaje
                </p>
                <h3 className="truncate font-serif text-base font-semibold tracking-tight text-amber-700 dark:text-amber-300">
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
                  aria-pressed={activeChar.rollAuthority !== "player-declared"}
                  onClick={() => {
                    if (activeChar.rollAuthority === "player-declared") {
                      playSound("interaction.toggle");
                      void onToggleMode(activeChar.id, "digital");
                    }
                  }}
                  className={cn(
                    "min-h-7 rounded-md px-2 py-0.5 font-medium transition-colors",
                    activeChar.rollAuthority !== "player-declared"
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Digital
                </button>
                <button
                  type="button"
                  aria-pressed={activeChar.rollAuthority === "player-declared"}
                  onClick={() => {
                    if (activeChar.rollAuthority !== "player-declared") {
                      playSound("interaction.toggle");
                      void onToggleMode(activeChar.id, "hybrid");
                    }
                  }}
                  className={cn(
                    "min-h-7 rounded-md px-2 py-0.5 font-medium transition-colors",
                    activeChar.rollAuthority === "player-declared"
                      ? "bg-amber-500/20 text-amber-700 dark:text-amber-300 shadow-xs"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Híbrido
                </button>
              </div>
            </div>

            {/* Barra visual de PG + CA / VEL / Hit Dice */}
            <div className="grid grid-cols-5 gap-1.5">
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
                <span className="flex items-center gap-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
                  <ShieldIcon className="size-2.5" />
                  CA
                </span>
                <span className="font-mono text-sm font-semibold tabular-nums">
                  {activeChar.ac}
                </span>
              </div>

              <div className="flex flex-col items-center justify-center rounded-lg border border-border/70 bg-background/60 p-1.5">
                <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
                  VEL
                </span>
                <span className="font-mono text-sm font-semibold tabular-nums">
                  {activeChar.speed}
                </span>
              </div>

              <div className="flex flex-col items-center justify-center rounded-lg border border-border/70 bg-background/60 p-1.5">
                <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
                  DG
                </span>
                <span className="font-mono text-xs font-semibold tabular-nums">
                  {activeChar.hitDice
                    ? `${activeChar.hitDice.current}/${activeChar.hitDice.max}`
                    : "1/1"}
                </span>
                <span className="font-mono text-[9px] text-muted-foreground">
                  {activeChar.hitDice?.die ?? "d8"}
                </span>
              </div>
            </div>

            {/* Salvaciones de muerte cuando el PJ está en 0 PG */}
            {activeChar.hp.current === 0 && (
              <div className="flex flex-col gap-1.5 rounded-lg border border-rose-500/45 bg-rose-500/10 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 font-semibold text-rose-700 dark:text-rose-300">
                    <SkullIcon className="size-3.5" />
                    Salvaciones de muerte
                  </span>
                  <span className="rounded border border-rose-500/30 bg-rose-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-rose-700 dark:text-rose-200">
                    {activeChar.deathSaves?.failures === 3
                      ? "MUERTO"
                      : activeChar.deathSaves?.stable
                        ? "ESTABLE"
                        : "MORIBUNDO"}
                  </span>
                </div>
                <div className="flex items-center justify-between font-mono text-[11px] tabular-nums">
                  <span className="text-emerald-600 dark:text-emerald-400">
                    Éxitos:{" "}
                    {"●".repeat(activeChar.deathSaves?.successes ?? 0)}
                    {"○".repeat(3 - (activeChar.deathSaves?.successes ?? 0))}
                  </span>
                  <span className="text-rose-600 dark:text-rose-400">
                    Fallos:{" "}
                    {"●".repeat(activeChar.deathSaves?.failures ?? 0)}
                    {"○".repeat(3 - (activeChar.deathSaves?.failures ?? 0))}
                  </span>
                </div>
                {onQuickAction &&
                  !activeChar.deathSaves?.stable &&
                  (activeChar.deathSaves?.failures ?? 0) < 3 && (
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      className="mt-0.5 h-7 w-full text-[11px]"
                      onClick={() =>
                        onQuickAction(
                          `Tiro mi salvación contra la muerte para ${activeChar.name}.`,
                        )
                      }
                    >
                      Tirar salvación contra la muerte
                    </Button>
                  )}
              </div>
            )}

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
                  <span className="rounded border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-[10px] text-violet-700 dark:text-violet-300">
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
                    onClick={() => {
                      if (activeTab !== tab.id) {
                        playSound("navigation.tab");
                        setActiveTab(tab.id);
                      }
                    }}
                    className={cn(
                      "flex min-h-8 items-center justify-center gap-1 rounded-lg px-1.5 py-1.5 text-[11px] font-medium transition-colors",
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
              <section className="flex flex-col gap-3 rounded-xl border border-border/80 bg-card/85 p-3">
                {/* Grimorio y Espacios de Conjuro (si es lanzador) */}
                {spellStats && (
                  <div className="flex flex-col gap-2 border-b border-border/70 pb-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1 text-[11px] font-semibold text-violet-700 dark:text-violet-300">
                        <SparklesIcon className="size-3" />
                        Magia ({spellStats.ability.toUpperCase()})
                      </span>
                      <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                        CD {spellStats.spellSaveDc} · Atq +
                        {spellStats.spellAttackBonus}
                      </span>
                    </div>

                    {slotLevels.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {slotLevels.map(([lvl, pool]) => (
                          <div
                            key={lvl}
                            className="flex items-center gap-1.5 rounded-md border border-violet-500/25 bg-violet-500/10 px-2 py-1 font-mono text-[10px] tabular-nums"
                          >
                            <span className="text-muted-foreground">
                              Nv.{lvl}
                            </span>
                            <span className="tracking-wider text-violet-600 dark:text-violet-300">
                              {"●".repeat(pool.current)}
                              {"○".repeat(Math.max(0, pool.max - pool.current))}
                            </span>
                            <span className="text-foreground/80">
                              {pool.current}/{pool.max}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {activeChar.knownSpells &&
                      activeChar.knownSpells.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {activeChar.knownSpells.map((slug) => {
                            const spec = CORE_SPELLS_521[slug];
                            const label = spec?.nameEs ?? slug;
                            const isCantrip = (spec?.level ?? 0) === 0;
                            const firstPcHandle =
                              activeChar.name.trim().split(/\s+/)[0] ??
                              activeChar.id;
                            const firstEnemy = state.combat?.active
                              ? state.combat.combatants.find(
                                  (c) => c.kind === "enemy" && !c.defeated,
                                )
                              : undefined;
                            const enemyHandle = firstEnemy
                              ? firstEnemy.name.replace(/\s+/g, "_")
                              : undefined;
                            const targetSuffix =
                              spec?.kind === "heal"
                                ? ` @${firstPcHandle}`
                                : enemyHandle
                                  ? ` @${enemyHandle}`
                                  : "";
                            return (
                              <button
                                key={slug}
                                type="button"
                                onClick={() =>
                                  onQuickAction?.(
                                    `/hechizo ${slug}${targetSuffix}`,
                                  )
                                }
                                title={`${spec?.summaryEs ?? `Lanzar ${label}`} · Escribe /hechizo ${slug} en el chat`}
                                className="rounded-md border border-violet-500/25 bg-background/70 px-1.5 py-0.5 text-[10.5px] text-foreground/90 transition-colors hover:border-violet-400/50 hover:bg-violet-500/10"
                              >
                                {label}
                                <span className="ml-1 font-mono text-[9px] text-muted-foreground">
                                  {isCantrip ? "T" : `N${spec?.level}`}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                  </div>
                )}

                {/* Descansos rápidos fuera de combate (escriben comando directo en el chat) */}
                {!state.combat?.active && onQuickAction && (
                  <div className="grid grid-cols-2 gap-1.5 border-b border-border/70 pb-3">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="min-h-8 text-[11px]"
                      onClick={() => onQuickAction("/descanso corto")}
                      title="Escribe /descanso corto en el chat"
                    >
                      <MoonIcon className="size-3 text-emerald-600 dark:text-emerald-400" />
                      Descanso corto
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="min-h-8 text-[11px]"
                      onClick={() => onQuickAction("/descanso largo")}
                      title="Escribe /descanso largo en el chat"
                    >
                      <MoonIcon className="size-3 text-violet-600 dark:text-violet-400" />
                      Descanso largo
                    </Button>
                  </div>
                )}

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

              </section>
            )}

            {/* Contenido de la pestaña Escena / Misión & Pistas */}
            {activeTab === "escena" && currentScene && (() => {
              const progress = getAguasInquietasProgress(state);
              const altEndings = progress.endings.filter((e) => !e.isStandard);
              return (
                <div className="flex flex-col gap-2.5">
                  {/* Misión Principal */}
                  <section className="flex flex-col gap-2 rounded-xl border border-amber-500/35 bg-amber-500/[0.06] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 font-serif text-sm font-semibold text-amber-800 dark:text-amber-300">
                        <CompassIcon className="size-3.5" />
                        {progress.quest.titleEs}
                      </span>
                      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 font-mono text-[10px] font-medium text-amber-800 dark:text-amber-300">
                        Etapa {progress.currentStage.order}/{progress.quest.stages.length}
                      </span>
                    </div>
                    <p className="text-[11px] leading-relaxed text-foreground/90">
                      {progress.quest.objectiveEs}
                    </p>
                    <div className="flex flex-col gap-1 border-t border-amber-500/20 pt-2">
                      {progress.quest.stages
                        .filter(
                          (_st, idx) =>
                            idx <= progress.currentStageIndex || progress.completed,
                        )
                        .map((st, idx) => {
                          const isDone =
                            idx < progress.currentStageIndex || progress.completed;
                          const isCurrent =
                            idx === progress.currentStageIndex && !progress.completed;
                          return (
                            <div
                              key={st.id}
                              className={cn(
                                "flex items-start gap-1.5 text-[10.5px]",
                                isCurrent
                                  ? "font-medium text-foreground"
                                  : "text-emerald-700 line-through opacity-80 dark:text-emerald-400",
                              )}
                            >
                              <span className="mt-0.5 font-mono text-[9.5px]">
                                {isDone ? "✓" : "▸"}
                              </span>
                              <span>
                                {st.titleEs}
                                {isCurrent ? ` — ${st.goalEs}` : ""}
                              </span>
                            </div>
                          );
                        })}
                    </div>
                  </section>

                  {/* Escena actual + Pistas */}
                  <section className="flex flex-col gap-2 rounded-xl border border-border/80 bg-card/85 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-serif text-sm font-semibold">
                        {currentScene.titleEs}
                      </span>
                      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                        {progress.sceneDiscoveredCount}/{progress.sceneTotalClues} pistas
                      </span>
                    </div>
                    <p className="leading-relaxed text-muted-foreground">
                      {currentScene.summaryEs}
                    </p>

                    {unlockedIds.length > 0 ? (
                      <div className="mt-1 flex flex-col gap-1.5 border-t border-border/70 pt-2">
                        <span className="text-[11px] font-medium text-foreground">
                          Pistas descubiertas ({unlockedIds.length}/{progress.sceneTotalClues})
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
                              <p className="mt-0.5 text-[10px] italic text-emerald-800/85 dark:text-emerald-200/80">
                                {clue.tacticalEffectEs}
                              </p>
                            </div>
                          ))}
                      </div>
                    ) : (
                      <p className="border-t border-border/70 pt-2 text-[11px] text-muted-foreground">
                        {progress.sceneTotalClues > 0
                          ? `Hay ${progress.sceneTotalClues} pista(s) oculta(s) en esta escena.`
                          : "No hay pistas ocultas en esta escena."}
                      </p>
                    )}
                  </section>

                  {/* Finales alternativos desbloqueables por pistas */}
                  <section className="flex flex-col gap-1.5 rounded-xl border border-border/80 bg-card/85 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold text-foreground">
                        Finales alternativos
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {progress.discoveredCount}/{progress.totalClues} pistas
                      </span>
                    </div>
                    {altEndings.map((ending) => (
                      <div
                        key={ending.id}
                        className={cn(
                          "rounded-lg border px-2.5 py-1.5 text-[10.5px]",
                          ending.unlocked
                            ? "border-emerald-500/35 bg-emerald-500/10 text-foreground"
                            : "border-border/60 bg-background/50 text-muted-foreground",
                        )}
                      >
                        <div className="flex items-center justify-between gap-2 font-medium">
                          <span className="inline-flex items-center gap-1.5">
                            {ending.unlocked ? (
                              <CheckCircle2Icon className="size-3 text-emerald-600 dark:text-emerald-400" />
                            ) : (
                              <LockIcon className="size-3 opacity-70" />
                            )}
                            {ending.titleEs}
                          </span>
                          {ending.unlocked && (
                            <span className="font-mono text-[9.5px] text-emerald-700 dark:text-emerald-300">
                              DESBLOQUEADO
                            </span>
                          )}
                        </div>
                        {ending.unlocked && (
                          <p className="mt-1 text-[10px] leading-snug opacity-90">
                            {ending.summaryEs}
                          </p>
                        )}
                      </div>
                    ))}
                  </section>
                </div>
              );
            })()}

            {/* Contenido de la pestaña Memoria */}
            {activeTab === "memoria" && (
              <section className="flex flex-col gap-2 rounded-xl border border-border/80 bg-card/85 p-3">
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
                        <span className="font-mono text-[10px] tabular-nums text-amber-700 dark:text-amber-400">
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
              <section className="flex flex-col gap-2 rounded-xl border border-border/80 bg-card/85 p-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">
                    Historial (event_log)
                  </h3>
                  {activeEvents.length > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-[11px]"
                      onClick={() => {
                        playSound("navigation.backward");
                        void onRollback(0);
                      }}
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
                            onClick={() => {
                              playSound("navigation.backward");
                              void onRollback(ev.seq);
                            }}
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
    </>
  );
}
