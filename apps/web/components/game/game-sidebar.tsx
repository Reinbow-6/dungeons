"use client";

import {
  AGUAS_QUIETAS_PACK,
  CORE_SPELLS_521,
  getAbilityModifier,
  getAdventureProgress,
  getCheckModifier,
  getEffectiveAc,
  getEffectiveSpeed,
  getSpellcastingStats,
  type AdventurePack,
  type GameEvent,
  type GameState,
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
  ShieldIcon,
  SkullIcon,
  SparklesIcon,
  UserIcon,
  UserPlusIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import * as React from "react";

import { CombatTracker } from "@/components/game/combat-tracker";
import { Button } from "@/components/ui/button";
import { useSensoryUI } from "@/components/ui/sensory-ui/config/provider";
import type {
  CharacterPresetId,
  CharacterPresetInfo,
} from "@/lib/game/presets";
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
  adventurePack,
  events,
  sessionSummaries = [],
  memoryFacts = [],
  presets,
  activeActorId,
  onSelectActor,
  onAddPartyMember,
  onRemovePartyMember,
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
  adventurePack?: AdventurePack | null;
  events: GameEvent[];
  sessionSummaries?: SessionSummaryItem[];
  memoryFacts?: StoredMemoryFact[];
  presets: CharacterPresetInfo[];
  activeActorId?: string | null;
  onSelectActor?: (actorId: string) => void;
  onAddPartyMember?: (
    presetId: CharacterPresetId,
    playerName?: string,
  ) => Promise<void>;
  onRemovePartyMember?: (actorId: string) => Promise<void>;
  onStartNewSession: () => Promise<void>;
  onToggleMode: (mode: "digital" | "hybrid") => Promise<void>;
  onRollback: (targetSeq: number) => Promise<void>;
  onQuickAction?: (prompt: string) => void;
}) {
  const { playSound } = useSensoryUI();
  const [showAddMember, setShowAddMember] = React.useState(false);
  const [addPresetId, setAddPresetId] =
    React.useState<CharacterPresetId>("pc_brenna");
  const [addPlayerName, setAddPlayerName] = React.useState("");
  const [partyBusy, setPartyBusy] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState<SidebarTab>("ficha");
  const [sessionBusy, setSessionBusy] = React.useState(false);

  const partyChars = React.useMemo(
    () => (state ? Object.values(state.characters) : []),
    [state],
  );
  const activeChar =
    (activeActorId && state ? state.characters[activeActorId] : undefined) ??
    partyChars[0];
  const unusedPresets = React.useMemo(() => {
    const taken = new Set(partyChars.map((c) => c.id));
    return presets.filter((p) => !taken.has(p.id));
  }, [partyChars, presets]);
  const isGroup = partyChars.length > 1;
  const combatActive = Boolean(state?.combat?.active);
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

  async function handleAddMember() {
    if (!onAddPartyMember || partyBusy) return;
    const targetPreset =
      unusedPresets.find((p) => p.id === addPresetId)?.id ??
      unusedPresets[0]?.id;
    if (!targetPreset) return;
    setPartyBusy(true);
    try {
      await onAddPartyMember(targetPreset, addPlayerName.trim() || undefined);
      setAddPlayerName("");
      setShowAddMember(false);
    } finally {
      setPartyBusy(false);
    }
  }

  async function handleRemoveMember(actorId: string) {
    if (!onRemovePartyMember || partyBusy) return;
    setPartyBusy(true);
    try {
      await onRemovePartyMember(actorId);
    } finally {
      setPartyBusy(false);
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
  const activeEffAc = activeChar ? getEffectiveAc(activeChar) : null;
  const activeEffSpeed = activeChar ? getEffectiveSpeed(activeChar) : null;

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
          "fixed inset-y-0 right-0 z-40 flex w-[360px] max-w-[92vw] flex-col rounded-none bg-sidebar text-xs text-sidebar-foreground shadow-2xl transition-[transform,width] duration-200 ease-out lg:static lg:inset-auto lg:z-auto lg:h-full lg:max-w-none lg:shrink-0 lg:translate-x-0 lg:shadow-none",
          open
            ? "translate-x-0 border-l border-border lg:w-[360px]"
            : "pointer-events-none translate-x-full border-l-0 lg:w-0 lg:overflow-hidden lg:border-l-0",
        )}
      >
        <div className="flex h-full min-h-0 w-full flex-col divide-y divide-border overflow-y-auto lg:w-[360px] lg:shrink-0">
          {/* Cabecera de campaña + cierre del drawer */}
          <section className="flex flex-col gap-2.5 rounded-none bg-card/70 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5">
                <h2 className="truncate font-serif text-base font-semibold tracking-tight">
                  {adventurePack?.titleEs ?? "Aguas Quietas"}
                </h2>
                <span className="rounded-none border border-border bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                  #{sessionNumber}
                </span>
                {state && (
                  <span className="rounded-none border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-amber-700 dark:text-amber-300">
                    {state.ruleset}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {state && (
                  <span className="rounded-none border border-border bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] font-medium tabular-nums text-muted-foreground">
                    seq {state.lastSeq}
                  </span>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="size-7 rounded-none text-muted-foreground hover:text-foreground"
                  onClick={handleClose}
                  title="Cerrar panel (Esc / Alt+H)"
                  aria-label="Cerrar panel lateral"
                >
                  <XIcon className="size-4" />
                </Button>
              </div>
            </div>

            {campaignId && (
              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 flex-1 rounded-none text-[11px]"
                  onClick={handleRotateSession}
                  disabled={sessionBusy}
                  title="Cierra la sesión actual guardando un resumen y abre la siguiente"
                >
                  {sessionBusy
                    ? "Cerrando…"
                    : `Cerrar sesión → #${sessionNumber + 1}`}
                </Button>
              </div>
            )}
          </section>

          {/* Combate activo anclado arriba cuando corresponde */}
          {state?.combat?.active && (
            <div className="p-3">
              <CombatTracker combat={state.combat} />
            </div>
          )}

          {/* Tarjeta HUD del Personaje Activo + Selector de Grupo Local */}
          {state && activeChar && campaignId && (
            <section className="flex flex-col gap-2.5 rounded-none bg-card/50 p-3">
              {/* Barra de integrantes de la mesa local + botón + Sumar PJ */}
              <div className="flex flex-col gap-1.5 border-b border-border pb-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    <UsersIcon className="size-3 text-amber-500" />
                    Mesa local ({partyChars.length}/4)
                  </span>
                  {onAddPartyMember &&
                    partyChars.length < 4 &&
                    !combatActive &&
                    unusedPresets.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          playSound("interaction.subtle");
                          setAddPresetId(unusedPresets[0]!.id);
                          setShowAddMember((prev) => !prev);
                        }}
                        className="inline-flex items-center gap-1 rounded-none border border-amber-500/35 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 hover:bg-amber-500/20 dark:text-amber-300"
                      >
                        <UserPlusIcon className="size-2.5" />
                        Sumar PJ
                      </button>
                    )}
                </div>

                {partyChars.length > 1 && (
                  <div className="flex flex-wrap gap-1">
                    {partyChars.map((ch) => {
                      const selected = ch.id === activeChar.id;
                      const first = ch.name.trim().split(/\s+/)[0] ?? ch.name;
                      return (
                        <div
                          key={ch.id}
                          className={cn(
                            "inline-flex items-center rounded-none border text-[11px] transition-colors",
                            selected
                              ? "border-amber-500/60 border-l-2 border-l-primary bg-amber-500/15 font-semibold text-foreground"
                              : "border-border bg-background/60 text-muted-foreground hover:text-foreground",
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              playSound("interaction.subtle");
                              onSelectActor?.(ch.id);
                            }}
                            className="rounded-none px-2 py-1 text-left"
                          >
                            <span>{first}</span>
                            {ch.playerName ? (
                              <span className="ml-1 font-normal opacity-75">
                                ({ch.playerName})
                              </span>
                            ) : null}
                            <span className="ml-1 font-mono text-[9.5px] opacity-80">
                              {ch.hp.current}/{ch.hp.max}
                            </span>
                          </button>
                          {onRemovePartyMember && !combatActive && (
                            <button
                              type="button"
                              disabled={partyBusy}
                              aria-label={`Retirar a ${ch.name}`}
                              title={`Retirar a ${ch.name} de la mesa`}
                              onClick={() => void handleRemoveMember(ch.id)}
                              className="rounded-none border-l border-border/60 px-1.5 py-1 text-muted-foreground hover:text-rose-500 disabled:opacity-40"
                            >
                              <XIcon className="size-2.5" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {showAddMember && unusedPresets.length > 0 && (
                  <div className="flex flex-col gap-1.5 rounded-none border border-border bg-background/80 p-2">
                    <select
                      className="h-7 rounded-none border border-border bg-background px-2 text-[11px]"
                      value={addPresetId}
                      onChange={(e) =>
                        setAddPresetId(e.target.value as CharacterPresetId)
                      }
                    >
                      {unusedPresets.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} — {p.className}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      maxLength={40}
                      value={addPlayerName}
                      onChange={(e) => setAddPlayerName(e.target.value)}
                      placeholder="Nombre del jugador (opcional)"
                      className="h-7 rounded-none border border-border bg-background px-2 text-[11px]"
                    />
                    <div className="flex justify-end gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-6 rounded-none px-2 text-[10.5px]"
                        onClick={() => setShowAddMember(false)}
                      >
                        Cancelar
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={partyBusy}
                        className="h-6 rounded-none px-2.5 text-[10.5px]"
                        onClick={() => void handleAddMember()}
                      >
                        {partyBusy ? "Sumando…" : "Agregar a la mesa"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="mb-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    Ficha del personaje
                    {activeChar.playerName ? ` · ${activeChar.playerName}` : ""}
                  </p>
                  <h3 className="truncate font-serif text-base font-semibold tracking-tight text-amber-700 dark:text-amber-300">
                    {activeChar.name}
                  </h3>
                  <p className="text-[11px] text-muted-foreground">
                    {activeChar.species} · {activeChar.className} Nv.{" "}
                    {activeChar.level}
                  </p>
                </div>

                {/* Segmented Mode Control (Digital | Híbrido) — Modo global de mesa */}
                <div
                  role="group"
                  aria-label={
                    isGroup
                      ? "Modo de tiradas de la mesa"
                      : "Modo de tiradas del personaje"
                  }
                  title={
                    isGroup
                      ? "Aplica a todos los personajes de la mesa"
                      : "Modo de tiradas"
                  }
                  className="inline-flex shrink-0 rounded-none border border-border bg-muted/60 p-0.5 text-[11px]"
                >
                  <button
                    type="button"
                    aria-pressed={activeChar.rollAuthority !== "player-declared"}
                    onClick={() => {
                      if (activeChar.rollAuthority === "player-declared") {
                        playSound("interaction.toggle");
                        void onToggleMode("digital");
                      }
                    }}
                    className={cn(
                      "min-h-7 rounded-none px-2 py-0.5 font-medium transition-colors",
                      activeChar.rollAuthority !== "player-declared"
                        ? "bg-background text-foreground"
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
                        void onToggleMode("hybrid");
                      }
                    }}
                    className={cn(
                      "min-h-7 rounded-none px-2 py-0.5 font-medium transition-colors",
                      activeChar.rollAuthority === "player-declared"
                        ? "bg-amber-500/20 text-amber-700 dark:text-amber-300"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    Híbrido
                  </button>
                </div>
              </div>

              {/* Barra visual de PG + CA / VEL / Hit Dice */}
              <div className="grid grid-cols-5 gap-px rounded-none border border-border bg-border">
                <div className="col-span-2 flex flex-col justify-between gap-1.5 rounded-none bg-background/85 p-2">
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
                  <div className="h-1.5 w-full overflow-hidden rounded-none bg-muted">
                    <div
                      className={cn(
                        "h-full rounded-none transition-all",
                        getHpBarColor(activeChar.hp.current, activeChar.hp.max),
                      )}
                      style={{ width: `${hpPct}%` }}
                    />
                  </div>
                </div>

                <div
                  className="flex flex-col items-center justify-center rounded-none bg-background/85 p-1.5"
                  title={
                    activeEffAc && activeEffAc.effectiveAc !== activeChar.ac
                      ? activeEffAc.breakdown
                          .filter((b) => !b.ignored)
                          .map((b) => `${b.labelEs} ${b.value >= 0 ? `+${b.value}` : b.value}`)
                          .join(" · ")
                      : `Clase de Armadura ${activeChar.ac}`
                  }
                >
                  <span className="flex items-center gap-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
                    <ShieldIcon className="size-2.5" />
                    CA
                  </span>
                  <span
                    className={cn(
                      "font-mono text-sm font-semibold tabular-nums",
                      activeEffAc &&
                        activeEffAc.effectiveAc !== activeChar.ac &&
                        "text-sky-600 dark:text-sky-400",
                    )}
                  >
                    {activeEffAc ? activeEffAc.effectiveAc : activeChar.ac}
                  </span>
                </div>

                <div
                  className="flex flex-col items-center justify-center rounded-none bg-background/85 p-1.5"
                  title={
                    activeEffSpeed &&
                    activeEffSpeed.effectiveSpeed !== activeChar.speed
                      ? `Base ${activeChar.speed} · ${activeEffSpeed.breakdown
                          .filter((b) => !b.ignored && b.slug !== "speed:base")
                          .map((b) => `${b.labelEs} ${b.value >= 0 ? `+${b.value}` : b.value}`)
                          .join(" · ")}`
                      : `Velocidad ${activeChar.speed} pies`
                  }
                >
                  <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
                    VEL
                  </span>
                  <span
                    className={cn(
                      "font-mono text-sm font-semibold tabular-nums",
                      activeEffSpeed &&
                        activeEffSpeed.effectiveSpeed !== activeChar.speed &&
                        (activeEffSpeed.effectiveSpeed < activeChar.speed
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-sky-600 dark:text-sky-400"),
                    )}
                  >
                    {activeEffSpeed
                      ? activeEffSpeed.effectiveSpeed
                      : activeChar.speed}
                  </span>
                </div>

                <div className="flex flex-col items-center justify-center rounded-none bg-background/85 p-1.5">
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
                <div className="flex flex-col gap-1.5 rounded-none border border-rose-500/45 border-l-2 border-l-rose-500 bg-rose-500/10 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 font-semibold text-rose-700 dark:text-rose-300">
                      <SkullIcon className="size-3.5" />
                      Salvaciones de muerte
                    </span>
                    <span className="rounded-none border border-rose-500/35 bg-rose-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-rose-700 dark:text-rose-200">
                      {activeChar.deathSaves?.failures === 3
                        ? "MUERTO"
                        : activeChar.deathSaves?.stable
                          ? "ESTABLE"
                          : "MORIBUNDO"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between font-mono text-[11px] tabular-nums">
                    <span
                      className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400"
                      aria-label={`Éxitos: ${activeChar.deathSaves?.successes ?? 0} de 3`}
                    >
                      <span>Éxitos</span>
                      <span className="inline-flex items-center gap-1">
                        {[0, 1, 2].map((idx) => {
                          const filled =
                            idx < (activeChar.deathSaves?.successes ?? 0);
                          return (
                            <span
                              key={idx}
                              aria-hidden
                              className={cn(
                                "inline-block size-2 rounded-none border",
                                filled
                                  ? "border-emerald-500 bg-emerald-500"
                                  : "border-emerald-500/40 bg-transparent",
                              )}
                            />
                          );
                        })}
                      </span>
                    </span>
                    <span
                      className="inline-flex items-center gap-1.5 text-rose-600 dark:text-rose-400"
                      aria-label={`Fallos: ${activeChar.deathSaves?.failures ?? 0} de 3`}
                    >
                      <span>Fallos</span>
                      <span className="inline-flex items-center gap-1">
                        {[0, 1, 2].map((idx) => {
                          const filled =
                            idx < (activeChar.deathSaves?.failures ?? 0);
                          return (
                            <span
                              key={idx}
                              aria-hidden
                              className={cn(
                                "inline-block size-2 rounded-none border",
                                filled
                                  ? "border-rose-500 bg-rose-500"
                                  : "border-rose-500/40 bg-transparent",
                              )}
                            />
                          );
                        })}
                      </span>
                    </span>
                  </div>
                  {onQuickAction &&
                    !activeChar.deathSaves?.stable &&
                    (activeChar.deathSaves?.failures ?? 0) < 3 && (
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        className="mt-0.5 h-7 w-full rounded-none text-[11px]"
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

              {/* Condiciones, agotamiento, concentración o efectos activos */}
              {(activeChar.conditions.length > 0 ||
                activeChar.exhaustionLevel > 0 ||
                activeChar.concentratingOn ||
                (activeChar.activeEffects && activeChar.activeEffects.length > 0)) && (
                <div className="flex flex-wrap gap-1">
                  {activeChar.activeEffects?.map((ef) => (
                    <span
                      key={ef.id}
                      className="rounded-none border border-sky-500/35 bg-sky-500/10 px-1.5 py-0.5 font-mono text-[10px] text-sky-700 dark:text-sky-300"
                      title={
                        ef.concentrationSpell
                          ? `Concentración: ${ef.concentrationSpell}`
                          : ef.labelEs
                      }
                    >
                      {ef.labelEs}
                      {ef.remainingRounds !== null
                        ? ` (${ef.remainingRounds}r)`
                        : ""}
                    </span>
                  ))}
                  {activeChar.conditions.map((cond) => (
                    <span
                      key={cond}
                      className="rounded-none border border-rose-500/35 bg-rose-500/10 px-1.5 py-0.5 font-mono text-[10px] text-rose-700 dark:text-rose-300"
                    >
                      {cond}
                    </span>
                  ))}
                  {activeChar.exhaustionLevel > 0 && (
                    <span className="rounded-none border border-amber-500/35 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-amber-700 dark:text-amber-300">
                      Agotamiento {activeChar.exhaustionLevel}
                    </span>
                  )}
                  {activeChar.concentratingOn && (
                    <span className="rounded-none border border-violet-500/35 bg-violet-500/10 px-1.5 py-0.5 text-[10px] text-violet-700 dark:text-violet-300">
                      Conc: {activeChar.concentratingOn}
                    </span>
                  )}
                </div>
              )}

              {/* Grilla de características 6x1 */}
              <div className="grid grid-cols-6 gap-px rounded-none border border-border bg-border text-center font-mono tabular-nums">
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
                      className="rounded-none bg-background/85 py-1"
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
            <div className="flex flex-col">
              <div
                role="tablist"
                aria-label="Secciones de campaña"
                className="grid grid-cols-4 border-b border-border bg-muted/35"
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
                        "flex min-h-9 items-center justify-center gap-1 rounded-none border-b-2 px-1.5 py-1.5 text-[11px] font-medium transition-colors",
                        selected
                          ? "border-primary bg-card/80 text-foreground"
                          : "border-transparent text-muted-foreground hover:bg-muted/40 hover:text-foreground",
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

              <div className="p-3">
                {/* Contenido de la pestaña Ficha */}
                {activeTab === "ficha" && activeChar && campaignId && (
                  <section className="flex flex-col gap-3 rounded-none border border-border bg-card/85 p-3">
                    {/* Grimorio y Espacios de Conjuro (si es lanzador) */}
                    {spellStats && (
                      <div className="flex flex-col gap-2 border-b border-border pb-3">
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
                                className="flex items-center gap-1.5 rounded-none border border-violet-500/30 bg-violet-500/10 px-2 py-1 font-mono text-[10px] tabular-nums"
                              >
                                <span className="text-muted-foreground">
                                  Nv.{lvl}
                                </span>
                                <span className="inline-flex items-center gap-0.5">
                                  {Array.from(
                                    { length: pool.max },
                                    (_, idx) => {
                                      const filled = idx < pool.current;
                                      return (
                                        <span
                                          key={idx}
                                          aria-hidden
                                          className={cn(
                                            "inline-block size-2 rounded-none border",
                                            filled
                                              ? "border-violet-500 bg-violet-500"
                                              : "border-violet-500/40 bg-transparent",
                                          )}
                                        />
                                      );
                                    },
                                  )}
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
                                    className="rounded-none border border-violet-500/30 bg-background/70 px-1.5 py-0.5 text-[10.5px] text-foreground/90 transition-colors hover:border-violet-400/60 hover:bg-violet-500/10"
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
                      <div className="grid grid-cols-2 gap-1.5 border-b border-border pb-3">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="min-h-8 rounded-none text-[11px]"
                          onClick={() => onQuickAction("/descanso corto")}
                          title="Escribe /descanso corto en el chat"
                        >
                          <MoonIcon className="size-3 text-emerald-600 dark:text-emerald-400" />
                          {isGroup ? "Descanso corto (grupo)" : "Descanso corto"}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="min-h-8 rounded-none text-[11px]"
                          onClick={() => onQuickAction("/descanso largo")}
                          title="Escribe /descanso largo en el chat"
                        >
                          <MoonIcon className="size-3 text-violet-600 dark:text-violet-400" />
                          {isGroup ? "Descanso largo (grupo)" : "Descanso largo"}
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
                              className="rounded-none border border-border bg-background/70 px-1.5 py-0.5 font-mono text-[11px] tabular-nums"
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

                    <div className="border-t border-border pt-2.5">
                      <span className="text-[11px] font-medium text-muted-foreground">
                        Inventario
                      </span>
                      <ul className="mt-1.5 flex flex-col divide-y divide-border/70 border border-border text-foreground/90">
                        {activeChar.inventory.map((item) => (
                          <li
                            key={item.itemId}
                            className="flex items-center justify-between rounded-none bg-background/60 px-2 py-1"
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
                {activeTab === "escena" &&
                  currentScene &&
                  (() => {
                    const progress = getAdventureProgress(
                      state,
                      adventurePack ?? AGUAS_QUIETAS_PACK,
                    );
                    const altEndings = progress.endings.filter(
                      (e) => !e.isStandard,
                    );
                    return (
                      <div className="flex flex-col gap-2.5">
                        {/* Misión Principal */}
                        <section className="flex flex-col gap-2 rounded-none border border-amber-500/35 border-l-2 border-l-amber-500 bg-amber-500/[0.06] p-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="inline-flex items-center gap-1.5 font-serif text-sm font-semibold text-amber-800 dark:text-amber-300">
                              <CompassIcon className="size-3.5" />
                              {progress.quest.titleEs}
                            </span>
                            <span className="rounded-none border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 font-mono text-[10px] font-medium text-amber-800 dark:text-amber-300">
                              Etapa {progress.currentStage.order}/
                              {progress.quest.stages.length}
                            </span>
                          </div>
                          <p className="text-[11px] leading-relaxed text-foreground/90">
                            {progress.quest.objectiveEs}
                          </p>
                          <div className="flex flex-col gap-1 border-t border-amber-500/20 pt-2">
                            {progress.quest.stages
                              .filter(
                                (_st, idx) =>
                                  idx <= progress.currentStageIndex ||
                                  progress.completed,
                              )
                              .map((st, idx) => {
                                const isDone =
                                  idx < progress.currentStageIndex ||
                                  progress.completed;
                                const isCurrent =
                                  idx === progress.currentStageIndex &&
                                  !progress.completed;
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
                        <section className="flex flex-col gap-2 rounded-none border border-border bg-card/85 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-serif text-sm font-semibold">
                              {currentScene.titleEs}
                            </span>
                            <span className="rounded-none border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                              {progress.sceneDiscoveredCount}/
                              {progress.sceneTotalClues} pistas
                            </span>
                          </div>
                          <p className="leading-relaxed text-muted-foreground">
                            {currentScene.summaryEs}
                          </p>

                          {unlockedIds.length > 0 ? (
                            <div className="mt-1 flex flex-col gap-1.5 border-t border-border pt-2">
                              <span className="text-[11px] font-medium text-foreground">
                                Pistas descubiertas ({unlockedIds.length}/
                                {progress.sceneTotalClues})
                              </span>
                              {currentScene.clues
                                .filter((c) => unlockedIds.includes(c.id))
                                .map((clue) => (
                                  <div
                                    key={clue.id}
                                    className="rounded-none border border-emerald-500/30 border-l-2 border-l-emerald-500 bg-emerald-500/10 px-2.5 py-1.5"
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
                            <p className="border-t border-border pt-2 text-[11px] text-muted-foreground">
                              {progress.sceneTotalClues > 0
                                ? `Hay ${progress.sceneTotalClues} pista(s) oculta(s) en esta escena.`
                                : "No hay pistas ocultas en esta escena."}
                            </p>
                          )}
                        </section>

                        {/* Finales alternativos desbloqueables por pistas */}
                        <section className="flex flex-col gap-1.5 rounded-none border border-border bg-card/85 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-semibold text-foreground">
                              Finales alternativos
                            </span>
                            <span className="font-mono text-[10px] text-muted-foreground">
                              {progress.discoveredCount}/{progress.totalClues}{" "}
                              pistas
                            </span>
                          </div>
                          {altEndings.map((ending) => (
                            <div
                              key={ending.id}
                              className={cn(
                                "rounded-none border px-2.5 py-1.5 text-[10.5px]",
                                ending.unlocked
                                  ? "border-emerald-500/35 border-l-2 border-l-emerald-500 bg-emerald-500/10 text-foreground"
                                  : "border-border bg-background/50 text-muted-foreground",
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
                  <section className="flex flex-col gap-2 rounded-none border border-border bg-card/85 p-3">
                    <div className="flex items-center justify-between gap-2 border-b border-border pb-2">
                      <h3 className="text-sm font-semibold">
                        Memoria de campaña
                      </h3>
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
                            className="rounded-none border border-border bg-background/60 px-2.5 py-1.5 text-[11px]"
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
                      <div className="flex flex-col gap-1.5 border-t border-border pt-2">
                        <span className="text-[11px] font-medium text-muted-foreground">
                          Sesiones cerradas
                        </span>
                        {closedRecaps.slice(-4).map((recap) => (
                          <p
                            key={recap.id}
                            className="rounded-none border border-border bg-muted/30 px-2.5 py-1.5 text-[11px] text-muted-foreground"
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
                  <section className="flex flex-col gap-2 rounded-none border border-border bg-card/85 p-3">
                    <div className="flex items-center justify-between gap-2 border-b border-border pb-2">
                      <h3 className="text-sm font-semibold">
                        Historial (event_log)
                      </h3>
                      {activeEvents.length > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 rounded-none text-[11px]"
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
                      <ul className="flex flex-col divide-y divide-border border border-border">
                        {activeEvents
                          .slice()
                          .reverse()
                          .slice(0, 14)
                          .map((ev) => (
                            <li
                              key={ev.id}
                              className="flex items-center justify-between gap-2 rounded-none bg-background/60 px-2.5 py-1.5"
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
                                className="h-7 rounded-none px-2 text-[11px]"
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
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
