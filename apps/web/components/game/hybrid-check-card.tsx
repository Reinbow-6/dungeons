"use client";

import type { GameEvent, GameState } from "@dungeons/rules";
import * as React from "react";

import type { DeclareCheckToolOutput } from "@/agent/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
      setErrorMsg("Ingresá un número entero para el dado físico.");
      return;
    }

    if (needsTwoDice && !Number.isInteger(parsedDie2)) {
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
        setErrorMsg(data.messageEs ?? "El motor rechazó la tirada declarada.");
        setExpectedRange(data.expectedRange ?? null);
        return;
      }

      setDie1("");
      setDie2("");
      onVerified(data.result, data.state, data.event);
    } catch {
      setErrorMsg("Error de red al validar la tirada.");
    } finally {
      setSubmitting(false);
    }
  }

  const content = (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-2xl border bg-popover p-4 text-sm text-popover-foreground shadow-sm"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">
          Tirada física (Modo Híbrido) — {skill} ·{" "}
          {dc !== undefined
            ? `CD ${dc}`
            : dcRef
              ? `CD (${dcRef})`
              : "CD escena"}
        </span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs uppercase">
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
          <span>Dado d20 {needsTwoDice ? "#1" : ""}</span>
          <Input
            type="number"
            inputMode="numeric"
            placeholder="1..20"
            value={die1}
            onChange={(e) => setDie1(e.target.value)}
            required
          />
        </label>

        {needsTwoDice && (
          <label className="flex flex-col gap-1 text-xs">
            <span>Dado d20 #2</span>
            <Input
              type="number"
              inputMode="numeric"
              placeholder="1..20"
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
    <div className="sticky bottom-2 isolate z-50 mx-auto w-full max-w-2xl px-6 pt-2">
      {content}
    </div>
  );
}
