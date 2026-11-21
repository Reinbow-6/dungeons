"use client";

import {
  ArrowRightIcon,
  BackpackIcon,
  BookOpenIcon,
  BookmarkIcon,
  CrosshairIcon,
  DicesIcon,
  FlagIcon,
  Loader2Icon,
  MapPinIcon,
  RotateCcwIcon,
  SearchIcon,
  ShieldCheckIcon,
  SparklesIcon,
  SwordsIcon,
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
import type { DmToolPart } from "@/tools";

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
        "ml-1.5 inline-flex items-center rounded border px-1.5 py-0 font-mono text-[10px] font-semibold tabular-nums",
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
  }
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
      <TraceCollapsibleTrigger>
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
        >
          <CodeBlockContent wrap className="max-h-64">
            {JSON.stringify(summary.details, null, 2)}
          </CodeBlockContent>
        </CodeBlock>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}
