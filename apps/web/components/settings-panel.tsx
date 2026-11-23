"use client";

import { Dialog } from "@base-ui/react/dialog";
import { Switch } from "@base-ui/react/switch";
import {
  BotIcon,
  BrainIcon,
  CheckIcon,
  LockIcon,
  RotateCcwIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  Volume2Icon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import * as React from "react";

import { useAuthAccess } from "@/components/auth-dialog";
import { Button } from "@/components/ui/button";
import { useSensoryUI } from "@/components/ui/sensory-ui/config/provider";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { MODELS, type ReasoningEffort } from "@/lib/models";
import {
  type StreamSpeed,
  useAppSettings,
} from "@/lib/settings/app-settings";
import { TTS_MODELS, type TtsModelId } from "@/lib/tts-models";
import { cn } from "@/lib/utils";

const STREAM_SPEED_OPTIONS: ReadonlyArray<{
  value: StreamSpeed;
  label: string;
}> = [
  { value: "slow", label: "Lenta" },
  { value: "normal", label: "Normal" },
  { value: "fast", label: "Rápida" },
  { value: "instant", label: "Sin pausa" },
];

const REASONING_OPTIONS: ReadonlyArray<{
  value: ReasoningEffort;
  label: string;
  hint: string;
}> = [
  {
    value: "none",
    label: "Apagado",
    hint: "Respuesta directa y latencia mínima; menor consumo.",
  },
  {
    value: "low",
    label: "Bajo",
    hint: "Razonamiento breve para reglas y transiciones ágiles.",
  },
  {
    value: "medium",
    label: "Medio",
    hint: "Balance entre táctica, memoria y tiempo de respuesta.",
  },
  {
    value: "high",
    label: "Alto",
    hint: "Máxima profundidad narrativa; mayor espera y créditos.",
  },
];

const TTS_SPEED_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0.9, label: "0.9x" },
  { value: 1.0, label: "1.0x" },
  { value: 1.15, label: "1.15x" },
];

function SettingSwitchRow({
  label,
  description,
  checked,
  disabled = false,
  onCheckedChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const id = React.useId();

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/55 px-3 py-2 transition-opacity",
        disabled && "opacity-55",
      )}
    >
      <label
        htmlFor={id}
        className={cn(
          "flex min-w-0 flex-1 flex-col gap-0.5",
          disabled ? "cursor-not-allowed" : "cursor-pointer",
        )}
      >
        <span className="text-xs font-medium text-foreground">{label}</span>
        {description && (
          <span className="text-[11px] leading-snug text-muted-foreground">
            {description}
          </span>
        )}
      </label>
      <Switch.Root
        id={id}
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onCheckedChange={onCheckedChange}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border p-0.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed",
          checked
            ? "border-amber-500/50 bg-amber-600 dark:bg-amber-500"
            : "border-border bg-muted",
        )}
      >
        <Switch.Thumb
          className={cn(
            "pointer-events-none block size-3.5 rounded-full bg-background shadow-xs transition-transform",
            checked ? "translate-x-4" : "translate-x-0",
          )}
        />
      </Switch.Root>
    </div>
  );
}

export function SettingsPanel() {
  const [open, setOpen] = React.useState(false);
  const { playSound } = useSensoryUI();
  const { settings, updateSettings, resetSettings } = useAppSettings();
  const { tier, authenticated, email, loading: authLoading } = useAuthAccess();

  const isGuest = tier === "guest";
  const allDevHidden =
    !settings.showDevContextMeter &&
    !settings.showDevLatencyTimer &&
    !settings.showDevReasoningView;

  const effectiveTextModelId = React.useMemo(() => {
    const selected = MODELS.find((m) => m.id === settings.textModel);
    if (isGuest) {
      if (selected && selected.accessTier === "free") {
        return selected.id;
      }
      return (
        MODELS.find((m) => m.accessTier === "free")?.id ?? settings.textModel
      );
    }
    return selected?.id ?? MODELS[0]?.id ?? settings.textModel;
  }, [isGuest, settings.textModel]);

  const activeReasoningOption =
    REASONING_OPTIONS.find((opt) => opt.value === settings.reasoningEffort) ??
    REASONING_OPTIONS[0]!;

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen === open) {
      return;
    }
    setOpen(nextOpen);
    void playSound(nextOpen ? "overlay.open" : "overlay.close");
  }

  function handleOpenAuth() {
    void playSound("overlay.open");
    setOpen(false);
    window.dispatchEvent(new Event("dungeons:open-auth"));
  }

  function handleToggleSound() {
    void playSound("interaction.toggle");
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Abrir ajustes de modelos, voz y desarrollador"
              aria-expanded={open}
              aria-haspopup="dialog"
              onClick={() => handleOpenChange(true)}
              className="fixed bottom-[calc(env(safe-area-inset-bottom)+8rem)] left-3 z-30 border border-border/70 bg-card/90 shadow-sm backdrop-blur-md sm:bottom-5 sm:left-5"
            >
              <SlidersHorizontalIcon className="size-4" />
            </Button>
          }
        />
        <TooltipContent>Ajustes de modelos, voz y desarrollador</TooltipContent>
      </Tooltip>

      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px] transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup
          role="dialog"
          aria-modal="true"
              className="fixed inset-y-0 left-0 z-50 flex w-[412px] max-w-[94vw] flex-col border-r border-border/80 bg-sidebar/95 text-xs shadow-2xl backdrop-blur-xl transition-transform duration-200 ease-out outline-none data-ending-style:-translate-x-full data-starting-style:-translate-x-full"
        >
          {/* Cabecera */}
          <div className="flex items-start justify-between gap-3 border-b border-border/70 px-4 py-3.5">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Dialog.Title className="font-serif text-base font-semibold tracking-tight text-foreground">
                  Ajustes de la Mesa
                </Dialog.Title>
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5 font-mono text-[10px] font-medium",
                    isGuest
                      ? "border-border/80 bg-muted/70 text-muted-foreground"
                      : "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                  )}
                >
                  {authLoading
                    ? "Verificando…"
                    : isGuest
                      ? authenticated
                        ? "Sin whitelist"
                        : "Invitado"
                      : "Autorizado"}
                </span>
              </div>
              <Dialog.Description className="mt-0.5 text-[11px] text-muted-foreground">
                {email
                  ? `Sesión: ${email}`
                  : "Configurá el modelo del DM, razonamiento, narración TTS y utilidades."}
              </Dialog.Description>
            </div>
            <Dialog.Close
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Cerrar ajustes"
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                >
                  <XIcon className="size-4" />
                </Button>
              }
            />
          </div>

          {/* Cuerpo scrollable */}
          <div className="flex flex-1 flex-col gap-3.5 overflow-y-auto p-4">
            {/* 1. Modelo de Texto (DM) */}
            <section
              aria-labelledby="settings-text-model-title"
              className="flex flex-col gap-2.5 rounded-xl border border-border/80 bg-card/85 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <BotIcon className="size-3.5 text-amber-600 dark:text-amber-400" />
                  <h3
                    id="settings-text-model-title"
                    className="font-serif text-sm font-semibold text-foreground"
                  >
                    Modelo de Texto (DM)
                  </h3>
                </div>
                {isGuest && (
                  <span className="font-mono text-[10px] text-muted-foreground">
                    Tier gratuito activo
                  </span>
                )}
              </div>

              <div
                role="radiogroup"
                aria-labelledby="settings-text-model-title"
                className="grid grid-cols-2 gap-1.5"
              >
                {MODELS.map((model) => {
                  const locked = model.accessTier === "whitelisted" && isGuest;
                  const selected = effectiveTextModelId === model.id && !locked;

                  return (
                    <button
                      key={model.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      disabled={locked}
                      onClick={() => {
                        if (locked) return;
                        handleToggleSound();
                        updateSettings({ textModel: model.id });
                      }}
                      className={cn(
                        "flex min-h-10 items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        locked
                          ? "cursor-not-allowed border-border/60 bg-muted/35 opacity-65"
                          : selected
                            ? "border-amber-500/45 bg-amber-500/10 text-foreground"
                            : "border-border/70 bg-background/60 text-foreground/90 hover:border-border hover:bg-muted/50",
                      )}
                    >
                      <span className="truncate text-xs font-medium">
                        {model.name}
                      </span>
                      <div className="flex shrink-0 items-center gap-1">
                        {locked ? (
                          <LockIcon
                            className="size-3 text-amber-700 dark:text-amber-300"
                            aria-label="Solo Whitelist"
                          />
                        ) : selected ? (
                          <span className="inline-flex size-4 items-center justify-center rounded-full bg-amber-500/20 text-amber-700 dark:text-amber-300">
                            <CheckIcon className="size-2.5" />
                          </span>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-col gap-1.5 border-t border-border/60 pt-2">
                <span className="text-[11px] font-medium text-muted-foreground">
                  Velocidad del texto
                </span>
                <div
                  role="radiogroup"
                  aria-label="Velocidad del streaming de texto"
                  className="grid grid-cols-4 gap-1 rounded-xl border border-border/80 bg-muted/50 p-1"
                >
                  {STREAM_SPEED_OPTIONS.map((opt) => {
                    const active = settings.streamSpeed === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => {
                          if (settings.streamSpeed !== opt.value) {
                            handleToggleSound();
                            updateSettings({ streamSpeed: opt.value });
                          }
                        }}
                        className={cn(
                          "min-h-7 rounded-lg px-1.5 py-1 text-[11px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          active
                            ? "bg-card text-foreground shadow-xs ring-1 ring-amber-500/35"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {isGuest && (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-2.5 py-2 text-[11px]">
                  <span className="text-muted-foreground">
                    {authenticated
                      ? "Tu cuenta aún no está en la whitelist."
                      : "Desbloqueá Main iniciando sesión."}
                  </span>
                  <button
                    type="button"
                    onClick={handleOpenAuth}
                    className="shrink-0 font-medium text-amber-700 underline underline-offset-2 hover:text-amber-600 dark:text-amber-300 dark:hover:text-amber-200"
                  >
                    {authenticated ? "Ver cuenta" : "Iniciar sesión"}
                  </button>
                </div>
              )}
            </section>

            {/* 2. Razonamiento (Thinking) */}
            <section
              aria-labelledby="settings-reasoning-title"
              className="flex flex-col gap-2.5 rounded-xl border border-border/80 bg-card/85 p-3"
            >
              <div className="flex items-center gap-1.5">
                <BrainIcon className="size-3.5 text-violet-600 dark:text-violet-400" />
                <h3
                  id="settings-reasoning-title"
                  className="font-serif text-sm font-semibold text-foreground"
                >
                  Razonamiento (Thinking)
                </h3>
              </div>

              <div
                role="radiogroup"
                aria-labelledby="settings-reasoning-title"
                className="grid grid-cols-4 gap-1 rounded-xl border border-border/80 bg-muted/50 p-1"
              >
                {REASONING_OPTIONS.map((option) => {
                  const active = settings.reasoningEffort === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => {
                        if (settings.reasoningEffort !== option.value) {
                          handleToggleSound();
                          updateSettings({ reasoningEffort: option.value });
                        }
                      }}
                      className={cn(
                        "min-h-8 rounded-lg px-2 py-1 text-[11px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        active
                          ? "bg-card text-foreground shadow-xs ring-1 ring-amber-500/35"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>

              <p className="text-[11px] leading-relaxed text-muted-foreground">
                <span className="font-medium text-foreground/90">
                  {activeReasoningOption.label}:
                </span>{" "}
                {activeReasoningOption.hint} Aumentar el esfuerzo mejora la
                consistencia del DM, pero incrementa la latencia y el consumo de
                créditos.
              </p>
            </section>

            {/* 3. Voz del Dungeon Master (TTS) */}
            <section
              aria-labelledby="settings-tts-title"
              className="flex flex-col gap-2.5 rounded-xl border border-border/80 bg-card/85 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Volume2Icon className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                  <h3
                    id="settings-tts-title"
                    className="font-serif text-sm font-semibold text-foreground"
                  >
                    Voz del Dungeon Master (TTS)
                  </h3>
                </div>
                {isGuest && (
                  <span className="inline-flex items-center gap-1 rounded border border-amber-500/35 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-amber-700 dark:text-amber-300">
                    <LockIcon className="size-2.5" />
                    Solo Whitelist
                  </span>
                )}
              </div>

              {isGuest ? (
                <div className="flex flex-col gap-2.5 rounded-lg border border-border/70 bg-background/55 p-3">
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    {authenticated
                      ? "Tu cuenta está autenticada, pero la voz con HeyGen y Fish requiere estar en la whitelist."
                      : "Iniciá sesión con una cuenta autorizada para escuchar al Dungeon Master con HeyGen o Fish."}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleOpenAuth}
                    className="w-full border-amber-500/35 text-amber-700 hover:bg-amber-500/10 dark:text-amber-300"
                  >
                    <LockIcon className="size-3.5" />
                    {authenticated
                      ? "Revisar estado de acceso"
                      : "Iniciar sesión para habilitar voz"}
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col gap-2.5">
                  <SettingSwitchRow
                    label="Activar voz del Dungeon Master"
                    description="Habilita los controles de audio en cada respuesta del DM."
                    checked={settings.ttsEnabled}
                    onCheckedChange={(checked) => {
                      handleToggleSound();
                      updateSettings({ ttsEnabled: checked });
                    }}
                  />

                  <div
                    className={cn(
                      "flex flex-col gap-2.5 transition-opacity",
                      !settings.ttsEnabled && "pointer-events-none opacity-50",
                    )}
                  >
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[11px] font-medium text-muted-foreground">
                        Motor de voz
                      </span>
                      <div
                        role="radiogroup"
                        aria-label="Selector de modelo de voz TTS"
                        className="grid grid-cols-2 gap-1.5"
                      >
                        {TTS_MODELS.map((ttsModel) => {
                          const active = settings.ttsModel === ttsModel.id;
                          return (
                            <button
                              key={ttsModel.id}
                              type="button"
                              role="radio"
                              aria-checked={active}
                              disabled={!settings.ttsEnabled}
                              onClick={() => {
                                handleToggleSound();
                                updateSettings({
                                  ttsModel: ttsModel.id as TtsModelId,
                                });
                              }}
                              className={cn(
                                "flex min-h-10 items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                active
                                  ? "border-emerald-500/45 bg-emerald-500/10 text-foreground"
                                  : "border-border/70 bg-background/60 text-foreground/90 hover:border-border hover:bg-muted/50",
                              )}
                            >
                              <span className="truncate text-xs font-medium">
                                {ttsModel.name}
                              </span>
                              {active && (
                                <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
                                  <CheckIcon className="size-2.5" />
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-background/55 px-3 py-2">
                      <span className="text-xs font-medium text-foreground">
                        Velocidad de voz
                      </span>
                      <div
                        role="radiogroup"
                        aria-label="Velocidad de reproducción TTS"
                        className="inline-flex rounded-lg border border-border/70 bg-muted/60 p-0.5"
                      >
                        {TTS_SPEED_OPTIONS.map((opt) => {
                          const active =
                            Math.abs(settings.ttsSpeed - opt.value) < 0.01;
                          return (
                            <button
                              key={opt.label}
                              type="button"
                              role="radio"
                              aria-checked={active}
                              disabled={!settings.ttsEnabled}
                              onClick={() => {
                                handleToggleSound();
                                updateSettings({ ttsSpeed: opt.value });
                              }}
                              className={cn(
                                "min-h-6 rounded-md px-2 py-0.5 font-mono text-[11px] font-medium tabular-nums transition-colors",
                                active
                                  ? "bg-card text-foreground shadow-xs"
                                  : "text-muted-foreground hover:text-foreground",
                              )}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <SettingSwitchRow
                      label="Auto-reproducir narración al terminar turno"
                      description="Lee automáticamente en voz alta la respuesta nueva del DM."
                      checked={settings.ttsAutoPlay}
                      disabled={!settings.ttsEnabled}
                      onCheckedChange={(checked) => {
                        handleToggleSound();
                        updateSettings({ ttsAutoPlay: checked });
                      }}
                    />
                  </div>
                </div>
              )}
            </section>

            {/* 4. Opciones de Desarrollador */}
            <section
              aria-labelledby="settings-dev-title"
              className="flex flex-col gap-2.5 rounded-xl border border-border/80 bg-card/85 p-3"
            >
              <div className="flex items-center gap-1.5">
                <WrenchIcon className="size-3.5 text-sky-600 dark:text-sky-400" />
                <h3
                  id="settings-dev-title"
                  className="font-serif text-sm font-semibold text-foreground"
                >
                  Opciones de Desarrollador
                </h3>
              </div>

              <SettingSwitchRow
                label="Ocultar componentes de desarrollador"
                description="Apaga o enciende los tres indicadores técnicos de una sola vez."
                checked={allDevHidden}
                onCheckedChange={(hideAll) => {
                  handleToggleSound();
                  const show = !hideAll;
                  updateSettings({
                    showDevContextMeter: show,
                    showDevLatencyTimer: show,
                    showDevReasoningView: show,
                  });
                }}
              />

              <div className="flex flex-col gap-1.5 border-t border-border/60 pt-2">
                <SettingSwitchRow
                  label="Medidor de contexto LLM"
                  description="Tokens estimados y ventana de mensajes sobre el input."
                  checked={settings.showDevContextMeter}
                  onCheckedChange={(checked) => {
                    handleToggleSound();
                    updateSettings({ showDevContextMeter: checked });
                  }}
                />
                <SettingSwitchRow
                  label="Velocidad / cronómetro de respuesta"
                  description="Temporizador en vivo mientras el DM resuelve y narra."
                  checked={settings.showDevLatencyTimer}
                  onCheckedChange={(checked) => {
                    handleToggleSound();
                    updateSettings({ showDevLatencyTimer: checked });
                  }}
                />
                <SettingSwitchRow
                  label="Vista de razonamiento en mensajes"
                  description="Bloques de pensamiento interno dentro de la traza del turno."
                  checked={settings.showDevReasoningView}
                  onCheckedChange={(checked) => {
                    handleToggleSound();
                    updateSettings({ showDevReasoningView: checked });
                  }}
                />
              </div>
            </section>

            <section
              aria-labelledby="settings-shortcuts-title"
              className="flex flex-col gap-2 rounded-xl border border-border/70 bg-card/60 p-3"
            >
              <h3
                id="settings-shortcuts-title"
                className="font-serif text-sm font-semibold text-foreground"
              >
                Atajos de teclado
              </h3>
              <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
                <span>Abrir o cerrar la ficha</span>
                <kbd className="rounded border border-border/70 bg-background px-1.5 py-0.5 font-mono text-[10px] text-foreground/80">
                  Alt + H
                </kbd>
              </div>
              <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
                <span>Iniciar o terminar dictado</span>
                <kbd className="rounded border border-border/70 bg-background px-1.5 py-0.5 font-mono text-[10px] text-foreground/80">
                  Alt + M
                </kbd>
              </div>
            </section>
          </div>

          {/* Pie */}
          <div className="flex items-center justify-between gap-2 border-t border-border/70 px-4 py-2.5">
            <span className="inline-flex items-center gap-1 text-[10.5px] text-muted-foreground">
              <SparklesIcon className="size-3 text-amber-500/80" />
              Preferencias guardadas localmente
            </span>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => {
                void playSound("interaction.tap");
                resetSettings();
              }}
            >
              <RotateCcwIcon className="size-3" />
              Restablecer
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
