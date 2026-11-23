"use client";

import {
  BellIcon,
  CheckCircle2Icon,
  FlameIcon,
  SparklesIcon,
  SwordsIcon,
  XIcon,
} from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

export type ToastTone = "neutral" | "amber" | "emerald" | "rose" | "violet";

export interface ToastInput {
  title: string;
  description?: string;
  tone?: ToastTone;
  meta?: string;
  durationMs?: number;
}

export interface ToastItem extends ToastInput {
  id: string;
  tone: ToastTone;
}

const MAX_VISIBLE_TOASTS = 4;
const DEFAULT_DURATION_MS = 4500;
const EMPTY_TOASTS: readonly ToastItem[] = Object.freeze([]);

let nextToastSeq = 1;
let toastsState: readonly ToastItem[] = EMPTY_TOASTS;
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

export function dismissToast(id: string): void {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
  const next = toastsState.filter((t) => t.id !== id);
  if (next.length !== toastsState.length) {
    toastsState = next;
    emitChange();
  }
}

export function pushToast(input: ToastInput): string {
  const id = `toast-${nextToastSeq++}`;
  const item: ToastItem = {
    id,
    title: input.title,
    description: input.description,
    meta: input.meta,
    tone: input.tone ?? "neutral",
    durationMs: input.durationMs ?? DEFAULT_DURATION_MS,
  };

  const next = [...toastsState, item];
  while (next.length > MAX_VISIBLE_TOASTS) {
    const dropped = next.shift();
    if (dropped) {
      const t = timers.get(dropped.id);
      if (t) {
        clearTimeout(t);
        timers.delete(dropped.id);
      }
    }
  }
  toastsState = next;
  emitChange();

  if (typeof window !== "undefined" && (item.durationMs ?? 0) > 0) {
    const timer = setTimeout(() => {
      dismissToast(id);
    }, item.durationMs);
    timers.set(id, timer);
  }

  return id;
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function getSnapshot(): readonly ToastItem[] {
  return toastsState;
}

function getServerSnapshot(): readonly ToastItem[] {
  return EMPTY_TOASTS;
}

const TONE_STYLES: Record<
  ToastTone,
  { border: string; iconBg: string; iconText: string }
> = {
  neutral: {
    border: "border-border/80",
    iconBg: "bg-muted/80",
    iconText: "text-muted-foreground",
  },
  amber: {
    border: "border-amber-500/40",
    iconBg: "bg-amber-500/15",
    iconText: "text-amber-600 dark:text-amber-300",
  },
  emerald: {
    border: "border-emerald-500/40",
    iconBg: "bg-emerald-500/15",
    iconText: "text-emerald-600 dark:text-emerald-300",
  },
  rose: {
    border: "border-rose-500/45",
    iconBg: "bg-rose-500/15",
    iconText: "text-rose-600 dark:text-rose-300",
  },
  violet: {
    border: "border-violet-500/40",
    iconBg: "bg-violet-500/15",
    iconText: "text-violet-600 dark:text-violet-300",
  },
};

function ToastToneIcon({ tone }: { tone: ToastTone }) {
  switch (tone) {
    case "emerald":
      return <CheckCircle2Icon className="size-3.5" />;
    case "rose":
      return <SwordsIcon className="size-3.5" />;
    case "violet":
      return <SparklesIcon className="size-3.5" />;
    case "amber":
      return <FlameIcon className="size-3.5" />;
    default:
      return <BellIcon className="size-3.5" />;
  }
}

export function Toaster() {
  const items = React.useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  if (items.length === 0) {
    return null;
  }

  return (
    <div
      aria-live="polite"
      aria-label="Notificaciones del registro de campaña"
      className="pointer-events-none fixed top-14 right-3 z-50 flex w-[calc(100vw-1.5rem)] max-w-80 flex-col gap-2 sm:top-auto sm:right-4 sm:bottom-4"
    >
      {items.map((item) => {
        const style = TONE_STYLES[item.tone];
        return (
          <div
            key={item.id}
            role="status"
            className={cn(
              "pointer-events-auto flex items-start gap-2.5 rounded-xl border bg-card/95 px-3 py-2.5 text-xs shadow-lg backdrop-blur-md transition-all animate-in fade-in slide-in-from-bottom-2 duration-200",
              style.border,
            )}
          >
            <span
              className={cn(
                "mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-lg",
                style.iconBg,
                style.iconText,
              )}
            >
              <ToastToneIcon tone={item.tone} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium text-foreground">
                  {item.title}
                </span>
                {item.meta && (
                  <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                    {item.meta}
                  </span>
                )}
              </div>
              {item.description && (
                <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                  {item.description}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismissToast(item.id)}
              aria-label="Cerrar notificación"
              className="shrink-0 rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
            >
              <XIcon className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
