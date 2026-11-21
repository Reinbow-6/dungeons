"use client";

import type { DmToolPart } from "@/tools";
import { StatusIcon } from "@/components/status-icon";
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

function summarizeTool(part: DmToolPart): {
  title: string;
  description?: string;
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
          ? `${out.total} vs CD ${out.dc} (${out.success ? "Éxito" : "Fallo"})`
          : out.messageEs,
        isError: !out.ok,
        details: out,
      };
    }
    case "tool-resolve_save": {
      const out = part.output;
      return {
        title: `${label}: ${(out.ability ?? part.input?.ability ?? "").toUpperCase()}`,
        description: out.ok
          ? `${out.total} vs CD ${out.dc} (${out.success ? "Superada" : "Fallida"})`
          : out.messageEs,
        isError: !out.ok,
        details: out,
      };
    }
    case "tool-declare_check": {
      const out = part.output;
      return {
        title: `${label}: ${out.skill}`,
        description: `Dados [${out.dieResults.join(", ")}] → Total ${out.declaredTotal} vs CD ${out.dc} (${out.success ? "Éxito" : "Fallo"})`,
        details: out,
      };
    }
    case "tool-investigate": {
      const out = part.output;
      return {
        title: label,
        description: out.ok
          ? `${out.total ?? "?"} · ${out.unlockedClues?.length ?? 0} pista(s)`
          : out.messageEs,
        isError: !out.ok,
        details: out,
      };
    }
    case "tool-transition_scene": {
      const out = part.output;
      return {
        title: `${label}: ${out.titleEs ?? out.toSceneId ?? ""}`,
        description: out.ok ? out.messageEs : out.messageEs,
        isError: !out.ok,
        details: out,
      };
    }
    case "tool-inventory": {
      const out = part.output;
      return {
        title: `${label}: ${out.itemName ?? out.itemId ?? ""}`,
        description: out.messageEs,
        isError: !out.ok,
        details: out,
      };
    }
    case "tool-rollback_to_event": {
      const out = part.output;
      return {
        title: label,
        description: out.messageEs,
        isError: !out.ok,
        details: out,
      };
    }
    case "tool-lookup_rules": {
      const out = part.output;
      return {
        title: `${label}: "${part.input?.query ?? ""}"`,
        description: `${out.results.length} resultado(s)`,
        details: out.results,
      };
    }
    case "tool-combat_start": {
      const out = part.output;
      return {
        title: out.ok ? `${label} · Ronda ${out.round ?? 1}` : label,
        description: out.ok
          ? `Turno: ${out.activeCombatant?.name ?? "?"} (${out.initiativeOrder?.length ?? 0} combatientes)`
          : out.messageEs,
        isError: !out.ok,
        details: out,
      };
    }
    case "tool-combat_attack": {
      const out = part.output;
      const summaryDesc = !out.ok
        ? out.messageEs
        : out.hit
          ? `${out.attackTotal} vs CA ${out.targetAc}${out.isCritical ? " · CRÍTICO" : ""} → ${out.damageApplied} daño (${out.targetHpAfter} PG)${out.targetDefeated ? " · Derrotado" : ""}`
          : `${out.attackTotal} vs CA ${out.targetAc}${out.isCriticalMiss ? " · Pifia (1)" : ""} · Fallo`;
      return {
        title:
          out.ok && out.attackerName && out.targetName
            ? `${out.attackerName} → ${out.targetName}`
            : label,
        description: summaryDesc,
        isError: !out.ok,
        details: out,
      };
    }
    case "tool-combat_next_turn": {
      const out = part.output;
      return {
        title: out.ok ? `${label} · Ronda ${out.round ?? "?"}` : label,
        description: out.ok
          ? `Ahora actúa: ${out.activeCombatant?.name ?? "?"}`
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
        isError: !out.ok,
        details: out,
      };
    }
    case "tool-apply_condition": {
      const out = part.output;
      return {
        title: `${label}: ${out.actorId ?? part.input?.actorId ?? ""}`,
        description: out.messageEs,
        isError: !out.ok,
        details: out,
      };
    }
    case "tool-remember_fact": {
      const out = part.output;
      return {
        title: `${label}: ${out.category ?? part.input?.category ?? ""}`,
        description: out.messageEs,
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
          <StatusIcon status={isStreaming ? "running" : "error"} />
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
            <StatusIcon status={summary.isError ? "error" : undefined} />
          </TraceIcon>
          <TraceTitle>{summary.title}</TraceTitle>
          {summary.description && (
            <TraceDescription>{summary.description}</TraceDescription>
          )}
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <CodeBlock size="sm" variant={summary.isError ? "destructive" : undefined}>
          <CodeBlockContent wrap className="max-h-64">
            {JSON.stringify(summary.details, null, 2)}
          </CodeBlockContent>
        </CodeBlock>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}
