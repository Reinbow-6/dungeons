"use client";

import { CheckCircle2Icon, DicesIcon, XCircleIcon } from "lucide-react";

import type { ModifierBreakdownItem } from "@/agent/types";
import { cn } from "@/lib/utils";
import type { ChatMessagePart, DmToolPart } from "@/tools";

export type DiceRollToolPart = Extract<
  DmToolPart,
  | { type: "tool-resolve_check" }
  | { type: "tool-resolve_save" }
  | { type: "tool-declare_check" }
  | { type: "tool-investigate" }
  | { type: "tool-death_save" }
>;

export type ResolvedDiceRollToolPart = Extract<
  DiceRollToolPart,
  { state: "output-available" }
>;

export function isDiceRollToolPart(
  part: ChatMessagePart,
): part is ResolvedDiceRollToolPart {
  return (
    (part.type === "tool-resolve_check" ||
      part.type === "tool-resolve_save" ||
      part.type === "tool-declare_check" ||
      part.type === "tool-investigate" ||
      part.type === "tool-death_save") &&
    part.state === "output-available"
  );
}

const SKILL_LABELS_ES: Record<string, string> = {
  acrobatics: "Acrobacias",
  animal_handling: "Trato con animales",
  arcana: "Arcano",
  athletics: "Atletismo",
  deception: "Engaño",
  history: "Historia",
  insight: "Perspicacia",
  intimidation: "Intimidación",
  investigation: "Investigación",
  medicine: "Medicina",
  nature: "Naturaleza",
  perception: "Percepción",
  performance: "Interpretación",
  persuasion: "Persuasión",
  religion: "Religión",
  sleight_of_hand: "Juego de manos",
  stealth: "Sigilo",
  survival: "Supervivencia",
  str: "Fuerza",
  dex: "Destreza",
  con: "Constitución",
  int: "Inteligencia",
  wis: "Sabiduría",
  cha: "Carisma",
};

function labelSkill(raw?: string): string {
  if (!raw) return "Prueba";
  return SKILL_LABELS_ES[raw] ?? raw;
}

function formatMod(mod: number): string {
  return mod >= 0 ? `+ ${mod}` : `- ${Math.abs(mod)}`;
}

interface RollViewModel {
  title: string;
  dcText?: string;
  isHybrid?: boolean;
  rolls: number[];
  naturalRoll: number | null;
  modifier: number | null;
  breakdown?: ModifierBreakdownItem[];
  total: number;
  success: boolean;
  statusLabel: string;
  clues?: Array<{ id: string; titleEs: string }>;
}

function buildRollViewModel(part: DiceRollToolPart): RollViewModel | null {
  if (part.state !== "output-available") return null;

  switch (part.type) {
    case "tool-resolve_check": {
      const out = part.output;
      if (!out.ok || out.total === undefined) return null;
      const nat = out.naturalRoll ?? null;
      const isCrit = nat === 20;
      const isFumble = nat === 1;
      return {
        title: `Tirada · ${labelSkill(out.skill ?? part.input?.skill)}`,
        dcText: out.dc !== undefined ? `CD ${out.dc}` : undefined,
        rolls: out.rolls ?? (nat !== null ? [nat] : []),
        naturalRoll: nat,
        modifier: out.modifier ?? null,
        breakdown: out.breakdown,
        total: out.total,
        success: Boolean(out.success),
        statusLabel: isCrit
          ? "¡Crítico!"
          : isFumble
            ? "Pifia"
            : out.success
              ? "Éxito"
              : "Fallo",
      };
    }

    case "tool-resolve_save": {
      const out = part.output;
      if (!out.ok || out.total === undefined) return null;
      const nat = out.naturalRoll ?? null;
      const ability = (out.ability ?? part.input?.ability ?? "").toUpperCase();
      return {
        title: `Salvación (${ability || "FÍS"})`,
        dcText: out.dc !== undefined ? `CD ${out.dc}` : undefined,
        rolls: out.rolls ?? (nat !== null ? [nat] : []),
        naturalRoll: nat,
        modifier: out.modifier ?? null,
        breakdown: out.breakdown,
        total: out.total,
        success: Boolean(out.success),
        statusLabel: nat === 20 ? "¡Crítico!" : out.success ? "Superada" : "Fallida",
      };
    }

    case "tool-declare_check": {
      const out = part.output;
      if (out.ok === false) return null;
      const isInvestigate = out.purpose === "investigate";
      const clueCount = out.unlockedClues?.length ?? 0;
      return {
        title: isInvestigate
          ? `Investigar · ${labelSkill(out.skill)}`
          : `Tirada · ${labelSkill(out.skill)}`,
        dcText: `CD ${out.dc}`,
        isHybrid: true,
        rolls: out.dieResults,
        naturalRoll: out.naturalRoll,
        modifier: out.expectedModifier,
        breakdown: out.breakdown,
        total: out.declaredTotal,
        success: out.success,
        statusLabel: isInvestigate
          ? clueCount > 0
            ? `${clueCount} pista(s)`
            : out.success
              ? "Éxito"
              : "Sin pistas"
          : out.naturalRoll === 20
            ? "¡Crítico!"
            : out.naturalRoll === 1
              ? "Pifia"
              : out.success
                ? "Éxito"
                : "Fallo",
        clues: out.unlockedClues?.map((c) => ({ id: c.id, titleEs: c.titleEs })),
      };
    }

    case "tool-investigate": {
      const out = part.output;
      if (!out.ok || out.total === undefined) return null;
      const clueCount = out.unlockedClues?.length ?? 0;
      return {
        title: `Investigar · ${labelSkill(part.input?.skill ?? "investigation")}`,
        dcText: "Escena",
        rolls: out.naturalRoll !== undefined ? [out.naturalRoll] : [],
        naturalRoll: out.naturalRoll ?? null,
        modifier: out.modifier ?? null,
        breakdown: out.breakdown,
        total: out.total,
        success: clueCount > 0,
        statusLabel:
          clueCount > 0 ? `${clueCount} pista(s)` : "Sin pistas nuevas",
        clues: out.unlockedClues?.map((c) => ({ id: c.id, titleEs: c.titleEs })),
      };
    }

    case "tool-death_save": {
      const out = part.output;
      if (!out.ok || out.naturalRoll === undefined) return null;
      const ok = out.naturalRoll >= 10;
      return {
        title: "Salvación de muerte",
        dcText: "CD 10",
        rolls: [out.naturalRoll],
        naturalRoll: out.naturalRoll,
        modifier: null,
        total: out.naturalRoll,
        success: ok,
        statusLabel:
          out.naturalRoll === 20
            ? "¡NAT 20!"
            : out.naturalRoll === 1
              ? "2 Fallos"
              : ok
                ? "Éxito"
                : "Fallo",
      };
    }
  }
}

export function DiceRollCard({ part }: { part: DiceRollToolPart }) {
  const vm = buildRollViewModel(part);
  if (!vm) return null;

  const isCritical = vm.naturalRoll === 20;
  const isFumble = vm.naturalRoll === 1;
  const formulaLeft =
    vm.naturalRoll !== null ? `d20: ${vm.naturalRoll}` : `Total`;

  return (
    <div className="my-1.5 flex justify-center">
      <div
        className={cn(
          "w-full max-w-md overflow-hidden rounded-none border border-border border-l-2 bg-card",
          isCritical
            ? "border-l-amber-500"
            : vm.success
              ? "border-l-success"
              : "border-l-destructive",
        )}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border bg-secondary/45 px-3.5 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <DicesIcon className="size-4 shrink-0 text-dice" />
            <span className="truncate text-xs font-medium text-card-foreground">
              {vm.title}
            </span>
          </div>
          {vm.dcText && (
            <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
              {vm.dcText}
            </span>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 font-mono text-xs tabular-nums text-muted-foreground">
              <span
                className={cn(
                  isCritical && "font-semibold text-success",
                  isFumble && "font-semibold text-destructive",
                )}
                title={
                  vm.rolls.length > 1
                    ? `Dados lanzados: [${vm.rolls.join(", ")}]`
                    : undefined
                }
              >
                {formulaLeft}
              </span>
              {vm.modifier !== null && (
                <span>{formatMod(vm.modifier)}</span>
              )}
            </div>
            <div className="h-5 w-px bg-border" />
            <span className="font-mono text-xl font-bold tabular-nums text-card-foreground">
              {vm.total}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            {vm.success ? (
              <>
                <CheckCircle2Icon className="size-4 text-success" />
                <span className="text-xs font-semibold text-success">
                  {vm.statusLabel}
                </span>
              </>
            ) : (
              <>
                <XCircleIcon className="size-4 text-destructive" />
                <span className="text-xs font-semibold text-destructive">
                  {vm.statusLabel}
                </span>
              </>
            )}
          </div>
        </div>

        {vm.breakdown && vm.breakdown.length > 0 && (
          <div className="flex flex-wrap gap-1 border-t border-border/70 bg-secondary/20 px-3.5 py-1.5 font-mono text-[10px] tabular-nums">
            {vm.breakdown.map((item, idx) => (
              <span
                key={`${item.slug}-${idx}`}
                className={cn(
                  "rounded-none border px-1.5 py-0.5",
                  item.ignored
                    ? "border-border/60 bg-muted/40 text-muted-foreground line-through opacity-60"
                    : item.value >= 0
                      ? "border-border bg-background/80 text-foreground"
                      : "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
                )}
                title={
                  item.ignored
                    ? `Anulado por apilamiento (${item.type})`
                    : `${item.labelEs} (${item.type})`
                }
              >
                {item.labelEs} {formatMod(item.value)}
                {item.diceExpression ? ` (${item.diceExpression})` : ""}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
