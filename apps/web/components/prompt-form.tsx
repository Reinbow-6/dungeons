"use client";

import * as React from "react";
import {
  ArrowUpIcon,
  CheckIcon,
  Loader2Icon,
  MicIcon,
  SendHorizontalIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";

import { ModelSelect } from "@/components/model-select";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { useSensoryUI } from "@/components/ui/sensory-ui/config/provider";
import { useVoiceRecorder } from "@/hooks/use-voice-recorder";
import { type GatewayModel } from "@/lib/models";
import { cn } from "@/lib/utils";

function formatElapsed(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

const EQ_MULTIPLIERS = [0.45, 0.85, 1.0, 0.72, 0.5] as const;

export function PromptForm({
  models,
  model,
  lockedModelIds,
  onModelChange,
  isBusy,
  onSubmit,
  onStop,
}: {
  models: GatewayModel[];
  model: string;
  lockedModelIds?: ReadonlySet<string>;
  onModelChange: (model: string) => void;
  isBusy: boolean;
  onSubmit: (text: string) => void;
  onStop: () => void;
}) {
  const { playSound } = useSensoryUI();
  const [input, setInput] = React.useState("");
  const [autoSendVoice, setAutoSendVoice] = React.useState(false);

  const autoSendRef = React.useRef(autoSendVoice);
  const isBusyRef = React.useRef(isBusy);
  const onSubmitRef = React.useRef(onSubmit);
  const playSoundRef = React.useRef(playSound);

  React.useEffect(() => {
    autoSendRef.current = autoSendVoice;
    isBusyRef.current = isBusy;
    onSubmitRef.current = onSubmit;
    playSoundRef.current = playSound;
  }, [autoSendVoice, isBusy, onSubmit, playSound]);

  const handleTranscript = React.useCallback((transcript: string) => {
    const clean = transcript.trim();
    if (!clean) return;

    playSoundRef.current("notification.success");

    if (autoSendRef.current && !isBusyRef.current) {
      onSubmitRef.current(clean);
      setInput("");
      return;
    }

    setInput((prev) => {
      const base = prev.trimEnd();
      return base ? `${base} ${clean}` : clean;
    });
  }, []);

  const {
    phase,
    elapsedSec,
    audioLevel,
    errorMsg,
    startRecording,
    stopAndTranscribe,
    cancelRecording,
    clearError,
  } = useVoiceRecorder({
    onTranscript: handleTranscript,
  });

  const prevErrorRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (errorMsg && errorMsg !== prevErrorRef.current) {
      playSoundRef.current("notification.error");
    }
    prevErrorRef.current = errorMsg;
  }, [errorMsg]);

  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        if (phase === "recording") {
          playSoundRef.current("interaction.tap");
          stopAndTranscribe();
        } else if (phase === "idle" && !isBusyRef.current) {
          playSoundRef.current("overlay.open");
          void startRecording();
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [phase, startRecording, stopAndTranscribe]);

  function handleSubmit(event?: React.FormEvent) {
    event?.preventDefault();
    const text = input.trim();
    if (!text || isBusy || phase !== "idle") return;
    playSound("interaction.confirm");
    onSubmit(text);
    setInput("");
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-1.5">
      {errorMsg && (
        <div
          role="alert"
          className="flex items-center justify-between gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-700 dark:text-rose-300"
        >
          <span className="truncate">{errorMsg}</span>
          <button
            type="button"
            onClick={clearError}
            aria-label="Cerrar aviso de voz"
            className="shrink-0 rounded p-0.5 hover:bg-rose-500/15"
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
      )}

      <InputGroup className="rounded-2xl border border-border/80 bg-card/90 shadow-sm focus-within:border-foreground/25 focus-within:ring-2 focus-within:ring-ring/25">
        <InputGroupTextarea
          aria-label="Acción o diálogo para el Dungeon Master"
          placeholder="Describí tu acción, hablá con el micrófono o tirá una prueba…"
          className="p-3.5 text-sm"
          value={input}
          disabled={phase !== "idle"}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              handleSubmit();
            }
          }}
        />
        <InputGroupAddon align="block-end" className="gap-1.5">
          <ModelSelect
            models={models}
            value={model}
            onValueChange={onModelChange}
            lockedModelIds={lockedModelIds}
          />

          {phase === "recording" ? (
            <div className="ml-auto flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-2.5 py-1">
              <span className="size-2 shrink-0 animate-pulse rounded-full bg-rose-500" />
              <div
                aria-hidden="true"
                className="flex h-3.5 items-center gap-0.5"
              >
                {EQ_MULTIPLIERS.map((mult, idx) => {
                  const pct = Math.max(
                    22,
                    Math.min(100, Math.round((0.18 + audioLevel * mult) * 100)),
                  );
                  return (
                    <span
                      key={idx}
                      className="w-0.5 rounded-full bg-rose-500/85 transition-[height] duration-75"
                      style={{ height: `${pct}%` }}
                    />
                  );
                })}
              </div>
              <span className="font-mono text-[11px] font-medium tabular-nums text-rose-700 dark:text-rose-300">
                {formatElapsed(elapsedSec)}
              </span>
              <InputGroupButton
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label="Cancelar grabación"
                title="Cancelar grabación"
                onClick={() => {
                  playSound("overlay.close");
                  cancelRecording();
                }}
              >
                <XIcon className="size-3.5" />
              </InputGroupButton>
              <InputGroupButton
                type="button"
                size="xs"
                variant="default"
                aria-label="Transcribir audio"
                title="Detener y transcribir (Alt+M)"
                className="bg-rose-600 text-white hover:bg-rose-500"
                onClick={() => {
                  playSound("interaction.tap");
                  stopAndTranscribe();
                }}
              >
                <CheckIcon className="size-3.5" />
                <span>Listo</span>
              </InputGroupButton>
            </div>
          ) : phase === "transcribing" ? (
            <div className="ml-auto flex items-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-800 dark:text-amber-300">
              <Loader2Icon className="size-3.5 animate-spin" />
              <span>Transcribiendo con Whisper…</span>
            </div>
          ) : (
            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  playSound("interaction.toggle");
                  setAutoSendVoice((prev) => !prev);
                }}
                aria-pressed={autoSendVoice}
                title="Si está activo, envía automáticamente el mensaje al terminar la transcripción"
                className={cn(
                  "hidden min-h-7 items-center gap-1 rounded-xl border px-2 text-[11px] font-medium transition-colors sm:inline-flex",
                  autoSendVoice
                    ? "border-amber-500/45 bg-amber-500/15 text-amber-800 dark:text-amber-300"
                    : "border-transparent text-muted-foreground hover:border-border hover:bg-muted/70 hover:text-foreground",
                )}
              >
                <SendHorizontalIcon className="size-3" />
                <span>Auto</span>
              </button>

              <InputGroupButton
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label="Grabar mensaje por voz (Alt+M)"
                title="Hablar por micrófono · Groq Whisper (Alt+M)"
                disabled={isBusy}
                onClick={() => {
                  playSound("overlay.open");
                  void startRecording();
                }}
              >
                <MicIcon className="size-4" />
              </InputGroupButton>

              {isBusy ? (
                <InputGroupButton
                  type="button"
                  size="icon-sm"
                  variant="outline"
                  aria-label="Detener generación"
                  onClick={onStop}
                >
                  <SquareIcon />
                </InputGroupButton>
              ) : (
                <InputGroupButton
                  type="submit"
                  size="icon-sm"
                  variant="default"
                  aria-label="Enviar mensaje"
                  disabled={!input.trim()}
                >
                  <ArrowUpIcon />
                </InputGroupButton>
              )}
            </div>
          )}
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
