"use client"

import type { GameEvent, GameState } from "@dungeons/rules"
import {
  ArrowRightIcon,
  CheckIcon,
  DicesIcon,
  LoaderCircleIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react"
import * as React from "react"

import type { DeclareCheckToolOutput } from "@/agent/types"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useSensoryUI } from "@/components/ui/sensory-ui/config/provider"
import { cn } from "@/lib/utils"

export interface HybridCheckCardProps {
  campaignId: string
  sceneId: string
  actorId: string
  actorName?: string
  playerName?: string
  queuePosition?: { current: number; total: number }
  purpose?: "check" | "investigate"
  skill: string
  dc?: number
  dcRef?: string
  mode?: "normal" | "advantage" | "disadvantage"
  promptEs?: string
  checkId?: string
  sticky?: boolean
  onVerified: (
    result: DeclareCheckToolOutput,
    nextState: GameState,
    event: GameEvent
  ) => void
}

type VerifiedCheck = {
  result: DeclareCheckToolOutput
  state: GameState
  event: GameEvent
}

const CHECK_STEPS = ["Desafío", "Dados físicos", "Resultado"] as const
const SKILL_LABELS: Record<string, string> = {
  acrobatics: "Acrobacias",
  animal_handling: "Trato con animales",
  arcana: "Arcanos",
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
}

export function HybridCheckCard({
  campaignId,
  sceneId,
  actorId,
  actorName,
  playerName,
  queuePosition,
  purpose,
  skill,
  dc,
  dcRef,
  mode = "normal",
  promptEs,
  checkId,
  sticky = true,
  onVerified,
}: HybridCheckCardProps) {
  const { playSound } = useSensoryUI()
  const needsTwoDice = mode !== "normal"
  const [die1, setDie1] = React.useState("")
  const [die2, setDie2] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null)
  const [expectedRange, setExpectedRange] = React.useState<{
    min: number
    max: number
  } | null>(null)
  const [verifiedCheck, setVerifiedCheck] =
    React.useState<VerifiedCheck | null>(null)
  const [continuing, setContinuing] = React.useState(false)

  function rollD20(): number {
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
      const buf = new Uint32Array(1)
      crypto.getRandomValues(buf)
      return (buf[0]! % 20) + 1
    }
    return Math.floor(Math.random() * 20) + 1
  }

  async function submitDieResults(dieResults: number[]) {
    if (submitting || verifiedCheck) return

    setErrorMsg(null)
    setExpectedRange(null)
    setSubmitting(true)
    try {
      const res = await fetch("/api/game/declare-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId,
          sceneId,
          actorId,
          skill,
          ...(purpose ? { purpose } : {}),
          ...(dc !== undefined ? { dc } : {}),
          ...(dcRef ? { dcRef } : {}),
          mode,
          dieResults,
          ...(checkId ? { checkId } : {}),
        }),
      })

      const data = (await res.json()) as {
        ok: boolean
        messageEs?: string
        expectedRange?: { min: number; max: number }
        result?: DeclareCheckToolOutput
        state?: GameState
        event?: GameEvent
      }

      if (!res.ok || !data.ok || !data.result || !data.state || !data.event) {
        playSound("notification.error")
        setErrorMsg(data.messageEs ?? "El motor rechazó la tirada declarada.")
        setExpectedRange(data.expectedRange ?? null)
        return
      }

      playSound(
        data.result.naturalRoll === 20
          ? "hero.milestone"
          : "notification.success"
      )
      setVerifiedCheck({
        result: data.result,
        state: data.state,
        event: data.event,
      })
    } catch {
      playSound("notification.error")
      setErrorMsg(
        "No pudimos conectar con el motor. Tus dados siguen guardados; intentá validar otra vez."
      )
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (submitting || verifiedCheck) return

    const parsedDie1 = die1.trim() === "" ? Number.NaN : Number(die1)
    const parsedDie2 = die2.trim() === "" ? Number.NaN : Number(die2)
    const isValidDie = (value: number) =>
      Number.isInteger(value) && value >= 1 && value <= 20

    if (!isValidDie(parsedDie1)) {
      playSound("notification.warning")
      setErrorMsg(
        "El resultado del d20 debe ser un número entero entre 1 y 20."
      )
      return
    }

    if (needsTwoDice && !isValidDie(parsedDie2)) {
      playSound("notification.warning")
      setErrorMsg("Ingresá un resultado válido, entre 1 y 20, para cada d20.")
      return
    }

    const dieResults = needsTwoDice ? [parsedDie1, parsedDie2] : [parsedDie1]
    await submitDieResults(dieResults)
  }

  async function handleAutoRoll() {
    if (submitting || verifiedCheck) return
    playSound("interaction.tap")
    const r1 = rollD20()
    setDie1(String(r1))
    if (needsTwoDice) {
      const r2 = rollD20()
      setDie2(String(r2))
      await submitDieResults([r1, r2])
      return
    }
    await submitDieResults([r1])
  }

  function continueNarration() {
    if (!verifiedCheck || continuing) return
    setContinuing(true)
    onVerified(verifiedCheck.result, verifiedCheck.state, verifiedCheck.event)
  }

  const content = (
    <section
      aria-label={`Tirada física de ${skill}`}
      className="overflow-hidden rounded-none border border-border border-l-2 border-l-amber-500 bg-card text-card-foreground"
    >
      <div className="border-b border-border bg-amber-500/[0.06] px-4 py-4 sm:px-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 inline-flex size-10 shrink-0 items-center justify-center rounded-none border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300">
              {verifiedCheck ? (
                verifiedCheck.result.success ? (
                  <SparklesIcon className="size-5" aria-hidden="true" />
                ) : (
                  <DicesIcon className="size-5" aria-hidden="true" />
                )
              ) : (
                <DicesIcon className="size-5" aria-hidden="true" />
              )}
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold tracking-[0.18em] text-amber-700 uppercase dark:text-amber-300">
                Tirada física
                {actorName
                  ? ` · ${actorName}${playerName ? ` (${playerName})` : ""}`
                  : ""}
              </p>
              <h2 className="mt-0.5 truncate font-serif text-lg leading-tight font-semibold sm:text-xl">
                {SKILL_LABELS[skill] ?? skill}
              </h2>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {queuePosition && queuePosition.total > 1 && (
              <span className="rounded-none border border-amber-500/35 bg-amber-500/15 px-2.5 py-1 font-mono text-[11px] font-semibold text-amber-700 tabular-nums dark:text-amber-300">
                Tirada {queuePosition.current} de {queuePosition.total}
              </span>
            )}
            <span className="rounded-none border border-border bg-background/80 px-2.5 py-1 font-mono text-xs font-semibold text-foreground tabular-nums">
              {verifiedCheck
                ? `CD ${verifiedCheck.result.dc}`
                : purpose === "investigate"
                  ? "Investigación · pistas"
                  : dc !== undefined
                    ? `CD ${dc}`
                    : dcRef
                      ? `CD · ${dcRef}`
                      : "CD de escena"}
            </span>
          </div>
        </div>

        <ol
          aria-label="Etapas de la tirada"
          className="mt-4 grid grid-cols-3 gap-2 border-t border-border/60 pt-3"
        >
          {CHECK_STEPS.map((step, index) => {
            const currentStep = verifiedCheck ? 2 : 1
            const isComplete = index < currentStep
            const isCurrent = index === currentStep

            return (
              <li
                key={step}
                aria-current={isCurrent ? "step" : undefined}
                className="flex min-w-0 items-center gap-1.5"
              >
                <span
                  className={`inline-flex size-5 shrink-0 items-center justify-center rounded-none border text-[10px] font-semibold ${
                    isComplete
                      ? "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300"
                      : isCurrent
                        ? "border-amber-500 bg-amber-500 text-amber-950"
                        : "border-border bg-background/50 text-muted-foreground"
                  }`}
                >
                  {isComplete ? <CheckIcon className="size-3" /> : index + 1}
                </span>
                <span
                  className={`truncate text-[10px] sm:text-xs ${
                    isCurrent
                      ? "font-semibold text-foreground"
                      : "text-muted-foreground"
                  }`}
                >
                  {step}
                </span>
              </li>
            )
          })}
        </ol>
      </div>

      {verifiedCheck ? (
        <div
          aria-live="polite"
          className="flex flex-col gap-4 p-4 motion-reduce:animate-none sm:p-5"
        >
          <div
            className={`rounded-none border border-l-2 p-4 ${
              verifiedCheck.result.success
                ? "border-emerald-500/35 border-l-emerald-500 bg-emerald-500/[0.07]"
                : "border-rose-500/35 border-l-rose-500 bg-rose-500/[0.06]"
            }`}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p
                  className={`text-xs font-semibold tracking-[0.14em] uppercase ${
                    verifiedCheck.result.success
                      ? "text-emerald-700 dark:text-emerald-300"
                      : "text-rose-700 dark:text-rose-300"
                  }`}
                >
                  Resultado verificado
                </p>
                <h3 className="mt-1 font-serif text-2xl font-semibold tracking-tight sm:text-3xl">
                  {verifiedCheck.result.success
                    ? "Lo lograste"
                    : "No alcanzó esta vez"}
                </h3>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
                  Total
                </p>
                <p className="font-mono text-3xl font-bold text-foreground tabular-nums">
                  {verifiedCheck.result.declaredTotal}
                </p>
              </div>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {verifiedCheck.result.margin >= 0
                ? `Superaste la CD por ${verifiedCheck.result.margin}.`
                : `Te faltó ${Math.abs(verifiedCheck.result.margin)} para alcanzar la CD.`}
            </p>
            {verifiedCheck.result.unlockedClues &&
              verifiedCheck.result.unlockedClues.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5 border-t border-emerald-500/20 pt-2.5">
                  {verifiedCheck.result.unlockedClues.map((clue) => (
                    <span
                      key={clue.id}
                      className="rounded-none border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300"
                    >
                      Pista: {clue.titleEs}
                    </span>
                  ))}
                </div>
              )}
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
              Desglose de la tirada
            </p>
            <div className="grid grid-cols-3 divide-x divide-border border border-border bg-muted/20">
              <div className="p-3">
                <p className="text-[10px] text-muted-foreground">
                  Dado{needsTwoDice ? " elegido" : " físico"}
                </p>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span className="font-mono text-xl font-bold tabular-nums">
                    {verifiedCheck.result.naturalRoll}
                  </span>
                  <span className="text-[10px] text-muted-foreground">d20</span>
                </div>
              </div>
              <div className="p-3">
                <p className="text-[10px] text-muted-foreground">Modificador</p>
                <p className="mt-1 font-mono text-xl font-bold tabular-nums">
                  {verifiedCheck.result.expectedModifier > 0 ? "+" : ""}
                  {verifiedCheck.result.expectedModifier}
                </p>
              </div>
              <div className="p-3">
                <p className="text-[10px] text-muted-foreground">
                  Clase de dificultad
                </p>
                <p className="mt-1 font-mono text-xl font-bold tabular-nums">
                  {verifiedCheck.result.dc}
                </p>
              </div>
            </div>
            {verifiedCheck.result.breakdown &&
              verifiedCheck.result.breakdown.length > 0 && (
                <div className="flex flex-wrap gap-1 border border-border bg-muted/15 px-2.5 py-1.5 font-mono text-[10px] tabular-nums">
                  {verifiedCheck.result.breakdown.map((item, idx) => (
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
                      {item.labelEs} {item.value >= 0 ? `+${item.value}` : item.value}
                      {item.diceExpression ? ` (${item.diceExpression})` : ""}
                    </span>
                  ))}
                </div>
              )}
          </div>

          {needsTwoDice && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{mode === "advantage" ? "Ventaja" : "Desventaja"}:</span>
              {verifiedCheck.result.dieResults.map((roll, index) => {
                const keptIndex = verifiedCheck.result.dieResults.reduce(
                  (bestIndex, value, candidateIndex, rolls) => {
                    const isBetter =
                      mode === "advantage"
                        ? value > rolls[bestIndex]
                        : value < rolls[bestIndex]
                    return isBetter ? candidateIndex : bestIndex
                  },
                  0
                )
                const kept = index === keptIndex

                return (
                  <span
                    key={`${roll}-${index}`}
                    aria-label={`${roll}, ${kept ? "dado considerado" : "dado descartado"}`}
                    className={`inline-flex items-center gap-1 rounded-none border px-2 py-1 font-mono tabular-nums ${
                      kept
                        ? "border-amber-500/40 bg-amber-500/10 font-semibold text-foreground"
                        : "border-border bg-muted/30 text-muted-foreground line-through"
                    }`}
                  >
                    {kept ? (
                      <CheckIcon className="size-3" aria-hidden="true" />
                    ) : (
                      <XIcon className="size-3" aria-hidden="true" />
                    )}
                    {roll}
                  </span>
                )
              })}
            </div>
          )}

          <div className="flex justify-end border-t border-border pt-3">
            <Button
              type="button"
              className="rounded-none"
              disabled={continuing}
              onClick={continueNarration}
            >
              {continuing ? (
                <>
                  <LoaderCircleIcon
                    className="animate-spin"
                    data-icon="inline-start"
                  />
                  Enviando al DM…
                </>
              ) : (
                <>
                  {queuePosition &&
                  queuePosition.current < queuePosition.total
                    ? "Siguiente tirada"
                    : "Continuar narración"}
                  <ArrowRightIcon data-icon="inline-end" />
                </>
              )}
            </Button>
          </div>
        </div>
      ) : (
        <form
          onSubmit={handleSubmit}
          noValidate
          className="flex flex-col gap-4 p-4 sm:p-5"
        >
          <div className="rounded-none border border-border border-l-2 border-l-amber-500/75 bg-muted/20 p-3.5 sm:p-4">
            <div className="flex items-center gap-2 text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
              <span className="inline-flex size-5 items-center justify-center rounded-none bg-amber-500/10 text-amber-700 dark:text-amber-300">
                <SparklesIcon className="size-3" aria-hidden="true" />
              </span>
              Qué está en juego
            </div>
            <p className="mt-2 text-sm leading-relaxed text-foreground/90">
              {promptEs ??
                "Hacé tu tirada física y declarala para resolver la acción."}
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-serif text-base font-semibold">Tu tirada</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {needsTwoDice
                  ? mode === "advantage"
                    ? "Tirá 2d20 y el motor conservará el resultado mayor."
                    : "Tirá 2d20 y el motor conservará el resultado menor."
                  : "Tirá 1d20 en tu mesa e ingresá el resultado."}
              </p>
            </div>
            <span className="rounded-none border border-border bg-background px-2.5 py-1 text-[10px] font-medium text-muted-foreground">
              {mode === "normal"
                ? "Tirada normal"
                : mode === "advantage"
                  ? "Con ventaja"
                  : "Con desventaja"}
            </span>
          </div>

          <div
            className={`grid gap-3 ${needsTwoDice ? "grid-cols-2" : "grid-cols-1"}`}
          >
            {[0, ...(needsTwoDice ? [1] : [])].map((index) => {
              const value = index === 0 ? die1 : die2
              const setValue = index === 0 ? setDie1 : setDie2

              return (
                <label
                  key={index}
                  className="group flex min-w-0 flex-col gap-2 rounded-none border border-border bg-background/60 p-3 transition-colors focus-within:border-amber-500/70 focus-within:bg-amber-500/[0.04]"
                >
                  <span className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
                    <span>
                      Dado físico {needsTwoDice ? `#${index + 1}` : "d20"}
                    </span>
                    <span className="font-mono text-[10px]">1–20</span>
                  </span>
                  <span className="relative">
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={20}
                      step={1}
                      placeholder="—"
                      aria-label={`Resultado del dado d20${needsTwoDice ? ` número ${index + 1}` : ""}`}
                      aria-invalid={Boolean(errorMsg)}
                      aria-describedby={
                        errorMsg ? "hybrid-check-error" : undefined
                      }
                      autoComplete="off"
                      className="h-16 rounded-none border-0 bg-transparent text-center font-mono text-4xl font-bold tabular-nums shadow-none placeholder:text-muted-foreground/25 focus-visible:ring-0"
                      value={value}
                      onChange={(event) => {
                        setValue(event.target.value)
                        setErrorMsg(null)
                        setExpectedRange(null)
                      }}
                      disabled={submitting}
                    />
                  </span>
                </label>
              )
            })}
          </div>

          {errorMsg && (
            <Alert
              id="hybrid-check-error"
              variant="destructive"
              aria-live="polite"
              className="rounded-none border-l-2 border-l-destructive"
            >
              <AlertTitle>No se pudo validar la tirada</AlertTitle>
              <AlertDescription>
                {errorMsg}
                {expectedRange
                  ? ` Rango esperado para el total: ${expectedRange.min}–${expectedRange.max}.`
                  : ""}
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col gap-3 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-xs text-[11px] leading-relaxed text-muted-foreground">
              El motor suma el modificador de tu ficha y verifica la tirada. No
              ingreses el total.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="lg"
                disabled={submitting}
                onClick={() => void handleAutoRoll()}
                title={`Tirar ${needsTwoDice ? "2d20" : "1d20"} digitalmente por vos`}
                className="rounded-none border-primary/45 bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary"
              >
                <DicesIcon data-icon="inline-start" />
                Tirar por mí
              </Button>
              <Button
                type="submit"
                size="lg"
                disabled={submitting}
                className="rounded-none sm:min-w-44"
              >
                {submitting ? (
                  <>
                    <LoaderCircleIcon
                      className="animate-spin"
                      data-icon="inline-start"
                    />
                    Validando tirada
                  </>
                ) : (
                  <>
                    <DicesIcon data-icon="inline-start" />
                    Validar resultado
                  </>
                )}
              </Button>
            </div>
          </div>
        </form>
      )}
    </section>
  )

  if (!sticky) return content

  return (
    <div className="sticky bottom-2 isolate z-50 mx-auto w-full max-w-[700px] px-3 pt-2 sm:px-6">
      {content}
    </div>
  )
}
