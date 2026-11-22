"use client";

import * as React from "react";

import type {
  SuggestedActionItem,
  SuggestedActionTone,
} from "@/agent/types";
import { usePlaySound } from "@/components/ui/sensory-ui/config/use-play-sound";
import { cn } from "@/lib/utils";

function inferTone(
  tone: SuggestedActionTone | undefined,
  skill: string,
): SuggestedActionTone {
  if (tone) return tone;
  const s = skill.toLowerCase();
  if (
    s.includes("investig") ||
    s.includes("percep") ||
    s.includes("histor") ||
    s.includes("perspic") ||
    s.includes("relig")
  ) {
    return "blue";
  }
  if (
    s.includes("intimid") ||
    s.includes("combat") ||
    s.includes("ataq") ||
    s.includes("atlet") ||
    s.includes("destruc") ||
    s.includes("fuerz")
  ) {
    return "crimson";
  }
  if (
    s.includes("sigil") ||
    s.includes("arcan") ||
    s.includes("conjur") ||
    s.includes("hechiz") ||
    s.includes("magi") ||
    s.includes("engañ") ||
    s.includes("engan")
  ) {
    return "violet";
  }
  if (
    s.includes("curac") ||
    s.includes("medicin") ||
    s.includes("superv") ||
    s.includes("descans") ||
    s.includes("natural") ||
    s.includes("sanar")
  ) {
    return "emerald";
  }
  return "amber";
}

const TONE_STYLES: Record<
  SuggestedActionTone,
  { container: string; skill: string; keycap: string }
> = {
  blue: {
    container:
      "border-sky-500/25 bg-sky-500/[0.06] hover:border-sky-400/50 hover:bg-sky-500/[0.12] dark:border-sky-400/20 dark:bg-sky-950/35 dark:hover:border-sky-400/45 dark:hover:bg-sky-950/55",
    skill: "text-sky-700 dark:text-sky-300",
    keycap:
      "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  },
  crimson: {
    container:
      "border-rose-500/25 bg-rose-500/[0.06] hover:border-rose-400/50 hover:bg-rose-500/[0.12] dark:border-rose-500/20 dark:bg-rose-950/35 dark:hover:border-rose-400/45 dark:hover:bg-rose-950/55",
    skill: "text-rose-700 dark:text-rose-300",
    keycap:
      "border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  },
  violet: {
    container:
      "border-violet-500/25 bg-violet-500/[0.06] hover:border-violet-400/50 hover:bg-violet-500/[0.12] dark:border-violet-400/20 dark:bg-violet-950/35 dark:hover:border-violet-400/45 dark:hover:bg-violet-950/55",
    skill: "text-violet-700 dark:text-violet-300",
    keycap:
      "border-violet-500/25 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  },
  emerald: {
    container:
      "border-emerald-500/25 bg-emerald-500/[0.06] hover:border-emerald-400/50 hover:bg-emerald-500/[0.12] dark:border-emerald-400/20 dark:bg-emerald-950/35 dark:hover:border-emerald-400/45 dark:hover:bg-emerald-950/55",
    skill: "text-emerald-700 dark:text-emerald-300",
    keycap:
      "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  amber: {
    container:
      "border-amber-500/25 bg-amber-500/[0.06] hover:border-amber-400/50 hover:bg-amber-500/[0.12] dark:border-amber-400/20 dark:bg-amber-950/30 dark:hover:border-amber-400/45 dark:hover:bg-amber-950/50",
    skill: "text-amber-700 dark:text-amber-300",
    keycap:
      "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
};

export function SuggestedActions({
  actions,
  disabled = false,
  onSelect,
}: {
  actions: readonly SuggestedActionItem[];
  disabled?: boolean;
  onSelect: (prompt: string) => void;
}) {
  const { play } = usePlaySound({ sound: "interaction.confirm" });
  const onSelectRef = React.useRef(onSelect);
  const playRef = React.useRef(play);
  const actionsRef = React.useRef(actions);
  const disabledRef = React.useRef(disabled);

  React.useEffect(() => {
    onSelectRef.current = onSelect;
    playRef.current = play;
    actionsRef.current = actions;
    disabledRef.current = disabled;
  }, [onSelect, play, actions, disabled]);

  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (disabledRef.current) return;
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      const index = Number.parseInt(event.key, 10) - 1;
      if (
        Number.isInteger(index) &&
        index >= 0 &&
        index < actionsRef.current.length
      ) {
        const chosen = actionsRef.current[index];
        if (chosen) {
          event.preventDefault();
          playRef.current();
          onSelectRef.current(chosen.label);
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  if (actions.length === 0) return null;

  return (
    <div
      className="mt-3 flex flex-col gap-2"
      aria-label="Acciones sugeridas para este turno"
    >
      {actions.map((action, idx) => {
        const tone = inferTone(action.tone, action.skill);
        const styles = TONE_STYLES[tone];
        return (
          <button
            key={`${idx}-${action.skill}-${action.label.slice(0, 24)}`}
            type="button"
            disabled={disabled}
            onClick={() => {
              play();
              onSelect(action.label);
            }}
            className={cn(
              "group flex min-h-10 w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 sm:w-fit sm:max-w-full",
              styles.container,
            )}
          >
            <span
              className={cn(
                "mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded border font-mono text-[10px] font-semibold tabular-nums",
                styles.keycap,
              )}
            >
              {idx + 1}
            </span>
            <span className="text-[13px] leading-snug">
              <span className={cn("mr-2 font-semibold", styles.skill)}>
                {action.skill}
              </span>
              <span className="text-foreground/90 transition-colors group-hover:text-foreground">
                {action.label}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
