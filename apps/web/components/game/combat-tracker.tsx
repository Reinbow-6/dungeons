"use client";

import type { Combatant, CombatState } from "@dungeons/rules";
import { ChevronRight, Shield, Skull, Swords } from "lucide-react";

function getHpBarColor(current: number, max: number): string {
  if (current <= 0) return "bg-destructive";
  const ratio = max > 0 ? current / max : 0;
  if (ratio > 0.5) return "bg-emerald-500";
  if (ratio > 0.25) return "bg-amber-500";
  return "bg-rose-500";
}

function getKindBadge(kind: Combatant["kind"]): {
  label: string;
  className: string;
} {
  if (kind === "pc") {
    return {
      label: "PJ",
      className:
        "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30",
    };
  }
  if (kind === "ally") {
    return {
      label: "Aliado",
      className:
        "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
    };
  }
  return {
    label: "Enemigo",
    className:
      "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30",
  };
}

export function CombatTracker({
  combat,
}: {
  combat: CombatState | null | undefined;
}) {
  if (!combat || !combat.active) {
    return null;
  }

  const activeCombatant = combat.combatants[combat.turnIndex];

  return (
    <section
      aria-label="Rastreador de combate"
      className="flex flex-col gap-2.5 rounded-xl border border-rose-500/30 bg-card/90 p-3 shadow-xs"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Swords className="size-3.5 text-rose-600 dark:text-rose-400" />
          <h3 className="text-sm font-semibold">Combate activo</h3>
        </div>
        <span className="rounded-md bg-rose-500/15 px-2 py-0.5 font-mono text-[11px] font-semibold text-rose-700 dark:text-rose-300">
          Ronda {combat.round}
        </span>
      </div>

      {activeCombatant && !activeCombatant.defeated && (
        <div className="flex items-center gap-1.5 rounded-md bg-muted/70 px-2 py-1 text-[11px]">
          <ChevronRight className="size-3.5 shrink-0 text-primary" />
          <span className="text-muted-foreground">Turno actual:</span>
          <span className="truncate font-semibold text-foreground">
            {activeCombatant.name}
          </span>
        </div>
      )}

      <ul className="flex flex-col gap-1.5">
        {combat.combatants.map((c, idx) => {
          const isCurrentTurn = idx === combat.turnIndex && !c.defeated;
          const hpPercent =
            c.hp.max > 0
              ? Math.max(0, Math.min(100, Math.round((c.hp.current / c.hp.max) * 100)))
              : 0;
          const kindBadge = getKindBadge(c.kind);

          return (
            <li
              key={c.id}
              className={[
                "flex flex-col gap-1.5 rounded-lg border px-2.5 py-2 transition-colors",
                isCurrentTurn
                  ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                  : "border-border bg-muted/20",
                c.defeated ? "opacity-60" : "",
              ].join(" ")}
            >
              <div className="flex items-center justify-between gap-1.5">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span
                    className="inline-flex size-5 shrink-0 items-center justify-center rounded bg-muted font-mono text-[10px] font-semibold"
                    title={`Iniciativa ${c.initiative}`}
                  >
                    {c.initiative}
                  </span>
                  <span
                    className={[
                      "truncate font-medium",
                      c.defeated ? "line-through text-muted-foreground" : "",
                    ].join(" ")}
                  >
                    {c.name}
                  </span>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <span
                    className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${kindBadge.className}`}
                  >
                    {kindBadge.label}
                  </span>
                  {isCurrentTurn && (
                    <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                      Turno
                    </span>
                  )}
                  {c.defeated && (
                    <span className="inline-flex items-center gap-0.5 rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">
                      <Skull className="size-2.5" />
                      Derrotado
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full transition-all ${getHpBarColor(c.hp.current, c.hp.max)}`}
                    style={{ width: `${hpPercent}%` }}
                  />
                </div>
                <span className="shrink-0 font-mono text-[11px] font-medium">
                  {c.hp.current}/{c.hp.max} PG
                </span>
                <span
                  className="inline-flex shrink-0 items-center gap-0.5 rounded border bg-background px-1 py-0.5 font-mono text-[10px] text-muted-foreground"
                  title={`Clase de Armadura ${c.ac}`}
                >
                  <Shield className="size-2.5" />
                  CA {c.ac}
                </span>
              </div>

              {(c.vulnerabilities.length > 0 ||
                c.immunities.length > 0 ||
                (c.resistances && c.resistances.length > 0) ||
                (c.conditions && c.conditions.length > 0)) && (
                <div className="flex flex-wrap gap-1 text-[10px] text-muted-foreground">
                  {c.vulnerabilities.length > 0 && (
                    <span className="rounded bg-amber-500/10 px-1 py-0.5 text-amber-700 dark:text-amber-300">
                      Vuln: {c.vulnerabilities.join(", ")}
                    </span>
                  )}
                  {c.resistances && c.resistances.length > 0 && (
                    <span className="rounded bg-indigo-500/10 px-1 py-0.5 text-indigo-700 dark:text-indigo-300">
                      Res: {c.resistances.join(", ")}
                    </span>
                  )}
                  {c.immunities.length > 0 && (
                    <span className="rounded bg-muted px-1 py-0.5">
                      Inmune: {c.immunities.join(", ")}
                    </span>
                  )}
                  {c.conditions && c.conditions.length > 0 && (
                    <span className="rounded bg-rose-500/10 px-1 py-0.5 text-rose-700 dark:text-rose-300">
                      Cond: {c.conditions.join(", ")}
                    </span>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
