"use client";

import { useChat } from "@ai-sdk/react";
import type { GameEvent, GameState, RulesetProfile } from "@dungeons/rules";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
} from "ai";
import {
  HeartPulseIcon,
  PanelRightIcon,
  ShieldIcon,
  SkullIcon,
  SparklesIcon,
  SwordsIcon,
  XIcon,
} from "lucide-react";
import * as React from "react";

import { useAuthAccess } from "@/components/auth-dialog";
import { ChatMessage } from "@/components/chat-message";
import { ContextMeter } from "@/components/game/context-meter";
import { GameSidebar } from "@/components/game/game-sidebar";
import { HybridCheckCard } from "@/components/game/hybrid-check-card";
import { extractTurnOutcomeSummary } from "@/components/game/tool-parts";
import { PromptForm } from "@/components/prompt-form";
import { QuestionCard } from "@/components/question-card";
import { StatusIcon } from "@/components/status-icon";
import { Suggestions } from "@/components/suggestions";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Message, MessageContent } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { useSensoryUI } from "@/components/ui/sensory-ui/config/provider";
import { pushToast } from "@/components/ui/toaster";
import { Trace, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace";
import { formatGameEventToast } from "@/lib/game/event-toast";
import { useTtsPlayer } from "@/hooks/use-tts-player";
import type { CharacterPresetInfo } from "@/lib/game/presets";
import type { SessionSummaryItem, StoredMemoryFact } from "@/lib/game/store";
import {
  DEFAULT_MODEL,
  GUEST_DEFAULT_MODEL,
  type GatewayModel,
  type ReasoningEffort,
} from "@/lib/models";
import { useAppSettings } from "@/lib/settings/app-settings";
import { cn } from "@/lib/utils";
import { type ChatUIMessage } from "@/tools";

function extractAssistantSpeechText(
  message: ChatUIMessage | undefined,
): string {
  if (!message || message.role !== "assistant") {
    return "";
  }
  const chunks: string[] = [];
  let pending = "";
  for (const part of message.parts) {
    if (part.type === "text") {
      pending += part.text;
    } else if (part.type !== "source-url") {
      if (pending.trim()) {
        chunks.push(pending.trim());
      }
      pending = "";
    }
  }
  if (pending.trim()) {
    chunks.push(pending.trim());
  }
  return chunks.join("\n\n");
}

function LiveTurnStatus({ status }: { status: "submitted" | "streaming" }) {
  const [tenths, setTenths] = React.useState(0);

  React.useEffect(() => {
    const startedAt = Date.now();
    const id = setInterval(() => {
      setTenths(Math.floor((Date.now() - startedAt) / 100));
    }, 100);
    return () => {
      clearInterval(id);
    };
  }, []);

  return (
    <div className="flex items-center justify-between gap-2 px-1 text-[11px] text-muted-foreground">
      <div className="flex items-center gap-2">
        <span className="size-1.5 animate-pulse rounded-full bg-amber-400" />
        <span>
          {status === "submitted"
            ? "El DM está resolviendo reglas y pensando…"
            : "Narrando escena…"}
        </span>
      </div>
      <span className="font-mono text-[11px] tabular-nums">
        {(tenths / 10).toFixed(1)}s
      </span>
    </div>
  );
}

interface CampaignApiPayload {
  campaignId: string | null;
  sessionId: string | null;
  sessionNumber?: number;
  worldSummary?: string;
  state: GameState | null;
  events: GameEvent[];
  messages: Array<{
    id: string;
    role: "user" | "assistant" | "system";
    parts: ChatUIMessage["parts"];
  }>;
  sessionSummaries?: SessionSummaryItem[];
  memoryFacts?: StoredMemoryFact[];
  presets: CharacterPresetInfo[];
}

export function Chat({ models }: { models: GatewayModel[] }) {
  const access = useAuthAccess();
  const { settings, updateSettings } = useAppSettings();
  const ttsPlayer = useTtsPlayer({
    model: settings.ttsModel,
    voice: settings.ttsVoice,
    speed: settings.ttsSpeed,
  });

  const [campaignId, setCampaignId] = React.useState<string | null>(null);
  const [sessionNumber, setSessionNumber] = React.useState<number>(1);
  const [gameState, setGameState] = React.useState<GameState | null>(null);
  const [events, setEvents] = React.useState<GameEvent[]>([]);
  const [sessionSummaries, setSessionSummaries] = React.useState<
    SessionSummaryItem[]
  >([]);
  const [memoryFacts, setMemoryFacts] = React.useState<StoredMemoryFact[]>([]);
  const { playSound } = useSensoryUI();
  const [presets, setPresets] = React.useState<CharacterPresetInfo[]>([]);
  // HUD lateral colapsado por defecto (estilo Old Greg's Tavern)
  const [sidebarOpen, setSidebarOpen] = React.useState(false);

  const playSoundRef = React.useRef(playSound);
  React.useEffect(() => {
    playSoundRef.current = playSound;
  }, [playSound]);

  const ttsAutoPlayRef = React.useRef({
    enabled:
      access.tier === "whitelisted" &&
      settings.ttsEnabled &&
      settings.ttsAutoPlay,
    model: settings.ttsModel,
    voice: settings.ttsVoice,
    speed: settings.ttsSpeed,
    speak: ttsPlayer.speak,
  });
  React.useEffect(() => {
    ttsAutoPlayRef.current = {
      enabled:
        access.tier === "whitelisted" &&
        settings.ttsEnabled &&
        settings.ttsAutoPlay,
      model: settings.ttsModel,
      voice: settings.ttsVoice,
      speed: settings.ttsSpeed,
      speak: ttsPlayer.speak,
    };
  }, [
    access.tier,
    settings.ttsEnabled,
    settings.ttsAutoPlay,
    settings.ttsModel,
    settings.ttsVoice,
    settings.ttsSpeed,
    ttsPlayer.speak,
  ]);

  const lockedModelIds = React.useMemo(() => {
    if (access.tier === "guest") {
      return new Set(
        models
          .filter((item) => item.accessTier === "whitelisted")
          .map((item) => item.id),
      );
    }
    return new Set<string>();
  }, [access.tier, models]);

  const effectiveModel = React.useMemo(() => {
    const selected = models.find((item) => item.id === settings.textModel);
    if (access.tier === "guest") {
      if (selected && selected.accessTier === "free") {
        return selected.id;
      }
      return (
        models.find((item) => item.id === GUEST_DEFAULT_MODEL)?.id ??
        models.find((item) => item.accessTier === "free")?.id ??
        GUEST_DEFAULT_MODEL
      );
    }
    if (selected) {
      return selected.id;
    }
    return (
      models.find((item) => item.id === DEFAULT_MODEL)?.id ??
      models[0]?.id ??
      DEFAULT_MODEL
    );
  }, [access.tier, models, settings.textModel]);

  const [transportBundle] = React.useState(() => {
    let currentBody: {
      model: string;
      campaignId: string | null;
      reasoningEffort: ReasoningEffort;
    } = {
      model: GUEST_DEFAULT_MODEL,
      campaignId: null,
      reasoningEffort: "none",
    };
    return {
      updateBody(next: {
        model: string;
        campaignId: string | null;
        reasoningEffort: ReasoningEffort;
      }) {
        currentBody = next;
      },
      transport: new DefaultChatTransport({
        api: "/api/chat",
        body: () => currentBody,
      }),
    };
  });

  React.useEffect(() => {
    transportBundle.updateBody({
      model: effectiveModel,
      campaignId,
      reasoningEffort: settings.reasoningEffort,
    });
  }, [transportBundle, effectiveModel, campaignId, settings.reasoningEffort]);

  React.useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (event.altKey && event.key.toLowerCase() === "h") {
        event.preventDefault();
        setSidebarOpen((prev) => {
          const next = !prev;
          playSoundRef.current(next ? "overlay.open" : "overlay.close");
          return next;
        });
      } else if (event.key === "Escape") {
        setSidebarOpen((prev) => {
          if (prev) {
            playSoundRef.current("overlay.close");
          }
          return false;
        });
      }
    }
    window.addEventListener("keydown", handleShortcut);
    return () => {
      window.removeEventListener("keydown", handleShortcut);
    };
  }, []);

  const {
    messages,
    setMessages,
    sendMessage,
    regenerate,
    status,
    stop,
    error,
    addToolOutput,
  } = useChat<ChatUIMessage>({
    transport: transportBundle.transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
  });

  const lastToastedSeqRef = React.useRef<number | null>(null);

  const notifyNewEvents = React.useCallback(
    (nextEvents: readonly GameEvent[], silent = false) => {
      const maxSeq = nextEvents.reduce(
        (max, ev) => (ev.seq > max ? ev.seq : max),
        0,
      );
      if (silent || lastToastedSeqRef.current === null) {
        lastToastedSeqRef.current = maxSeq;
        return;
      }
      const prevSeq = lastToastedSeqRef.current;
      const fresh = nextEvents.filter(
        (ev) => ev.revertedByEventId === null && ev.seq > prevSeq,
      );
      lastToastedSeqRef.current = Math.max(prevSeq, maxSeq);
      for (const ev of fresh.slice(-3)) {
        pushToast(formatGameEventToast(ev));
      }
    },
    [],
  );

  const applyCampaignPayload = React.useCallback(
    (data: CampaignApiPayload, restoreMessages = false) => {
      setCampaignId(data.campaignId);
      setSessionNumber(data.sessionNumber ?? 1);
      setGameState(data.state);
      setEvents(data.events);
      notifyNewEvents(data.events, restoreMessages);
      setSessionSummaries(data.sessionSummaries ?? []);
      setMemoryFacts(data.memoryFacts ?? []);
      setPresets(data.presets ?? []);
      if (restoreMessages) {
        setMessages(
          data.messages.map((m) => ({
            id: m.id,
            role: m.role,
            parts: m.parts,
          })),
        );
      }
    },
    [notifyNewEvents, setMessages],
  );

  React.useEffect(() => {
    let cancelled = false;
    async function bootstrapCampaign() {
      const res = await fetch("/api/game/campaigns");
      if (!res.ok || cancelled) return;
      let data = (await res.json()) as CampaignApiPayload;

      if (!data.campaignId) {
        const createRes = await fetch("/api/game/campaigns", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            presetId: "pc_kael",
            mode: "digital",
            ruleset: "5e-full",
          }),
        });
        if (!createRes.ok || cancelled) return;
        data = (await createRes.json()) as CampaignApiPayload;
      }

      if (cancelled) return;
      setCampaignId(data.campaignId);
      setSessionNumber(data.sessionNumber ?? 1);
      setGameState(data.state);
      setEvents(data.events);
      notifyNewEvents(data.events, true);
      setSessionSummaries(data.sessionSummaries ?? []);
      setMemoryFacts(data.memoryFacts ?? []);
      setPresets(data.presets ?? []);
      setMessages(
        data.messages.map((m) => ({
          id: m.id,
          role: m.role,
          parts: m.parts,
        })),
      );
    }

    void bootstrapCampaign();
    return () => {
      cancelled = true;
    };
  }, [notifyNewEvents, setMessages]);

  const messagesRef = React.useRef(messages);
  React.useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const prevStatusRef = React.useRef(status);
  React.useEffect(() => {
    let cancelled = false;
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    if ((prev === "submitted" || prev === "streaming") && status === "ready") {
      if (campaignId) {
        const url = `/api/game/campaigns?campaignId=${encodeURIComponent(campaignId)}`;
        void fetch(url)
          .then((res) =>
            res.ok ? (res.json() as Promise<CampaignApiPayload>) : null,
          )
          .then((data) => {
            if (!cancelled && data) {
              applyCampaignPayload(data, false);
            }
          })
          .catch(() => undefined);
      }
      const lastMsg = messagesRef.current.at(-1);
      if (lastMsg?.role === "assistant") {
        const outcome = extractTurnOutcomeSummary(lastMsg);
        if (
          outcome?.outcomeLabel.includes("CRÍTICO") ||
          outcome?.outcomeLabel.includes("NAT 20")
        ) {
          playSoundRef.current("hero.milestone");
        } else if (outcome?.tone === "rose") {
          playSoundRef.current("notification.warning");
        } else if (outcome?.tone === "emerald") {
          playSoundRef.current("notification.success");
        } else {
          playSoundRef.current("notification.info");
        }

        const autoPlay = ttsAutoPlayRef.current;
        if (autoPlay.enabled) {
          const speechText = extractAssistantSpeechText(lastMsg);
          if (speechText) {
            void autoPlay.speak({
              id: lastMsg.id,
              text: speechText,
              model: autoPlay.model,
              voice: autoPlay.voice,
              speed: autoPlay.speed,
            });
          }
        }
      }
    } else if (
      (prev === "submitted" || prev === "streaming") &&
      status === "error"
    ) {
      playSoundRef.current("notification.error");
    }
    return () => {
      cancelled = true;
    };
  }, [status, campaignId, applyCampaignPayload]);

  async function handleNewCampaign(
    presetId: string,
    mode: "digital" | "hybrid",
    ruleset: RulesetProfile,
  ) {
    const res = await fetch("/api/game/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ presetId, mode, ruleset }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as CampaignApiPayload;
    setCampaignId(data.campaignId);
    setSessionNumber(data.sessionNumber ?? 1);
    setGameState(data.state);
    setEvents(data.events);
    notifyNewEvents(data.events, true);
    setSessionSummaries(data.sessionSummaries ?? []);
    setMemoryFacts(data.memoryFacts ?? []);
    setPresets(data.presets ?? []);
    setMessages([]);
    pushToast({
      title: "Nueva campaña iniciada",
      description: `Aguas Quietas · ${ruleset}`,
      tone: "amber",
    });
  }

  async function handleStartNewSession() {
    if (!campaignId) return;
    const res = await fetch("/api/game/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ campaignId }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as {
      ok: boolean;
      sessionNumber?: number;
      sessionSummaries?: SessionSummaryItem[];
      memoryFacts?: StoredMemoryFact[];
      state?: GameState;
      events?: GameEvent[];
    };
    if (data.ok) {
      if (data.sessionNumber) setSessionNumber(data.sessionNumber);
      if (data.sessionSummaries) setSessionSummaries(data.sessionSummaries);
      if (data.memoryFacts) setMemoryFacts(data.memoryFacts);
      if (data.state) setGameState(data.state);
      if (data.events) {
        setEvents(data.events);
        notifyNewEvents(data.events, true);
      }
      pushToast({
        title: `Sesión #${data.sessionNumber ?? sessionNumber + 1} abierta`,
        description: "Resumen guardado en la memoria de campaña.",
        tone: "emerald",
      });
    }
  }

  async function handleToggleMode(
    actorId: string,
    mode: "digital" | "hybrid",
  ) {
    if (!campaignId) return;
    const res = await fetch("/api/game/mode", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ campaignId, actorId, mode }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { ok: boolean; state: GameState };
    if (data.ok) {
      setGameState(data.state);
      pushToast({
        title: mode === "hybrid" ? "Modo Híbrido" : "Modo Digital",
        description:
          mode === "hybrid"
            ? "Ingresá el resultado de tus dados físicos en mesa."
            : "El motor resolverá las tiradas automáticamente.",
        tone: "amber",
      });
    }
  }

  async function handleRollback(targetSeq: number) {
    if (!campaignId) return;
    const res = await fetch("/api/game/rollback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ campaignId, targetSeq }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as {
      ok: boolean;
      state: GameState;
      events: GameEvent[];
      messages?: CampaignApiPayload["messages"];
      memoryFacts?: StoredMemoryFact[];
    };
    if (data.ok) {
      setGameState(data.state);
      setEvents(data.events);
      notifyNewEvents(data.events, true);
      if (Array.isArray(data.memoryFacts)) {
        setMemoryFacts(data.memoryFacts);
      }
      if (Array.isArray(data.messages)) {
        setMessages(
          data.messages.map((m) => ({
            id: m.id,
            role: m.role,
            parts: m.parts,
          })),
        );
      }
      pushToast({
        title: "Línea temporal restaurada",
        description: `Estado devuelto a secuencia #${targetSeq}.`,
        tone: "amber",
        meta: `#${targetSeq}`,
      });
    }
  }

  const isBusy = status === "submitted" || status === "streaming";
  const lastMessage = messages.at(-1);
  const activeChar = gameState ? Object.values(gameState.characters)[0] : undefined;
  const currentScene = gameState ? gameState.scenes[gameState.sceneId] : undefined;

  const pcNames = React.useMemo(
    () => (gameState ? Object.values(gameState.characters).map((c) => c.name) : []),
    [gameState],
  );
  const npcNames = React.useMemo(
    () =>
      gameState?.combat?.active
        ? gameState.combat.combatants
            .filter((c) => c.kind !== "pc")
            .map((c) => c.name)
        : [],
    [gameState],
  );

  const pendingQuestion =
    lastMessage?.role === "assistant"
      ? lastMessage.parts.find(
          (part): part is Extract<typeof part, { type: "tool-ask_user" }> =>
            part.type === "tool-ask_user" &&
            (part.state === "input-streaming" ||
              part.state === "input-available"),
        )
      : undefined;

  const pendingDeclareCheck =
    lastMessage?.role === "assistant"
      ? lastMessage.parts.find(
          (
            part,
          ): part is Extract<typeof part, { type: "tool-declare_check" }> =>
            part.type === "tool-declare_check" &&
            (part.state === "input-streaming" ||
              part.state === "input-available"),
        )
      : undefined;

  const firstAssistantIndex = messages.findIndex((m) => m.role === "assistant");
  const level1Slots = activeChar?.spellSlots["1"];

  const ttsAvailable = access.tier === "whitelisted" && settings.ttsEnabled;
  const showContextMeter = settings.showDevContextMeter;
  const activeTurnStatus =
    settings.showDevLatencyTimer &&
    (status === "submitted" || status === "streaming")
      ? status
      : null;

  const submitPrompt = React.useCallback(
    (prompt: string) => {
      if (isBusy) return;
      void sendMessage(
        { text: prompt },
        {
          body: {
            model: effectiveModel,
            campaignId,
            reasoningEffort: settings.reasoningEffort,
          },
        },
      );
    },
    [
      isBusy,
      sendMessage,
      effectiveModel,
      campaignId,
      settings.reasoningEffort,
    ],
  );

  return (
    <div className="tavern-backdrop relative flex min-h-0 flex-1 overflow-hidden">
      {/* Píldora flotante compacta de estado vital cuando el HUD está colapsado */}
      {!sidebarOpen && activeChar && gameState && (
        <button
          type="button"
          onClick={() => {
            playSound("overlay.open");
            setSidebarOpen(true);
          }}
          title="Ver ficha completa, conjuros, memoria y rollback (Alt+H)"
          aria-label={`Abrir ficha de ${activeChar.name}. Puntos de golpe: ${activeChar.hp.current} de ${activeChar.hp.max}${gameState.combat?.active ? `; combate, ronda ${gameState.combat.round}` : ""}`}
          aria-controls="campaign-hud-panel"
          aria-expanded={false}
          className={cn(
            "fixed right-3 top-14 z-30 flex min-h-10 max-w-[calc(100vw-1.5rem)] items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] shadow-sm backdrop-blur-md transition-all hover:border-amber-500/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:right-4 sm:top-16",
            gameState.combat?.active
              ? "border-rose-500/45 bg-rose-500/15 text-rose-950 dark:bg-rose-950/75 dark:text-rose-100"
              : activeChar.hp.current === 0
                ? "animate-pulse border-rose-500/60 bg-rose-500/20 text-rose-950 dark:bg-rose-950/85 dark:text-rose-100"
                : "border-border/70 bg-card/85 text-foreground/90",
          )}
        >
          <span className="max-w-24 truncate font-medium text-amber-700 dark:text-amber-300">
            {activeChar.name.split(" ")[0]}
          </span>
          <span className="inline-flex items-center gap-1 font-mono tabular-nums">
            {activeChar.hp.current === 0 ? (
              <SkullIcon className="size-3 text-rose-600 dark:text-rose-400" />
            ) : (
              <HeartPulseIcon className="size-3 text-emerald-600 dark:text-emerald-400" />
            )}
            {activeChar.hp.current}/{activeChar.hp.max}
          </span>
          <span
            aria-hidden="true"
            className="h-1.5 w-8 overflow-hidden rounded-full bg-foreground/15"
          >
            <span
              className={cn(
                "block h-full rounded-full transition-[width]",
                activeChar.hp.current === 0
                  ? "bg-rose-500"
                  : activeChar.hp.current / Math.max(1, activeChar.hp.max) <= 0.25
                    ? "bg-amber-500"
                    : "bg-emerald-500",
              )}
              style={{
                width: `${Math.max(0, Math.min(100, (activeChar.hp.current / Math.max(1, activeChar.hp.max)) * 100))}%`,
              }}
            />
          </span>
          <span className="hidden items-center gap-0.5 font-mono tabular-nums text-muted-foreground sm:inline-flex">
            <ShieldIcon className="size-3" />
            {activeChar.ac}
          </span>
          {level1Slots && (
            <span className="hidden items-center gap-0.5 font-mono tabular-nums text-violet-700 dark:text-violet-300 sm:inline-flex">
              <SparklesIcon className="size-3" />
              {level1Slots.current}/{level1Slots.max}
            </span>
          )}
          {gameState.combat?.active && (
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/20 px-1.5 py-0 font-mono text-[10px] font-semibold text-rose-800 dark:bg-rose-500/25 dark:text-rose-200">
              <SwordsIcon className="size-2.5" />R{gameState.combat.round}
            </span>
          )}
          <PanelRightIcon className="size-3 text-muted-foreground" />
        </button>
      )}

      {/* Columna editorial principal */}
      <main
        id="main-content"
        className={cn(
          "mx-auto flex min-h-0 w-full flex-1 flex-col transition-[padding] duration-200 ease-out",
          sidebarOpen && "lg:pr-[388px]",
        )}
      >
        {messages.length === 0 ? (
          <div className="flex flex-1 items-center justify-center p-6 pt-16 sm:pt-6">
            <Empty className="max-w-2xl border-none p-4 sm:p-8">
              <EmptyHeader className="max-w-lg">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/10 px-2.5 py-0.5 font-mono text-[10px] font-medium text-amber-700 dark:text-amber-300">
                  SRD 5.2.1 · {gameState?.ruleset ?? "5e-full"} · Motor determinista · Voz STT
                </span>
                <EmptyTitle className="mt-2 font-serif text-3xl font-semibold tracking-tight">
                  <h1>Aguas Quietas</h1>
                </EmptyTitle>
                <EmptyDescription className="text-[14px] leading-relaxed">
                  Crónica interactiva 5e asistida por motor determinista. Escribí,
                  dictá con el micrófono o abrí el panel lateral (<kbd className="rounded border border-border px-1 font-mono text-[10px]">Alt+H</kbd>) para elegir ficha o modo híbrido.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent className="max-w-xl">
                <Suggestions onSelect={submitPrompt} />
              </EmptyContent>
            </Empty>
          </div>
        ) : (
          <MessageScrollerProvider>
            <MessageScroller className="relative flex-1">
              {/* Degradado superior sutil estilo lectura nocturna */}
              <div
                aria-hidden
                className="pointer-events-none sticky top-0 z-10 h-6 w-full bg-gradient-to-b from-background/90 to-transparent"
              />
              <MessageScrollerViewport>
                <MessageScrollerContent className="mx-auto flex w-full max-w-[700px] flex-col gap-7 px-5 pb-8 pt-12 sm:px-6 sm:pt-4">
                  {messages.map((message, idx) => {
                    const nextMessage = messages[idx + 1];
                    const turnOutcome =
                      message.role === "user"
                        ? extractTurnOutcomeSummary(nextMessage)
                        : null;

                    let sceneHeader: { microLabel: string; title: string } | null =
                      null;
                    if (message.role === "assistant") {
                      const transitionPart = message.parts.find(
                        (
                          p,
                        ): p is Extract<
                          typeof p,
                          {
                            type: "tool-transition_scene";
                            state: "output-available";
                          }
                        > =>
                          p.type === "tool-transition_scene" &&
                          p.state === "output-available" &&
                          p.output.ok,
                      );
                      if (transitionPart?.output.titleEs) {
                        sceneHeader = {
                          microLabel: "AGUAS QUIETAS · NUEVA ESCENA",
                          title: transitionPart.output.titleEs,
                        };
                      } else if (idx === firstAssistantIndex && currentScene) {
                        sceneHeader = {
                          microLabel: `AGUAS QUIETAS · ${gameState?.ruleset.toUpperCase() ?? "5E-FULL"}`,
                          title: currentScene.titleEs,
                        };
                      }
                    }

                    const isLastAssistant =
                      message.role === "assistant" &&
                      idx === messages.length - 1;

                    const speechText =
                      ttsAvailable && message.role === "assistant"
                        ? extractAssistantSpeechText(message)
                        : "";

                    return (
                      <MessageScrollerItem
                        key={message.id}
                        messageId={message.id}
                        scrollAnchor={message.role === "user"}
                      >
                        <ChatMessage
                          message={message}
                          isStreaming={isBusy && message.id === lastMessage?.id}
                          streamSpeed={settings.streamSpeed}
                          isLastAssistant={isLastAssistant}
                          hideSuggestions={Boolean(
                            pendingQuestion || pendingDeclareCheck,
                          )}
                          showReasoning={settings.showDevReasoningView}
                          ttsAvailable={ttsAvailable}
                          isSpeaking={ttsPlayer.playingId === message.id}
                          isLoadingAudio={ttsPlayer.loadingId === message.id}
                          onSpeak={
                            ttsAvailable && speechText
                              ? () => {
                                  void ttsPlayer.speak({
                                    id: message.id,
                                    text: speechText,
                                    model: settings.ttsModel,
                                    voice: settings.ttsVoice,
                                    speed: settings.ttsSpeed,
                                  });
                                }
                              : undefined
                          }
                          onStopAudio={
                            ttsAvailable ? ttsPlayer.stop : undefined
                          }
                          characterName={activeChar?.name}
                          characterClassName={activeChar?.className}
                          turnOutcome={turnOutcome}
                          sceneHeader={sceneHeader}
                          pcNames={pcNames}
                          npcNames={npcNames}
                          onSelectSuggestion={submitPrompt}
                          onRetry={
                            !isBusy && message.id === lastMessage?.id
                              ? () =>
                                  regenerate({
                                    messageId: message.id,
                                    body: {
                                      model: effectiveModel,
                                      campaignId,
                                      reasoningEffort: settings.reasoningEffort,
                                    },
                                  })
                              : undefined
                          }
                        />
                      </MessageScrollerItem>
                    );
                  })}
                  {status === "submitted" && (
                    <MessageScrollerItem messageId="thinking">
                      <Message>
                        <MessageContent>
                          <Trace>
                            <TraceLine status="running">
                              <TraceIcon>
                                <StatusIcon status="running" />
                              </TraceIcon>
                              <TraceTitle>El DM está deliberando…</TraceTitle>
                            </TraceLine>
                          </Trace>
                        </MessageContent>
                      </Message>
                    </MessageScrollerItem>
                  )}
                </MessageScrollerContent>
                {pendingQuestion && (
                  <QuestionCard
                    part={pendingQuestion}
                    onAnswer={(toolCallId, answer) =>
                      addToolOutput({
                        tool: "ask_user",
                        toolCallId,
                        output: answer,
                      })
                    }
                  />
                )}
                {pendingDeclareCheck &&
                  pendingDeclareCheck.state === "input-available" &&
                  campaignId && (
                    <HybridCheckCard
                      campaignId={campaignId}
                      sceneId={pendingDeclareCheck.input.sceneId}
                      actorId={pendingDeclareCheck.input.actorId}
                      skill={pendingDeclareCheck.input.skill}
                      dc={pendingDeclareCheck.input.dc}
                      dcRef={pendingDeclareCheck.input.dcRef}
                      mode={pendingDeclareCheck.input.mode ?? "normal"}
                      promptEs={pendingDeclareCheck.input.promptEs}
                      checkId={pendingDeclareCheck.toolCallId}
                      onVerified={(output, nextState, event) => {
                        setGameState(nextState);
                        setEvents((prev) => [...prev, event]);
                        notifyNewEvents([event], false);
                        void addToolOutput({
                          tool: "declare_check",
                          toolCallId: pendingDeclareCheck.toolCallId,
                          output,
                        });
                      }}
                    />
                  )}
              </MessageScrollerViewport>
              <MessageScrollerButton />
            </MessageScroller>
          </MessageScrollerProvider>
        )}

        <div className="mx-auto flex w-full max-w-[700px] flex-col gap-2 px-5 pb-5 pt-2 sm:px-6">
          {error && (
            <Alert variant="destructive">
              <AlertTitle>Error en la solicitud</AlertTitle>
              <AlertDescription>{error.message}</AlertDescription>
            </Alert>
          )}
          {ttsPlayer.error && (
            <Alert variant="destructive">
              <AlertTitle>Error de audio (TTS)</AlertTitle>
              <AlertDescription>{ttsPlayer.error}</AlertDescription>
              <AlertAction>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Cerrar alerta de audio"
                  onClick={ttsPlayer.clearError}
                >
                  <XIcon className="size-3.5" />
                </Button>
              </AlertAction>
            </Alert>
          )}
          {(showContextMeter || activeTurnStatus !== null) && (
            <div className="flex flex-wrap items-center justify-between gap-2 px-0.5">
              {showContextMeter && (
                <ContextMeter messages={messages} isBusy={isBusy} />
              )}
              {activeTurnStatus && (
                <LiveTurnStatus status={activeTurnStatus} />
              )}
            </div>
          )}
          <PromptForm
            models={models}
            model={effectiveModel}
            lockedModelIds={lockedModelIds}
            onModelChange={(nextModel) => {
              updateSettings({ textModel: nextModel });
            }}
            isBusy={isBusy}
            onSubmit={submitPrompt}
            onStop={() => {
              playSound("interaction.tap");
              stop();
            }}
          />
        </div>
      </main>

      {/* HUD Lateral colapsable (acoplado en desktop lg+, drawer en móvil) */}
      <GameSidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        campaignId={campaignId}
        sessionNumber={sessionNumber}
        state={gameState}
        events={events}
        sessionSummaries={sessionSummaries}
        memoryFacts={memoryFacts}
        presets={presets}
        onNewCampaign={handleNewCampaign}
        onStartNewSession={handleStartNewSession}
        onToggleMode={handleToggleMode}
        onRollback={handleRollback}
        onQuickAction={(prompt) => {
          playSound("interaction.confirm");
          if (typeof window !== "undefined" && window.innerWidth < 1024) {
            setSidebarOpen(false);
          }
          submitPrompt(prompt);
        }}
      />
    </div>
  );
}
