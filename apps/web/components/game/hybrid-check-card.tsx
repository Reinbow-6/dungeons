"use client";

import type { GameEvent, GameState } from "@dungeons/rules";
import { DicesIcon } from "lucide-react";
import * as React from "react";

import type { DeclareCheckToolOutput } from "@/agent/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSensoryUI } from "@/components/ui/sensory-ui/config/provider";

export interface HybridCheckCardProps {
  campaignId: string;
  sceneId: string;
  actorId: string;
  skill: string;
  dc?: number;
  dcRef?: string;
  mode?: "normal" | "advantage" | "disadvantage";
  promptEs?: string;
  checkId?: string;
  sticky?: boolean;
  onVerified: (
    result: DeclareCheckToolOutput,
    nextState: GameState,
    event: GameEvent,
  ) => void;
}

export function HybridCheckCard({
  campaignId,
  sceneId,
  actorId,
  skill,
  dc,
  dcRef,
  mode = "normal",
  promptEs,
  checkId,
  sticky = true,
  onVerified,
}: HybridCheckCardProps) {
  const { playSound } = useSensoryUI();
  const needsTwoDice = mode !== "normal";
  const [die1, setDie1] = React.useState("");
  const [die2, setDie2] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [expectedRange, setExpectedRange] = React.useState<{
    min: number;
    max: number;
  } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setExpectedRange(null);

    const trimmedDie1 = die1.trim();
    const trimmedDie2 = die2.trim();
    const parsedDie1 = trimmedDie1 === "" ? Number.NaN : Number(trimmedDie1);
    const parsedDie2 = trimmedDie2 === "" ? Number.NaN : Number(trimmedDie2);

    if (!Number.isInteger(parsedDie1)) {
      playSound("notification.warning");
      setErrorMsg("Ingresá un número entero para el dado físico.");
      return;
    }

    if (needsTwoDice && !Number.isInteger(parsedDie2)) {
      playSound("notification.warning");
      setErrorMsg("Ingresá números enteros para ambos dados físicos.");
      return;
    }

    const dieResults = needsTwoDice ? [parsedDie1, parsedDie2] : [parsedDie1];

    setSubmitting(true);
    try {
      const res = await fetch("/api/game/declare-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId,
          sceneId,
          actorId,
          skill,
          ...(dc !== undefined ? { dc } : {}),
          ...(dcRef ? { dcRef } : {}),
          mode,
          dieResults,
          ...(checkId ? { checkId } : {}),
        }),
      });

      const data = (await res.json()) as {
        ok: boolean;
        messageEs?: string;
        expectedRange?: { min: number; max: number };
        result?: DeclareCheckToolOutput;
        state?: GameState;
        event?: GameEvent;
      };

      if (!res.ok || !data.ok || !data.result || !data.state || !data.event) {
        playSound("notification.error");
        setErrorMsg(data.messageEs ?? "El motor rechazó la tirada declarada.");
        setExpectedRange(data.expectedRange ?? null);
        return;
      }

      playSound(
        data.result.naturalRoll === 20
          ? "hero.milestone"
          : "notification.success",
      );
      setDie1("");
      setDie2("");
      onVerified(data.result, data.state, data.event);
    } catch {
      playSound("notification.error");
      setErrorMsg("Error de red al validar la tirada.");
    } finally {
      setSubmitting(false);
    }
  }

  const content = (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-2xl border border-amber-500/35 bg-card/95 p-4 text-sm text-card-foreground shadow-lg backdrop-blur-md"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-semibold">
          <span className="inline-flex size-6 items-center justify-center rounded-md bg-amber-500/15 text-amber-600 dark:text-amber-400">
            <DicesIcon className="size-3.5" />
          </span>
          <span className="font-mono text-xs tracking-tight sm:text-sm">
            Tirada física · {skill} ·{" "}
            {dc !== undefined
              ? `CD ${dc}`
              : dcRef
                ? `CD (${dcRef})`
                : "CD escena"}
          </span>
        </div>
        <span className="rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 font-mono text-[10px] font-medium uppercase text-amber-700 dark:text-amber-300">
          {mode === "normal"
            ? "Normal"
            : mode === "advantage"
              ? "Ventaja"
              : "Desventaja"}
        </span>
      </div>

      {promptEs && <p className="text-muted-foreground">{promptEs}</p>}

      <p className="text-xs text-muted-foreground">
        El motor suma automáticamente tu modificador de ficha al dado físico.
      </p>

      <div
        className={
          needsTwoDice ? "grid grid-cols-2 gap-2" : "grid grid-cols-1 gap-2"
        }
      >
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">
            Dado d20 {needsTwoDice ? "#1" : ""}
          </span>
          <Input
            type="number"
            inputMode="numeric"
            placeholder="1..20"
            className="h-10 font-mono text-base font-semibold tabular-nums"
            value={die1}
            onChange={(e) => setDie1(e.target.value)}
            required
          />
        </label>

        {needsTwoDice && (
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">Dado d20 #2</span>
            <Input
              type="number"
              inputMode="numeric"
              placeholder="1..20"
              className="h-10 font-mono text-base font-semibold tabular-nums"
              value={die2}
              onChange={(e) => setDie2(e.target.value)}
              required
            />
          </label>
        )}
      </div>

      {errorMsg && (
        <Alert variant="destructive">
          <AlertTitle>Tirada rechazada por el motor</AlertTitle>
          <AlertDescription>
            {errorMsg}
            {expectedRange
              ? ` (Rango válido: ${expectedRange.min} a ${expectedRange.max})`
              : ""}
          </AlertDescription>
        </Alert>
      )}

      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={submitting}>
          {submitting ? "Validando…" : "Validar y enviar al DM"}
        </Button>
      </div>
    </form>
  );

  if (!sticky) {
    return content;
  }

  return (
    <div className="sticky bottom-2 isolate z-50 mx-auto w-full max-w-[700px] px-5 pt-2 sm:px-6">
      {content}
    </div>
  );
}
