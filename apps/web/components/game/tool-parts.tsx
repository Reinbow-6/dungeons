"use client";

import {
  ArrowRightIcon,
  BackpackIcon,
  BookOpenIcon,
  BookmarkIcon,
  CrosshairIcon,
  DicesIcon,
  FlagIcon,
  HeartPulseIcon,
  Loader2Icon,
  MapPinIcon,
  MoonIcon,
  RotateCcwIcon,
  SearchIcon,
  ShieldCheckIcon,
  SkullIcon,
  SparklesIcon,
  SwordsIcon,
  Wand2Icon,
  XCircleIcon,
} from "lucide-react";

import { CodeBlock, CodeBlockContent } from "@/components/ui/code-block";
import {
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
import { cn } from "@/lib/utils";
import type { ChatUIMessage, DmToolPart } from "@/tools";

const LABELS: Record<DmToolPart["type"], string> = {
  "tool-resolve_check": "Prueba de habilidad",
  "tool-resolve_save": "Tirada de salvación",
  "tool-declare_check": "Tirada física (Papel)",
  "tool-investigate": "Investigar escena",
  "tool-transition_scene": "Cambio de escena",
  "tool-inventory": "Inventario",
  "tool-rollback_to_event": "Rollback",
  "tool-lookup_rules": "Consulta SRD 5.2.1",
  "tool-combat_start": "Inicio de combate",
  "tool-combat_attack": "Ataque en combate",
  "tool-combat_next_turn": "Siguiente turno",
  "tool-combat_end": "Fin de combate",
  "tool-apply_condition": "Condiciones / Concentración",
  "tool-remember_fact": "Memoria de campaña",
  "tool-cast_spell": "Conjuro 5e",
  "tool-take_rest": "Descanso",
  "tool-death_save": "Salvación de muerte",
  "tool-heal": "Curación / Estabilizar",
};

function ToolCategoryIcon({ type }: { type: DmToolPart["type"] }) {
  const cls = "size-3.5 text-muted-foreground";
  switch (type) {
    case "tool-resolve_check":
    case "tool-declare_check":
      return <DicesIcon className={cls} />;
    case "tool-resolve_save":
      return <ShieldCheckIcon className={cls} />;
    case "tool-investigate":
      return <SearchIcon className={cls} />;
    case "tool-transition_scene":
      return <MapPinIcon className={cls} />;
    case "tool-inventory":
      return <BackpackIcon className={cls} />;
    case "tool-rollback_to_event":
      return <RotateCcwIcon className={cls} />;
    case "tool-lookup_rules":
      return <BookOpenIcon className={cls} />;
    case "tool-combat_start":
      return <SwordsIcon className={cls} />;
    case "tool-combat_attack":
      return <CrosshairIcon className={cls} />;
    case "tool-combat_next_turn":
      return <ArrowRightIcon className={cls} />;
    case "tool-combat_end":
      return <FlagIcon className={cls} />;
    case "tool-apply_condition":
      return <SparklesIcon className={cls} />;
    case "tool-remember_fact":
      return <BookmarkIcon className={cls} />;
    case "tool-cast_spell":
      return <Wand2Icon className={cls} />;
    case "tool-take_rest":
      return <MoonIcon className={cls} />;
    case "tool-death_save":
      return <SkullIcon className={cls} />;
    case "tool-heal":
      return <HeartPulseIcon className={cls} />;
  }
}

type BadgeTone = "emerald" | "rose" | "amber" | "indigo" | "neutral";

function BadgeChip({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: BadgeTone;
}) {
  const tones: Record<BadgeTone, string> = {
    emerald:
      "border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    rose: "border-rose-500/30 bg-rose-500/15 text-rose-700 dark:text-rose-300",
    amber:
      "border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-300",
    indigo:
      "border-indigo-500/30 bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
    neutral: "border-border bg-muted text-muted-foreground",
  };

  return (
    <span
      className={cn(
        "ml-1.5 inline-flex items-center rounded-none border px-1.5 py-0 font-mono text-[10px] font-semibold tabular-nums",
        tones[tone],
      )}
    >
      {label}
    </span>
  );
}

function summarizeTool(part: DmToolPart): {
  title: string;
  description?: string;
  badge?: { label: string; tone: BadgeTone };
  isError?: boolean;
  details: unknown;
} {
  const label = LABELS[part.type];

  if (part.state !== "output-available" && part.state !== "output-error") {
    return {
      title: `${label}…`,
      details: part.input ?? {},
    };
  }

  if (part.state === "output-error") {
    return {
      title: `${label} (error)`,
      badge: { label: "Error", tone: "rose" },
      isError: true,
      details: { error: part.errorText },
    };
  }

  switch (part.type) {
    case "tool-resolve_check": {
      const out = part.output;
      return {
        title: `${label}: ${out.skill ?? part.input?.skill ?? ""}`,
        description: out.ok
          ? `${out.total} vs CD ${out.dc}`
          : out.messageEs,
        badge: out.ok
          ? {
              label: out.success ? "Éxito" : "Fallo",
              tone: out.success ? "emerald" : "rose",
            }
          : { label: out.code ?? "Error", tone: "rose" },
        isError: !out.ok,
        details: out,
      };
    }
    case "tool-resolve_save": {
      const out = part.output;
      return {
        title: `${label}: ${(out.ability ?? part.input?.ability ?? "").toUpperCase()}`,
        description: out.ok
          ? `${out.total} vs CD ${out.dc}`
          : out.messageEs,
        badge: out.ok
          ? {
              label: out.success ? "Superada" : "Fallida",
              tone: out.success ? "emerald" : "rose",
            }
          : { label: out.code ?? "Error", tone: "rose" },
        isError: !out.ok,
        details: out,
      };
    }
    case "tool-declare_check": {
      const out = part.output;
      return {
        title: `${label}: ${out.skill}`,
        description: `d20 [${out.dieResults.join(", ")}] → ${out.declaredTotal} vs CD ${out.dc}`,
        badge: {
          label: out.success ? "Éxito" : "Fallo",
          tone: out.success ? "emerald" : "rose",
        },
        details: out,
      };
    }
    case "tool-investigate": {
      const out = part.output;
      const clueCount = out.unlockedClues?.length ?? 0;
      return {
        title: label,
        description: out.ok ? `Total ${out.total ?? "?"}` : out.messageEs,
        badge: out.ok
          ? {
              label: `${clueCount} pista(s)`,
              tone: clueCount > 0 ? "emerald" : "neutral",
            }
          : { label: "Error", tone: "rose" },
        isError: !out.ok,
        details: out,
      };
    }
    case "tool-transition_scene": {
      const out = part.output;
      return {
        title: `${label}: ${out.titleEs ?? out.toSceneId ?? ""}`,
        description: out.messageEs,
        badge: out.ok
          ? { label: "Escena", tone: "indigo" }
          : { label: "Bloqueada", tone: "rose" },
        isError: !out.ok,
        details: out,
      };
    }
    case "tool-inventory": {
      const out = part.output;
      return {
        title: `${label}: ${out.itemName ?? out.itemId ?? ""}`,
        description: out.messageEs,
        badge: out.ok
          ? { label: `x${out.quantityAfter ?? "?"}`, tone: "neutral" }
          : { label: "Error", tone: "rose" },
        isError: !out.ok,
        details: out,
      };
    }
    case "tool-rollback_to_event": {
      const out = part.output;
      return {
        title: label,
        description: out.messageEs,
        badge: out.ok
          ? { label: `seq ${out.targetSeq ?? "?"}`, tone: "amber" }
          : { label: "Error", tone: "rose" },
        isError: !out.ok,
        details: out,
      };
    }
    case "tool-lookup_rules": {
      const out = part.output;
      return {
        title: `${label}: "${part.input?.query ?? ""}"`,
        badge: { label: `${out.results.length} reg.`, tone: "indigo" },
        details: out.results,
      };
    }
    case "tool-combat_start": {
      const out = part.output;
      return {
        title: out.ok ? `${label} · Ronda ${out.round ?? 1}` : label,
        description: out.ok
          ? `Turno: ${out.activeCombatant?.name ?? "?"}`
          : out.messageEs,
        badge: out.ok
          ? {
              label: `${out.initiativeOrder?.length ?? 0} comb.`,
              tone: "amber",
            }
          : { label: "Error", tone: "rose" },
        isError: !out.ok,
        details: out,
      };
    }
    case "tool-combat_attack": {
      const out = part.output;
      const badge: { label: string; tone: BadgeTone } = !out.ok
        ? { label: "Error", tone: "rose" }
        : out.isCritical
          ? { label: `CRÍTICO · ${out.damageApplied} daño`, tone: "amber" }
          : out.hit
            ? { label: `Impacto · ${out.damageApplied} daño`, tone: "emerald" }
            : { label: out.isCriticalMiss ? "Pifia" : "Fallo", tone: "rose" };
      return {
        title:
          out.ok && out.attackerName && out.targetName
            ? `${out.attackerName} → ${out.targetName}`
            : label,
        description: out.ok
          ? `${out.attackTotal} vs CA ${out.targetAc}`
          : out.messageEs,
        badge,
        isError: !out.ok,
        details: out,
      };
    }
    case "tool-combat_next_turn": {
      const out = part.output;
      return {
        title: out.ok ? `${label} · R${out.round ?? "?"}` : label,
        description: out.ok
          ? `Actúa: ${out.activeCombatant?.name ?? "?"}`
          : out.messageEs,
        isError: !out.ok,
        details: out,
      };
    }
    case "tool-combat_end": {
      const out = part.output;
      const outcomeLabel =
        out.outcome === "victory"
          ? "Victoria"
          : out.outcome === "fled"
            ? "Retirada"
            : out.outcome === "truce"
              ? "Tregua"
              : "";
      return {
        title: out.ok && outcomeLabel ? `${label}: ${outcomeLabel}` : label,
        description: out.messageEs,
        badge: out.ok
          ? { label: outcomeLabel || "Cerrado", tone: "indigo" }
          : { label: "Error", tone: "rose" },
        isError: !out.ok,
        details: out,
      };
    }
    case "tool-apply_condition": {
      const out = part.output;
      return {
        title: `${label}: ${out.actorId ?? part.input?.actorId ?? ""}`,
        description: out.messageEs,
        badge: out.ok
          ? { label: `seq ${out.seq ?? "?"}`, tone: "amber" }
          : { label: out.code ?? "Error", tone: "rose" },
        isError: !out.ok,
        details: out,
      };
    }
    case "tool-remember_fact": {
      const out = part.output;
      return {
        title: `${label}: ${out.category ?? part.input?.category ?? ""}`,
        description: out.messageEs,
        badge: out.ok
          ? { label: `seq ${out.eventSeq ?? "?"}`, tone: "indigo" }
          : { label: "Error", tone: "rose" },
        isError: !out.ok,
        details: out,
      };
    }
    case "tool-cast_spell": {
      const out = part.output;
      const spellTitle = out.spellNameEs ?? part.input?.spellId ?? label;
      let badge: { label: string; tone: BadgeTone } = {
        label: "Lanzado",
        tone: "indigo",
      };
      if (!out.ok) {
        badge = { label: out.code ?? "Error", tone: "rose" };
      } else if (out.attackRoll) {
        badge = out.attackRoll.isCritical
          ? { label: "CRÍTICO", tone: "amber" }
          : out.attackRoll.hit
            ? { label: "Impacto", tone: "emerald" }
            : { label: "Fallo", tone: "rose" };
      } else if (out.savingThrow) {
        badge = out.savingThrow.saved
          ? { label: "Resistido", tone: "amber" }
          : { label: "Efecto", tone: "emerald" };
      } else if (out.healingApplied && out.healingApplied > 0) {
        badge = { label: `+${out.healingApplied} PG`, tone: "emerald" };
      }
      return {
        title: `${label}: ${spellTitle}`,
        description: out.messageEs,
        badge,
        isError: !out.ok,
        details: out,
      };
    }
    case "tool-take_rest": {
      const out = part.output;
      return {
        title:
          out.restType === "long" ? "Descanso largo" : "Descanso corto",
        description: out.messageEs,
        badge: out.ok
          ? {
              label:
                out.hpHealed && out.hpHealed > 0
                  ? `+${out.hpHealed} PG`
                  : "Recuperado",
              tone: "emerald",
            }
          : { label: out.code ?? "Error", tone: "rose" },
        isError: !out.ok,
        details: out,
      };
    }
    case "tool-death_save": {
      const out = part.output;
      const tone: BadgeTone =
        !out.ok ||
        out.outcome === "failure" ||
        out.outcome === "critical_failure" ||
        out.outcome === "dead"
          ? "rose"
          : out.outcome === "critical_recovery"
            ? "amber"
            : "emerald";
      const badgeLabel = !out.ok
        ? (out.code ?? "Error")
        : out.outcome === "critical_recovery"
          ? "NAT 20 (+1 PG)"
          : out.outcome === "stabilized"
            ? "Estable"
            : out.outcome === "dead"
              ? "Muerto"
              : out.outcome === "success"
                ? "Éxito"
                : out.outcome === "critical_failure"
                  ? "NAT 1 (×2)"
                  : "Fallo";
      return {
        title: label,
        description: out.messageEs,
        badge: { label: badgeLabel, tone },
        isError: !out.ok,
        details: out,
      };
    }
    case "tool-heal": {
      const out = part.output;
      return {
        title: label,
        description: out.messageEs,
        badge: out.ok
          ? out.stabilized
            ? { label: "Estabilizado", tone: "emerald" }
            : out.hpHealed && out.hpHealed > 0
              ? { label: `+${out.hpHealed} PG`, tone: "emerald" }
              : { label: "Fallo", tone: "rose" }
          : { label: out.code ?? "Error", tone: "rose" },
        isError: !out.ok,
        details: out,
      };
    }
  }
}

export interface TurnOutcomeSummary {
  skillLabel: string;
  outcomeLabel: string;
  tone: BadgeTone;
}

const SKILL_LABELS_ES: Record<string, string> = {
  acrobatics: "Acrobacias",
  animal_handling: "Trato con Animales",
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
  sleight_of_hand: "Juego de Manos",
  stealth: "Sigilo",
  survival: "Supervivencia",
  str: "Fuerza",
  dex: "Destreza",
  con: "Constitución",
  int: "Inteligencia",
  wis: "Sabiduría",
  cha: "Carisma",
};

function formatSkillEs(raw?: string): string {
  if (!raw) return "Acción";
  const key = raw.toLowerCase();
  return SKILL_LABELS_ES[key] ?? raw;
}

/**
 * Extracts the primary deterministic outcome badge from an assistant message
 * so the preceding player action card can display "Skill · Éxito/Fallo" inline.
 */
export function extractTurnOutcomeSummary(
  assistantMessage: ChatUIMessage | undefined,
): TurnOutcomeSummary | null {
  if (!assistantMessage || assistantMessage.role !== "assistant") {
    return null;
  }

  for (const part of assistantMessage.parts) {
    if (part.type === "tool-resolve_check" && part.state === "output-available" && part.output.ok) {
      return {
        skillLabel: formatSkillEs(part.output.skill ?? part.input?.skill),
        outcomeLabel: part.output.success ? "Éxito" : "Fallo",
        tone: part.output.success ? "emerald" : "rose",
      };
    }
    if (part.type === "tool-declare_check" && part.state === "output-available") {
      return {
        skillLabel: formatSkillEs(part.output.skill),
        outcomeLabel: part.output.success ? "Éxito" : "Fallo",
        tone: part.output.success ? "emerald" : "rose",
      };
    }
    if (part.type === "tool-investigate" && part.state === "output-available" && part.output.ok) {
      const count = part.output.unlockedClues?.length ?? 0;
      return {
        skillLabel: "Investigación",
        outcomeLabel: count > 0 ? `+${count} pista${count > 1 ? "s" : ""}` : "Sin pistas",
        tone: count > 0 ? "emerald" : "neutral",
      };
    }
    if (part.type === "tool-cast_spell" && part.state === "output-available" && part.output.ok) {
      const name = part.output.spellNameEs ?? "Conjuro";
      if (part.output.attackRoll) {
        return {
          skillLabel: name,
          outcomeLabel: part.output.attackRoll.isCritical
            ? "CRÍTICO"
            : part.output.attackRoll.hit
              ? "Impacto"
              : "Fallo",
          tone: part.output.attackRoll.isCritical
            ? "amber"
            : part.output.attackRoll.hit
              ? "emerald"
              : "rose",
        };
      }
      if (part.output.healingApplied && part.output.healingApplied > 0) {
        return {
          skillLabel: name,
          outcomeLabel: `+${part.output.healingApplied} PG`,
          tone: "emerald",
        };
      }
      return {
        skillLabel: name,
        outcomeLabel: "Lanzado",
        tone: "indigo",
      };
    }
    if (part.type === "tool-combat_attack" && part.state === "output-available" && part.output.ok) {
      return {
        skillLabel: "Combate",
        outcomeLabel: part.output.isCritical
          ? "CRÍTICO"
          : part.output.hit
            ? `Impacto (${part.output.damageApplied ?? 0})`
            : "Fallo",
        tone: part.output.isCritical
          ? "amber"
          : part.output.hit
            ? "emerald"
            : "rose",
      };
    }
    if (part.type === "tool-resolve_save" && part.state === "output-available" && part.output.ok) {
      return {
        skillLabel: `Salv. ${formatSkillEs(part.output.ability)}`,
        outcomeLabel: part.output.success ? "Superada" : "Fallida",
        tone: part.output.success ? "emerald" : "rose",
      };
    }
    if (part.type === "tool-death_save" && part.state === "output-available" && part.output.ok) {
      const o = part.output.outcome;
      return {
        skillLabel: "Muerte",
        outcomeLabel:
          o === "critical_recovery"
            ? "NAT 20"
            : o === "stabilized"
              ? "Estable"
              : o === "dead"
                ? "Muerto"
                : o === "success"
                  ? "Éxito"
                  : "Fallo",
        tone:
          o === "critical_recovery"
            ? "amber"
            : o === "stabilized" || o === "success"
              ? "emerald"
              : "rose",
      };
    }
    if (part.type === "tool-take_rest" && part.state === "output-available" && part.output.ok) {
      return {
        skillLabel: part.output.restType === "long" ? "Descanso largo" : "Descanso corto",
        outcomeLabel: "Completado",
        tone: "emerald",
      };
    }
    if (part.type === "tool-heal" && part.state === "output-available" && part.output.ok) {
      return {
        skillLabel: "Curación",
        outcomeLabel: part.output.stabilized
          ? "Estable"
          : part.output.hpHealed && part.output.hpHealed > 0
            ? `+${part.output.hpHealed} PG`
            : "Fallo",
        tone:
          part.output.stabilized || (part.output.hpHealed ?? 0) > 0
            ? "emerald"
            : "rose",
      };
    }
  }

  return null;
}

export function DmToolPartView({
  part,
  isStreaming,
}: {
  part: DmToolPart;
  isStreaming: boolean;
}) {
  if (part.state !== "output-available" && part.state !== "output-error") {
    return (
      <TraceLine status={isStreaming ? "running" : "error"}>
        <TraceIcon>
          {isStreaming ? (
            <Loader2Icon className="size-3.5 animate-spin text-indigo-400" />
          ) : (
            <XCircleIcon className="size-3.5 text-rose-500" />
          )}
        </TraceIcon>
        <TraceTitle>{LABELS[part.type]}…</TraceTitle>
      </TraceLine>
    );
  }

  const summary = summarizeTool(part);

  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger className="rounded-none">
        <TraceLine status={summary.isError ? "error" : undefined}>
          <TraceIcon>
            {summary.isError ? (
              <XCircleIcon className="size-3.5 text-rose-500" />
            ) : (
              <ToolCategoryIcon type={part.type} />
            )}
          </TraceIcon>
          <TraceTitle className="flex flex-wrap items-center">
            <span>{summary.title}</span>
            {summary.badge && (
              <BadgeChip
                label={summary.badge.label}
                tone={summary.badge.tone}
              />
            )}
          </TraceTitle>
          {summary.description && (
            <TraceDescription className="font-mono text-[11px] tabular-nums">
              {summary.description}
            </TraceDescription>
          )}
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <CodeBlock
          size="sm"
          variant={summary.isError ? "destructive" : undefined}
          className={cn(
            "rounded-none border border-border border-l-2",
            summary.isError ? "border-l-destructive" : "border-l-border",
          )}
        >
          <CodeBlockContent wrap className="max-h-64">
            {JSON.stringify(summary.details, null, 2)}
          </CodeBlockContent>
        </CodeBlock>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}
