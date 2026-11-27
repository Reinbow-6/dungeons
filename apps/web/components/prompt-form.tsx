"use client";

import { CORE_SPELLS_521, type GameState } from "@dungeons/rules";
import {
  ArrowUpIcon,
  AtSignIcon,
  CheckIcon,
  Loader2Icon,
  MicIcon,
  PauseIcon,
  PlayIcon,
  SendIcon,
  SquareIcon,
  TerminalIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import * as React from "react";

import { ModelSelect } from "@/components/model-select";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { useSensoryUI } from "@/components/ui/sensory-ui/config/provider";
import { useVoiceRecorder } from "@/hooks/use-voice-recorder";
import {
  DIRECT_COMMANDS,
  getMentionCandidates,
} from "@/lib/game/direct-commands";
import { type GatewayModel } from "@/lib/models";
import { cn } from "@/lib/utils";

function formatElapsed(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

const EQ_MULTIPLIERS = [0.45, 0.85, 1.0, 0.72, 0.5] as const;

interface AutocompleteOption {
  id: string;
  label: string;
  detail: string;
  badge?: string;
  kind: "command" | "mention";
  apply: (currentInput: string) => string;
}

export interface PromptFormHandle {
  setDraft: (text: string) => void;
}

export function PromptForm({
  models,
  model,
  lockedModelIds,
  onModelChange,
  isBusy,
  gameState,
  activeActorId,
  pausedMode = false,
  onTogglePausedMode,
  pausedCount = 0,
  onFlushPaused,
  onClearPaused,
  formRef,
  onSubmit,
  onStop,
}: {
  models: GatewayModel[];
  model: string;
  lockedModelIds?: ReadonlySet<string>;
  onModelChange: (model: string) => void;
  isBusy: boolean;
  gameState?: GameState | null;
  activeActorId?: string | null;
  pausedMode?: boolean;
  onTogglePausedMode?: () => void;
  pausedCount?: number;
  onFlushPaused?: () => void;
  onClearPaused?: () => void;
  formRef?: React.Ref<PromptFormHandle>;
  onSubmit: (text: string) => void;
  onStop: () => void;
}) {
  const { playSound } = useSensoryUI();
  const [input, setInput] = React.useState("");
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);

  const isBusyRef = React.useRef(isBusy);
  const playSoundRef = React.useRef(playSound);

  React.useEffect(() => {
    isBusyRef.current = isBusy;
    playSoundRef.current = playSound;
  }, [isBusy, playSound]);

  React.useImperativeHandle(
    formRef,
    () => ({
      setDraft(text: string) {
        setInput(text);
        setSelectedIndex(0);
        window.requestAnimationFrame(() => {
          const el = textareaRef.current;
          if (el) {
            el.focus();
            el.setSelectionRange(text.length, text.length);
          }
        });
      },
    }),
    [],
  );

  const handleTranscript = React.useCallback((transcript: string) => {
    const clean = transcript.trim();
    if (!clean) return;

    playSoundRef.current("notification.success");

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

  const autocompleteOptions = React.useMemo<AutocompleteOption[]>(() => {
    if (phase !== "idle" || isBusy) return [];

    // 1. Check active `@mention` at the end of the text
    const mentionMatch = input.match(/(?:^|\s)@([^\s]*)$/);
    if (mentionMatch) {
      const query = (mentionMatch[1] ?? "").toLowerCase();
      const candidates = getMentionCandidates(gameState ?? null);
      return candidates
        .filter(
          (c) =>
            !query ||
            c.handle.toLowerCase().includes(query) ||
            c.label.toLowerCase().includes(query),
        )
        .slice(0, 6)
        .map((c) => ({
          id: `mention:${c.id}`,
          label: `@${c.handle}`,
          detail: `${c.label} · ${c.detail}`,
          badge:
            c.kind === "pc"
              ? "PJ"
              : c.kind === "enemy"
                ? "Enemigo"
                : c.kind === "ally"
                  ? "Aliado"
                  : "NPC",
          kind: "mention" as const,
          apply: (cur) =>
            cur.replace(/@([^\s]*)$/, `@${c.handle} `),
        }));
    }

    // 2. Check `/hechizo <query>` spell suggestions
    const spellMatch = input.match(/^\/(?:hechizo|conjuro|cast)\s+([^\s@]*)$/i);
    if (spellMatch && gameState) {
      const query = (spellMatch[1] ?? "").toLowerCase();
      const activeChar =
        (activeActorId ? gameState.characters[activeActorId] : undefined) ??
        Object.values(gameState.characters)[0];
      const known = activeChar?.knownSpells ?? [];
      return known
        .filter((slug) => {
          const nameEs = CORE_SPELLS_521[slug]?.nameEs.toLowerCase() ?? "";
          return !query || slug.includes(query) || nameEs.includes(query);
        })
        .slice(0, 6)
        .map((slug) => {
          const spec = CORE_SPELLS_521[slug];
          return {
            id: `spell:${slug}`,
            label: `/hechizo ${slug}`,
            detail: spec
              ? `${spec.nameEs} · ${spec.level === 0 ? "Truco" : `Nivel ${spec.level}`}`
              : slug,
            badge: spec?.level === 0 ? "Truco" : spec ? `Nv.${spec.level}` : undefined,
            kind: "command" as const,
            apply: () => `/hechizo ${slug} `,
          };
        });
    }

    // 3. Check `/ir <scene>` scene transition suggestions
    const travelMatch = input.match(/^\/(?:ir|viajar|escena)\s+([^\s@]*)$/i);
    if (travelMatch && gameState) {
      const query = (travelMatch[1] ?? "").toLowerCase();
      const currentScene = gameState.scenes[gameState.sceneId];
      const allowed = currentScene?.allowedTransitions ?? [];
      return allowed
        .filter((id) => {
          const title = gameState.scenes[id]?.titleEs.toLowerCase() ?? "";
          return !query || id.toLowerCase().includes(query) || title.includes(query);
        })
        .map((id) => ({
          id: `scene:${id}`,
          label: `/ir ${id}`,
          detail: gameState.scenes[id]?.titleEs ?? id,
          badge: "Escena",
          kind: "command" as const,
          apply: () => `/ir ${id}`,
        }));
    }

    // 4. Check top-level `/` command completion
    if (input.startsWith("/") && !input.includes(" ")) {
      const query = input.toLowerCase();
      return DIRECT_COMMANDS.filter((c) => c.command.startsWith(query))
        .slice(0, 7)
        .map((c) => ({
          id: `cmd:${c.command}`,
          label: c.usage,
          detail: c.description,
          badge: c.toolHint,
          kind: "command" as const,
          apply: () => c.template,
        }));
    }

    return [];
  }, [activeActorId, gameState, input, isBusy, phase]);

  const activeOptionIndex =
    autocompleteOptions.length > 0
      ? Math.min(selectedIndex, autocompleteOptions.length - 1)
      : 0;

  function applyAutocomplete(opt: AutocompleteOption) {
    playSound("interaction.subtle");
    const next = opt.apply(input);
    setInput(next);
    setSelectedIndex(0);
    textareaRef.current?.focus();
  }

  function handleSubmit(event?: React.FormEvent) {
    event?.preventDefault();
    const text = input.trim();
    if (!text || isBusy || phase !== "idle") return;
    playSound("interaction.confirm");
    onSubmit(text);
    setInput("");
    setSelectedIndex(0);
  }

  const partyChars = React.useMemo(
    () => (gameState ? Object.values(gameState.characters) : []),
    [gameState],
  );
  const currentActor =
    (activeActorId && gameState ? gameState.characters[activeActorId] : undefined) ??
    partyChars[0];
  const combatActive = Boolean(gameState?.combat?.active);
  const canPauseParty = partyChars.length > 1 && Boolean(onTogglePausedMode);
  const showPausedStrip =
    partyChars.length > 1 && (pausedMode || pausedCount > 0);
  const shortActorName =
    currentActor?.name.trim().split(/\s+/)[0] ?? currentActor?.name;
  const textareaPlaceholder =
    partyChars.length > 1 && currentActor
      ? pausedMode
        ? `Escribí como ${shortActorName}${currentActor.playerName ? ` (${currentActor.playerName})` : ""} — DM en pausa…`
        : `¿Qué hace ${shortActorName}${currentActor.playerName ? ` (${currentActor.playerName})` : ""}? Usá / o @…`
      : "Escribí tu acción, usá / para mecánicas directas, @ para mencionar o dictá con el micrófono…";

  return (
    <form onSubmit={handleSubmit} className="relative flex flex-col">
      {autocompleteOptions.length > 0 && (
        <div
          role="listbox"
          aria-label="Autocompletado de comandos y menciones"
          className="absolute bottom-full left-0 right-0 z-40 mb-1.5 overflow-hidden rounded-none border border-border bg-popover/95 p-1.5 shadow-xl backdrop-blur-md"
        >
          <div className="mb-1 flex items-center justify-between border-b border-border/60 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              {autocompleteOptions[0]?.kind === "mention" ? (
                <>
                  <AtSignIcon className="size-3 text-amber-500" />
                  Mencionar PJ o NPC
                </>
              ) : (
                <>
                  <TerminalIcon className="size-3 text-emerald-500" />
                  Guía de comando (/)
                </>
              )}
            </span>
            <span className="font-mono text-[9.5px] normal-case opacity-80">
              Tab / Enter para insertar
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            {autocompleteOptions.map((opt, idx) => {
              const selected = idx === activeOptionIndex;
              return (
                <button
                  key={opt.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applyAutocomplete(opt);
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-none border-l-2 px-2.5 py-1.5 text-left text-xs transition-colors",
                    selected
                      ? "border-l-primary bg-accent text-accent-foreground"
                      : "border-l-transparent text-foreground/90 hover:bg-accent/50",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-[11.5px] font-semibold">
                      {opt.label}
                    </div>
                    <div className="truncate text-[10.5px] text-muted-foreground">
                      {opt.detail}
                    </div>
                  </div>
                  {opt.badge && (
                    <span className="shrink-0 rounded-none border border-border/70 bg-background/70 px-1.5 py-0.5 font-mono text-[9.5px] text-muted-foreground">
                      {opt.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {errorMsg && (
        <div
          role="alert"
          className="mb-1.5 flex items-center justify-between gap-2 rounded-none border border-rose-500/35 border-l-2 border-l-rose-500 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-700 dark:text-rose-300"
        >
          <span className="truncate">{errorMsg}</span>
          <button
            type="button"
            onClick={clearError}
            aria-label="Cerrar aviso de voz"
            className="shrink-0 rounded-none p-0.5 hover:bg-rose-500/15"
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
      )}

      <InputGroup className="rounded-none border border-border bg-card shadow-none focus-within:border-foreground/30 focus-within:ring-1 focus-within:ring-ring/25">
        {showPausedStrip && (
          <div className="flex w-full flex-wrap items-center justify-between gap-2 border-b border-border/60 border-l-2 border-l-amber-500 bg-amber-500/[0.06] px-3 py-1.5 text-[11px]">
            <div className="flex min-w-0 items-center gap-2">
              <span className="inline-flex items-center gap-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                <PauseIcon className="size-3 shrink-0" />
                {pausedMode ? "DM en pausa" : "Cola en pausa"}
              </span>
              <span className="truncate text-muted-foreground">
                {pausedCount === 0
                  ? "Turnos libres entre jugadores sin enviar al DM."
                  : `${pausedCount} ${pausedCount === 1 ? "mensaje acumulado" : "mensajes acumulados"}`}
              </span>
            </div>
            <div className="ml-auto flex items-center gap-1.5">
              {pausedCount > 0 && onClearPaused && (
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => {
                    playSound("interaction.tap");
                    onClearPaused();
                  }}
                  className="inline-flex h-6 items-center gap-1 rounded-none border border-border bg-background px-2 text-[10.5px] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-45"
                >
                  <Trash2Icon className="size-3" />
                  Limpiar
                </button>
              )}
              {onFlushPaused && (
                <button
                  type="button"
                  disabled={isBusy || pausedCount === 0}
                  onClick={() => {
                    playSound("interaction.confirm");
                    onFlushPaused();
                  }}
                  className="inline-flex h-6 items-center gap-1 rounded-none bg-amber-500 px-2.5 text-[10.5px] font-semibold text-amber-950 transition-colors hover:bg-amber-400 disabled:opacity-45"
                >
                  <SendIcon className="size-3" />
                  Enviar al DM ({pausedCount})
                </button>
              )}
            </div>
          </div>
        )}

        <InputGroupTextarea
          ref={textareaRef}
          aria-label="Acción, comando directo o diálogo para el Dungeon Master"
          placeholder={textareaPlaceholder}
          className="rounded-none p-3.5 text-sm"
          value={input}
          disabled={phase !== "idle"}
          onChange={(event) => {
            setInput(event.target.value);
            setSelectedIndex(0);
          }}
          onKeyDown={(event) => {
            if (autocompleteOptions.length > 0) {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setSelectedIndex(
                  (prev) => (prev + 1) % autocompleteOptions.length,
                );
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setSelectedIndex(
                  (prev) =>
                    (prev - 1 + autocompleteOptions.length) %
                    autocompleteOptions.length,
                );
                return;
              }
              if (event.key === "Tab") {
                event.preventDefault();
                const opt = autocompleteOptions[activeOptionIndex];
                if (opt) applyAutocomplete(opt);
                return;
              }
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                const opt = autocompleteOptions[activeOptionIndex];
                // If user typed a partial token (e.g. "/inv" or "@Mir"), complete it;
                // if it already matches a full command, allow submit!
                if (
                  opt &&
                  (opt.kind === "mention" ||
                    input.trim() !== opt.label.trim())
                ) {
                  event.preventDefault();
                  applyAutocomplete(opt);
                  return;
                }
              }
            }

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
        <InputGroupAddon
          align="block-end"
          className="w-full justify-between gap-2 px-2.5 py-1.5"
        >
          <div className="flex min-w-0 items-center gap-1.5">
            <ModelSelect
              models={models}
              value={model}
              onValueChange={onModelChange}
              lockedModelIds={lockedModelIds}
            />
            {canPauseParty && (
              <>
                <span
                  aria-hidden="true"
                  className="h-4 w-px shrink-0 bg-border/70"
                />
                <button
                  type="button"
                  disabled={isBusy || (combatActive && !pausedMode)}
                  onClick={() => {
                    playSound("interaction.toggle");
                    onTogglePausedMode?.();
                  }}
                  aria-pressed={pausedMode}
                  title={
                    combatActive && !pausedMode
                      ? "Modo pausado disponible fuera de combate (o enviá lo pendiente)"
                      : "DM en pausa: varios jugadores mandan acciones/diálogos libremente antes de enviar todo al DM"
                  }
                  className={cn(
                    "inline-flex h-7 shrink-0 items-center gap-1 rounded-none border px-2 text-[11px] font-medium transition-colors disabled:opacity-45",
                    pausedMode
                      ? "border-amber-500/60 bg-amber-500/15 text-amber-800 dark:text-amber-200"
                      : "border-transparent bg-transparent text-muted-foreground hover:border-border/70 hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  {pausedMode ? (
                    <>
                      <PlayIcon className="size-3" />
                      <span>DM en pausa</span>
                    </>
                  ) : (
                    <>
                      <PauseIcon className="size-3" />
                      <span>Pausar DM</span>
                    </>
                  )}
                </button>
              </>
            )}
          </div>

          {phase === "recording" ? (
            <div className="ml-auto flex items-center gap-2 rounded-none border border-rose-500/35 bg-rose-500/10 px-2.5 py-1">
              <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-rose-500" />
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
                      className="w-0.5 rounded-none bg-rose-500/85 transition-[height] duration-75"
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
                className="rounded-none"
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
                className="rounded-none bg-rose-600 text-white hover:bg-rose-500"
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
            <div className="ml-auto flex items-center gap-1.5 rounded-none border border-amber-500/35 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-800 dark:text-amber-300">
              <Loader2Icon className="size-3.5 animate-spin" />
              <span>Transcribiendo con Whisper…</span>
            </div>
          ) : (
            <div className="ml-auto flex items-center gap-1">
              <InputGroupButton
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label="Grabar mensaje por voz (Alt+M)"
                title="Hablar por micrófono · Groq Whisper (Alt+M)"
                disabled={isBusy}
                className="rounded-none"
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
                  className="rounded-none"
                  onClick={onStop}
                >
                  <SquareIcon />
                </InputGroupButton>
              ) : (
                <InputGroupButton
                  type="submit"
                  size="icon-sm"
                  variant="default"
                  aria-label="Enviar mensaje o comando"
                  disabled={!input.trim()}
                  className="rounded-none"
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
