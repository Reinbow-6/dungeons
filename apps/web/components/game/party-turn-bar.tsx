"use client";

import type { Character, CombatState } from "@dungeons/rules";
import {
  PauseIcon,
  PlayIcon,
  SendIcon,
  SkullIcon,
  SwordsIcon,
  Trash2Icon,
} from "lucide-react";

import { useSensoryUI } from "@/components/ui/sensory-ui/config/provider";
import { cn } from "@/lib/utils";

export function PartyTurnBar({
  characters,
  activeActorId,
  combat,
  isBusy,
  pausedMode,
  pausedCount,
  onSelectActor,
  onTogglePausedMode,
  onFlushPaused,
  onClearPaused,
}: {
  characters: readonly Character[];
  activeActorId: string;
  combat?: CombatState | null;
  isBusy: boolean;
  pausedMode: boolean;
  pausedCount: number;
  onSelectActor: (actorId: string) => void;
  onTogglePausedMode: () => void;
  onFlushPaused: () => void;
  onClearPaused: () => void;
}) {
  const { playSound } = useSensoryUI();

  if (characters.length <= 1) {
    return null;
  }

  const combatActive = Boolean(combat?.active);
  const currentCombatant = combatActive
    ? combat?.combatants[combat.turnIndex]
    : undefined;
  const currentCombatActorId =
    currentCombatant?.kind === "pc"
      ? (currentCombatant.actorId ?? currentCombatant.id)
      : undefined;

  return (
    <div className="flex flex-col gap-1.5 rounded-2xl border border-border/75 bg-card/85 px-2.5 py-2 shadow-xs backdrop-blur-sm">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <div
          role="group"
          aria-label="Seleccionar personaje que actúa"
          className="flex flex-wrap items-center gap-1"
        >
          {characters.map((char, idx) => {
            const isSelected = char.id === activeActorId;
            const isCombatTurn = currentCombatActorId === char.id;
            const shortName = char.name.trim().split(/\s+/)[0] ?? char.name;
            const isDown = char.hp.current === 0;

            return (
              <button
                key={char.id}
                type="button"
                disabled={isBusy}
                onClick={() => {
                  playSound("interaction.subtle");
                  onSelectActor(char.id);
                }}
                title={`${char.name}${char.playerName ? ` (${char.playerName})` : ""} · Atajo Alt+${idx + 1}`}
                aria-pressed={isSelected}
                className={cn(
                  "inline-flex min-h-7 items-center gap-1.5 rounded-xl border px-2 py-1 text-[11px] transition-all disabled:opacity-50",
                  isSelected
                    ? "border-amber-500/60 bg-amber-500/15 font-semibold text-foreground shadow-xs"
                    : "border-border/70 bg-background/60 text-muted-foreground hover:border-border hover:text-foreground",
                  isCombatTurn && "ring-1 ring-rose-500/60",
                )}
              >
                <span className="font-mono text-[9.5px] opacity-65">
                  {idx + 1}
                </span>
                {isCombatTurn && (
                  <SwordsIcon className="size-3 shrink-0 animate-pulse text-rose-500" />
                )}
                {isDown && (
                  <SkullIcon className="size-3 shrink-0 text-rose-500" />
                )}
                <span className="max-w-24 truncate">
                  {shortName}
                  {char.playerName ? (
                    <span className="ml-1 font-normal text-muted-foreground">
                      ({char.playerName})
                    </span>
                  ) : null}
                </span>
                <span
                  className={cn(
                    "font-mono text-[9.5px] tabular-nums",
                    isDown ? "text-rose-500" : "text-muted-foreground",
                  )}
                >
                  {char.hp.current}/{char.hp.max}
                </span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          disabled={isBusy || (combatActive && !pausedMode)}
          onClick={() => {
            playSound("interaction.toggle");
            onTogglePausedMode();
          }}
          aria-pressed={pausedMode}
          title={
            combatActive
              ? "Modo pausado disponible fuera de combate (o enviá lo pendiente)"
              : "DM en pausa: varios jugadores mandan acciones/diálogos libremente antes de enviar todo al DM"
          }
          className={cn(
            "inline-flex min-h-7 shrink-0 items-center gap-1 rounded-xl border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-45",
            pausedMode
              ? "border-amber-500/60 bg-amber-500/20 text-amber-800 dark:text-amber-200"
              : "border-border/70 bg-background/60 text-muted-foreground hover:text-foreground",
          )}
        >
          {pausedMode ? (
            <>
              <PlayIcon className="size-3" />
              <span>DM en pausa</span>
            </>
          ) : (
            <>
              <PauseIcon className="size-3" />
              <span>Pausar DM</span>
            </>
          )}
        </button>
      </div>

      {(pausedMode || pausedCount > 0) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-1.5 text-[11px]">
          <span className="text-muted-foreground">
            {pausedCount === 0
              ? "DM en pausa: escribí turnos o roleo entre jugadores sin gastar llamadas al DM."
              : `${pausedCount} ${pausedCount === 1 ? "mensaje acumulado" : "mensajes acumulados"} sin enviar al DM.`}
          </span>

          <div className="ml-auto flex items-center gap-1.5">
            {pausedCount > 0 && (
              <button
                type="button"
                disabled={isBusy}
                onClick={() => {
                  playSound("interaction.tap");
                  onClearPaused();
                }}
                className="inline-flex h-7 items-center gap-1 rounded-lg border border-border/70 bg-background/60 px-2 text-[10.5px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
              >
                <Trash2Icon className="size-3" />
                Descartar
              </button>
            )}
            <button
              type="button"
              disabled={isBusy || pausedCount === 0}
              onClick={() => {
                playSound("interaction.confirm");
                onFlushPaused();
              }}
              className="inline-flex h-7 items-center gap-1 rounded-lg bg-amber-500 px-2.5 text-[11px] font-semibold text-amber-950 transition-colors hover:bg-amber-400 disabled:opacity-45"
            >
              <SendIcon className="size-3" />
              Enviar al DM{pausedCount > 0 ? ` (${pausedCount})` : ""}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
