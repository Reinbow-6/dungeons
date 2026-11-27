"use client";

import { useChat } from "@ai-sdk/react";
import {
  AGUAS_INQUIETAS_QUEST,
  getAguasInquietasProgress,
  type GameEvent,
  type GameState,
  type RulesetProfile,
} from "@dungeons/rules";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
} from "ai";
import {
  FlameIcon,
  HeartPulseIcon,
  PanelLeftIcon,
  PanelRightIcon,
  PauseIcon,
  ShieldIcon,
  SkullIcon,
  SlidersHorizontalIcon,
  SwordsIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { AuthButton, useAuthAccess } from "@/components/auth-dialog";
import { ChatMessage } from "@/components/chat-message";
import { CampaignSidebar } from "@/components/game/campaign-sidebar";
import { ContextMeter } from "@/components/game/context-meter";
import { EpilogueCard } from "@/components/game/epilogue-card";
import { GameSidebar } from "@/components/game/game-sidebar";
import { HybridCheckCard } from "@/components/game/hybrid-check-card";
import { TensionMeter } from "@/components/game/tension-meter";
import { extractTurnOutcomeSummary } from "@/components/game/tool-parts";
import { PromptForm, type PromptFormHandle } from "@/components/prompt-form";
import { QuestionCard } from "@/components/question-card";
import { SoundToggle } from "@/components/sound-toggle";
import { StatusIcon } from "@/components/status-icon";
import { Suggestions } from "@/components/suggestions";
import { ThemeToggle } from "@/components/theme-toggle";
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
import { Kbd, KbdGroup } from "@/components/ui/kbd";
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
import {
  formatGroupRoundMessage,
  formatSingleActorMessage,
} from "@/lib/game/party-messages";
import { useTtsPlayer } from "@/hooks/use-tts-player";
import type {
  CharacterPresetId,
  CharacterPresetInfo,
  PartyMemberSpec,
} from "@/lib/game/presets";
import type {
  CampaignSummary,
  SessionSummaryItem,
  StoredMemoryFact,
} from "@/lib/game/store";
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

function extractMaxSeqFromParts(
  parts: readonly ChatUIMessage["parts"][number][],
): number | null {
  let maxSeq: number | null = null;
  for (const part of parts) {
    if (
      typeof part.type === "string" &&
      part.type.startsWith("tool-") &&
      "state" in part &&
      part.state === "output-available" &&
      "output" in part &&
      part.output &&
      typeof part.output === "object" &&
      "seq" in part.output &&
      typeof part.output.seq === "number" &&
      Number.isInteger(part.output.seq) &&
      part.output.seq >= 0
    ) {
      maxSeq = maxSeq === null ? part.output.seq : Math.max(maxSeq, part.output.seq);
    }
  }
  return maxSeq;
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
    eventSeq?: number | null;
  }>;
  sessionSummaries?: SessionSummaryItem[];
  memoryFacts?: StoredMemoryFact[];
  presets: CharacterPresetInfo[];
}

function buildSeqMapFromApiMessages(
  apiMessages: CampaignApiPayload["messages"],
): Record<string, number> {
  const next: Record<string, number> = {};
  for (const msg of apiMessages) {
    if (typeof msg.eventSeq === "number" && Number.isInteger(msg.eventSeq)) {
      next[msg.id] = msg.eventSeq;
    } else if (msg.role === "assistant") {
      const partSeq = extractMaxSeqFromParts(msg.parts);
      if (partSeq !== null) {
        next[msg.id] = partSeq;
      }
    }
  }
  return next;
}

const SIDEBAR_PREFS_STORAGE_KEY = "dungeons:sidebar-prefs:v1";
const SIDEBAR_PREFS_CHANGED_EVENT = "dungeons:sidebar-prefs-changed";

interface SidebarPrefs {
  campaignOpen: boolean;
  hudOpen: boolean;
}

const DEFAULT_SIDEBAR_PREFS: SidebarPrefs = Object.freeze({
  campaignOpen: false,
  hudOpen: false,
});

let cachedSidebarRaw: string | null | undefined = undefined;
let cachedSidebarPrefs: SidebarPrefs = DEFAULT_SIDEBAR_PREFS;
let sidebarMemoryOverride = false;

function getSidebarServerSnapshot(): SidebarPrefs {
  return DEFAULT_SIDEBAR_PREFS;
}

function normalizeSidebarPrefs(raw: unknown): SidebarPrefs {
  if (!raw || typeof raw !== "object") {
    return DEFAULT_SIDEBAR_PREFS;
  }
  const obj = raw as Record<string, unknown>;
  return {
    campaignOpen:
      typeof obj.campaignOpen === "boolean" ? obj.campaignOpen : false,
    hudOpen: typeof obj.hudOpen === "boolean" ? obj.hudOpen : false,
  };
}

function getSidebarSnapshot(): SidebarPrefs {
  if (typeof window === "undefined") {
    return DEFAULT_SIDEBAR_PREFS;
  }
  if (sidebarMemoryOverride) {
    return cachedSidebarPrefs;
  }

  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(SIDEBAR_PREFS_STORAGE_KEY);
  } catch {
    return cachedSidebarPrefs;
  }

  if (raw === cachedSidebarRaw) {
    return cachedSidebarPrefs;
  }

  cachedSidebarRaw = raw;
  if (!raw) {
    cachedSidebarPrefs = DEFAULT_SIDEBAR_PREFS;
    return cachedSidebarPrefs;
  }

  try {
    cachedSidebarPrefs = normalizeSidebarPrefs(JSON.parse(raw));
  } catch {
    cachedSidebarPrefs = DEFAULT_SIDEBAR_PREFS;
  }
  return cachedSidebarPrefs;
}

function subscribeSidebarPrefs(callback: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === SIDEBAR_PREFS_STORAGE_KEY) {
      sidebarMemoryOverride = false;
      callback();
    }
  };

  window.addEventListener("storage", onStorage);
  window.addEventListener(SIDEBAR_PREFS_CHANGED_EVENT, callback);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(SIDEBAR_PREFS_CHANGED_EVENT, callback);
  };
}

function writeSidebarPrefs(
  updater: (prev: SidebarPrefs) => SidebarPrefs,
): void {
  const prev = getSidebarSnapshot();
  const next = normalizeSidebarPrefs(updater(prev));
  const serialized = JSON.stringify(next);

  if (!sidebarMemoryOverride && serialized === cachedSidebarRaw) {
    return;
  }

  cachedSidebarPrefs = next;
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(SIDEBAR_PREFS_STORAGE_KEY, serialized);
    cachedSidebarRaw = serialized;
    sidebarMemoryOverride = false;
  } catch {
    sidebarMemoryOverride = true;
  }

  window.dispatchEvent(new Event(SIDEBAR_PREFS_CHANGED_EVENT));
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
  const campaignIdRef = React.useRef<string | null>(null);
  const ensuringCampaignRef = React.useRef<Promise<string | null> | null>(null);
  const [sessionNumber, setSessionNumber] = React.useState<number>(1);
  const [gameState, setGameState] = React.useState<GameState | null>(null);
  const [events, setEvents] = React.useState<GameEvent[]>([]);
  const [sessionSummaries, setSessionSummaries] = React.useState<
    SessionSummaryItem[]
  >([]);
  const [memoryFacts, setMemoryFacts] = React.useState<StoredMemoryFact[]>([]);
  const { playSound } = useSensoryUI();
  const [presets, setPresets] = React.useState<CharacterPresetInfo[]>([]);
  const [messageSeqMap, setMessageSeqMap] = React.useState<Record<string, number>>({});
  const [rollingBackSeq, setRollingBackSeq] = React.useState<number | null>(null);
  const [seedingIntro, setSeedingIntro] = React.useState(false);
  const [streamingIntroId, setStreamingIntroId] = React.useState<string | null>(
    null,
  );
  const promptFormRef = React.useRef<PromptFormHandle | null>(null);
  // HUD lateral derecho y panel de campañas izquierdo colapsados por defecto (persistidos)
  const sidebarPrefs = React.useSyncExternalStore(
    subscribeSidebarPrefs,
    getSidebarSnapshot,
    getSidebarServerSnapshot,
  );
  const sidebarOpen = sidebarPrefs.hudOpen;
  const campaignSidebarOpen = sidebarPrefs.campaignOpen;
  const setSidebarOpen = React.useCallback(
    (value: boolean | ((prev: boolean) => boolean)) => {
      writeSidebarPrefs((prev) => ({
        ...prev,
        hudOpen: typeof value === "function" ? value(prev.hudOpen) : value,
      }));
    },
    [],
  );
  const setCampaignSidebarOpen = React.useCallback(
    (value: boolean | ((prev: boolean) => boolean)) => {
      writeSidebarPrefs((prev) => ({
        ...prev,
        campaignOpen:
          typeof value === "function" ? value(prev.campaignOpen) : value,
      }));
    },
    [],
  );
  const [campaignsList, setCampaignsList] = React.useState<CampaignSummary[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = React.useState(false);
  const [partyHudOpen, setPartyHudOpen] = React.useState(true);
  const [selectedActorId, setSelectedActorId] = React.useState<string | null>(
    null,
  );
  const [pausedMode, setPausedMode] = React.useState(false);
  const [pausedQueue, setPausedQueue] = React.useState<
    Array<{ id: string; actorId: string; text: string }>
  >([]);

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
      activeActorId?: string | null;
    } = {
      model: GUEST_DEFAULT_MODEL,
      campaignId: null,
      reasoningEffort: "none",
      activeActorId: null,
    };
    return {
      updateBody(next: {
        model: string;
        campaignId: string | null;
        reasoningEffort: ReasoningEffort;
        activeActorId?: string | null;
      }) {
        currentBody = next;
      },
      transport: new DefaultChatTransport({
        api: "/api/chat",
        body: () => currentBody,
      }),
    };
  });

  const partyChars = React.useMemo(
    () => (gameState ? Object.values(gameState.characters) : []),
    [gameState],
  );

  const combatActivePcId = React.useMemo(() => {
    if (!gameState?.combat?.active) return null;
    const current = gameState.combat.combatants[gameState.combat.turnIndex];
    if (!current || current.kind !== "pc") return null;
    const pcId = current.actorId ?? current.id;
    return gameState.characters[pcId] ? pcId : null;
  }, [gameState]);

  const activeChar = React.useMemo(() => {
    if (!gameState || partyChars.length === 0) return undefined;
    if (selectedActorId && gameState.characters[selectedActorId]) {
      return gameState.characters[selectedActorId];
    }
    if (combatActivePcId && gameState.characters[combatActivePcId]) {
      return gameState.characters[combatActivePcId];
    }
    return partyChars[0];
  }, [combatActivePcId, gameState, partyChars, selectedActorId]);

  const activeActorId = activeChar?.id ?? null;

  React.useEffect(() => {
    transportBundle.updateBody({
      model: effectiveModel,
      campaignId,
      reasoningEffort: settings.reasoningEffort,
      activeActorId,
    });
  }, [
    transportBundle,
    effectiveModel,
    campaignId,
    settings.reasoningEffort,
    activeActorId,
  ]);

  const partyIdsRef = React.useRef<string[]>([]);
  React.useEffect(() => {
    partyIdsRef.current = partyChars.map((c) => c.id);
  }, [partyChars]);

  const fetchCampaignsList = React.useCallback(async () => {
    setLoadingCampaigns(true);
    try {
      const res = await fetch("/api/game/campaigns?list=1&limit=20");
      if (!res.ok) return;
      const data = (await res.json()) as { items?: CampaignSummary[] };
      if (Array.isArray(data.items)) {
        setCampaignsList(data.items);
      }
    } finally {
      setLoadingCampaigns(false);
    }
  }, []);

  React.useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (event.altKey && event.key.toLowerCase() === "h") {
        event.preventDefault();
        const next = !getSidebarSnapshot().hudOpen;
        setSidebarOpen(next);
        playSoundRef.current(next ? "overlay.open" : "overlay.close");
      } else if (event.altKey && event.key.toLowerCase() === "c") {
        event.preventDefault();
        const next = !getSidebarSnapshot().campaignOpen;
        setCampaignSidebarOpen(next);
        playSoundRef.current(next ? "overlay.open" : "overlay.close");
        if (next) {
          void fetchCampaignsList();
        }
      } else if (
        event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        event.key >= "1" &&
        event.key <= "4"
      ) {
        const idx = Number(event.key) - 1;
        const targetId = partyIdsRef.current[idx];
        if (targetId && partyIdsRef.current.length > 1) {
          event.preventDefault();
          playSoundRef.current("interaction.subtle");
          setSelectedActorId(targetId);
        }
      } else if (event.key === "Escape" && !event.defaultPrevented) {
        const current = getSidebarSnapshot();
        if (current.hudOpen || current.campaignOpen) {
          playSoundRef.current("overlay.close");
          writeSidebarPrefs(() => ({ campaignOpen: false, hudOpen: false }));
        }
      }
    }
    window.addEventListener("keydown", handleShortcut);
    return () => {
      window.removeEventListener("keydown", handleShortcut);
    };
  }, [fetchCampaignsList, setCampaignSidebarOpen, setSidebarOpen]);

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

  const messagesRef = React.useRef(messages);
  React.useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const lastCombatTurnKeyRef = React.useRef<string | null>(null);

  const applyCampaignPayload = React.useCallback(
    (data: CampaignApiPayload, restoreMessages = false) => {
      campaignIdRef.current = data.campaignId;
      setCampaignId(data.campaignId);
      setSessionNumber(data.sessionNumber ?? 1);
      setGameState(data.state);
      setEvents(data.events);
      notifyNewEvents(data.events, restoreMessages);
      setSessionSummaries(data.sessionSummaries ?? []);
      setMemoryFacts(data.memoryFacts ?? []);
      if (Array.isArray(data.presets)) {
        setPresets(data.presets);
      }

      if (data.state?.combat?.active) {
        const turnKey = `${data.state.combat.round}:${data.state.combat.turnIndex}`;
        const activeC = data.state.combat.combatants[data.state.combat.turnIndex];
        if (turnKey !== lastCombatTurnKeyRef.current) {
          lastCombatTurnKeyRef.current = turnKey;
          if (activeC?.kind === "pc") {
            const pcId = activeC.actorId ?? activeC.id;
            if (data.state.characters[pcId]) {
              setSelectedActorId(pcId);
            }
          }
        }
      } else {
        lastCombatTurnKeyRef.current = null;
      }
      if (restoreMessages) {
        setMessages(
          data.messages.map((m) => ({
            id: m.id,
            role: m.role,
            parts: m.parts,
          })),
        );
        setMessageSeqMap(buildSeqMapFromApiMessages(data.messages));
      } else {
        const current = messagesRef.current;
        if (current.length > 0 && current.length === data.messages.length) {
          setMessageSeqMap((prev) => {
            const next = { ...prev };
            for (let i = 0; i < current.length; i += 1) {
              const clientMsg = current[i];
              const serverMsg = data.messages[i];
              if (
                clientMsg &&
                serverMsg &&
                clientMsg.role === serverMsg.role &&
                typeof serverMsg.eventSeq === "number"
              ) {
                next[clientMsg.id] = serverMsg.eventSeq;
              }
            }
            return next;
          });
        }
      }
    },
    [notifyNewEvents, setMessages],
  );

  const resetToEmptyCampaign = React.useCallback(() => {
    campaignIdRef.current = null;
    lastCombatTurnKeyRef.current = null;
    lastToastedSeqRef.current = 0;
    setCampaignId(null);
    setSessionNumber(1);
    setGameState(null);
    setEvents([]);
    setSessionSummaries([]);
    setMemoryFacts([]);
    setMessages([]);
    setMessageSeqMap({});
    setSelectedActorId(null);
    setPausedMode(false);
    setPausedQueue([]);
    setRollingBackSeq(null);
    setStreamingIntroId(null);
    transportBundle.updateBody({
      model: effectiveModel,
      campaignId: null,
      reasoningEffort: settings.reasoningEffort,
      activeActorId: null,
    });
  }, [effectiveModel, setMessages, settings.reasoningEffort, transportBundle]);

  React.useEffect(() => {
    let cancelled = false;
    async function bootstrapCampaign() {
      const res = await fetch("/api/game/campaigns");
      if (!res.ok || cancelled) return;
      const data = (await res.json()) as CampaignApiPayload;
      if (cancelled) return;

      campaignIdRef.current = data.campaignId;
      setCampaignId(data.campaignId);
      setSessionNumber(data.sessionNumber ?? 1);
      setGameState(data.state);
      setEvents(data.events);
      notifyNewEvents(data.events, true);
      setPausedQueue([]);
      setSessionSummaries(data.sessionSummaries ?? []);
      setMemoryFacts(data.memoryFacts ?? []);
      setPresets(data.presets ?? []);
      setSelectedActorId(
        data.state ? (Object.keys(data.state.characters)[0] ?? null) : null,
      );
      setMessages(
        data.messages.map((m) => ({
          id: m.id,
          role: m.role,
          parts: m.parts,
        })),
      );
      setMessageSeqMap(buildSeqMapFromApiMessages(data.messages));

      const listRes = await fetch("/api/game/campaigns?list=1&limit=20");
      if (listRes.ok && !cancelled) {
        const listData = (await listRes.json()) as { items?: CampaignSummary[] };
        if (Array.isArray(listData.items)) {
          setCampaignsList(listData.items);
        }
      }
    }

    void bootstrapCampaign();
    return () => {
      cancelled = true;
    };
  }, [notifyNewEvents, setMessages]);

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

  const ensureCampaignId = React.useCallback(async (): Promise<string | null> => {
    if (campaignIdRef.current) {
      return campaignIdRef.current;
    }
    if (ensuringCampaignRef.current) {
      return ensuringCampaignRef.current;
    }

    const pending = (async () => {
      try {
        const res = await fetch("/api/game/campaigns", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            presetId: "pc_kael",
            mode: "digital",
            ruleset: "5e-full",
          }),
        });
        if (!res.ok) return null;
        const data = (await res.json()) as CampaignApiPayload;
        if (!data.campaignId) return null;
        const defaultActorId = data.state
          ? (Object.keys(data.state.characters)[0] ?? null)
          : null;
        campaignIdRef.current = data.campaignId;
        setCampaignId(data.campaignId);
        setSessionNumber(data.sessionNumber ?? 1);
        setGameState(data.state);
        setEvents(data.events);
        notifyNewEvents(data.events, true);
        setSessionSummaries(data.sessionSummaries ?? []);
        setMemoryFacts(data.memoryFacts ?? []);
        if (Array.isArray(data.presets)) {
          setPresets(data.presets);
        }
        setSelectedActorId(defaultActorId);
        setPausedMode(false);
        setPausedQueue([]);
        transportBundle.updateBody({
          model: effectiveModel,
          campaignId: data.campaignId,
          reasoningEffort: settings.reasoningEffort,
          activeActorId: defaultActorId,
        });
        void fetchCampaignsList();
        return data.campaignId;
      } catch {
        return null;
      } finally {
        ensuringCampaignRef.current = null;
      }
    })();

    ensuringCampaignRef.current = pending;
    return pending;
  }, [
    effectiveModel,
    fetchCampaignsList,
    notifyNewEvents,
    settings.reasoningEffort,
    transportBundle,
  ]);

  async function handleNewCampaign(
    party: PartyMemberSpec[],
    mode: "digital" | "hybrid",
    ruleset: RulesetProfile,
  ): Promise<string | null> {
    const res = await fetch("/api/game/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        presetId: party[0]?.presetId ?? "pc_kael",
        party,
        mode,
        ruleset,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as CampaignApiPayload;
    const firstActorId = data.state
      ? (Object.keys(data.state.characters)[0] ?? null)
      : null;
    campaignIdRef.current = data.campaignId;
    setCampaignId(data.campaignId);
    setSessionNumber(data.sessionNumber ?? 1);
    setGameState(data.state);
    setEvents(data.events);
    notifyNewEvents(data.events, true);
    setSessionSummaries(data.sessionSummaries ?? []);
    setMemoryFacts(data.memoryFacts ?? []);
    if (Array.isArray(data.presets)) {
      setPresets(data.presets);
    }
    setMessages([]);
    setMessageSeqMap({});
    setSelectedActorId(firstActorId);
    setPausedMode(false);
    setPausedQueue([]);
    setSidebarOpen(false);
    transportBundle.updateBody({
      model: effectiveModel,
      campaignId: data.campaignId,
      reasoningEffort: settings.reasoningEffort,
      activeActorId: firstActorId,
    });
    void fetchCampaignsList();
    pushToast({
      title:
        party.length > 1
          ? `Mesa local lista (${party.length} jugadores)`
          : "Nueva campaña lista",
      description: `Aguas Inquietas · ${ruleset}`,
      tone: "amber",
    });
    return data.campaignId;
  }

  async function handleSelectCampaign(targetId: string) {
    if (!targetId || targetId === campaignId || isBusy) return;
    const res = await fetch(
      `/api/game/campaigns?campaignId=${encodeURIComponent(targetId)}`,
    );
    if (!res.ok) return;
    const data = (await res.json()) as CampaignApiPayload;
    applyCampaignPayload(data, true);
    setSelectedActorId(
      data.state ? (Object.keys(data.state.characters)[0] ?? null) : null,
    );
    setPausedMode(false);
    setPausedQueue([]);
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      setCampaignSidebarOpen(false);
    }
    playSound("navigation.forward");
    void fetchCampaignsList();
  }

  async function handleDeleteCampaign(targetId: string) {
    if (!targetId || isBusy) return;
    try {
      const res = await fetch(
        `/api/game/campaigns?campaignId=${encodeURIComponent(targetId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        pushToast({
          title: "No se pudo borrar la partida",
          description: "Intentá nuevamente en unos instantes.",
          tone: "rose",
        });
        return;
      }

      const wasActive = targetId === campaignIdRef.current;
      let nextItems: CampaignSummary[] = [];
      const listRes = await fetch("/api/game/campaigns?list=1&limit=20");
      if (listRes.ok) {
        const listData = (await listRes.json()) as { items?: CampaignSummary[] };
        if (Array.isArray(listData.items)) {
          nextItems = listData.items;
          setCampaignsList(nextItems);
        }
      } else {
        nextItems = campaignsList.filter((item) => item.campaignId !== targetId);
        setCampaignsList(nextItems);
      }

      if (wasActive) {
        const nextCampaign = nextItems[0];
        if (nextCampaign) {
          const loadRes = await fetch(
            `/api/game/campaigns?campaignId=${encodeURIComponent(nextCampaign.campaignId)}`,
          );
          if (loadRes.ok) {
            const data = (await loadRes.json()) as CampaignApiPayload;
            applyCampaignPayload(data, true);
            setSelectedActorId(
              data.state
                ? (Object.keys(data.state.characters)[0] ?? null)
                : null,
            );
            setPausedMode(false);
            setPausedQueue([]);
            setRollingBackSeq(null);
            setStreamingIntroId(null);
          } else {
            resetToEmptyCampaign();
          }
        } else {
          resetToEmptyCampaign();
        }
      }

      playSound("interaction.tap");
      pushToast({
        title: "Partida eliminada",
        description: wasActive
          ? nextItems[0]
            ? `Cargada "${nextItems[0].title}".`
            : "No quedan partidas guardadas."
          : undefined,
        tone: "neutral",
      });
    } catch {
      pushToast({
        title: "No se pudo borrar la partida",
        description: "Error de red al conectar con el servidor.",
        tone: "rose",
      });
    }
  }

  async function handleDeleteAllCampaigns() {
    if (isBusy) return;
    try {
      const res = await fetch("/api/game/campaigns?all=1", {
        method: "DELETE",
      });
      if (!res.ok) {
        pushToast({
          title: "No se pudieron borrar las partidas",
          description: "Intentá nuevamente en unos instantes.",
          tone: "rose",
        });
        return;
      }
      const data = (await res.json()) as { ok?: boolean; deletedCount?: number };
      setCampaignsList([]);
      resetToEmptyCampaign();
      playSound("interaction.tap");
      pushToast({
        title: "Partidas eliminadas",
        description:
          typeof data.deletedCount === "number" && data.deletedCount > 0
            ? `Se eliminaron ${data.deletedCount} partida${data.deletedCount === 1 ? "" : "s"}.`
            : "Tu mesa quedó vacía y lista para empezar.",
        tone: "neutral",
      });
    } catch {
      pushToast({
        title: "No se pudieron borrar las partidas",
        description: "Error de red al conectar con el servidor.",
        tone: "rose",
      });
    }
  }

  async function handleStartCampaignIntro(overrideCampaignId?: string | null) {
    if (seedingIntro || isBusy) return;
    setSeedingIntro(true);
    try {
      const targetId = overrideCampaignId ?? (await ensureCampaignId());
      if (!targetId) {
        pushToast({
          title: "No se pudo iniciar la campaña",
          description: "Intentá nuevamente en unos instantes.",
          tone: "rose",
        });
        return;
      }
      const res = await fetch("/api/game/campaigns/intro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId: targetId }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        ok: boolean;
        state?: GameState;
        events?: GameEvent[];
        messages?: CampaignApiPayload["messages"];
      };
      if (data.ok && Array.isArray(data.messages)) {
        if (data.state) setGameState(data.state);
        if (data.events) {
          setEvents(data.events);
          notifyNewEvents(data.events, true);
        }
        setMessages(
          data.messages.map((m) => ({
            id: m.id,
            role: m.role,
            parts: m.parts,
          })),
        );
        setMessageSeqMap(buildSeqMapFromApiMessages(data.messages));
        const introId = data.messages[0]?.id ?? null;
        if (introId) {
          setStreamingIntroId(introId);
          window.setTimeout(() => {
            setStreamingIntroId((prev) => (prev === introId ? null : prev));
          }, 2800);
        }
        void fetchCampaignsList();
        playSound("notification.info");
        pushToast({
          title: "Nuevo objetivo",
          description: `${AGUAS_INQUIETAS_QUEST.titleEs} — ${AGUAS_INQUIETAS_QUEST.objectiveEs}`,
          tone: "amber",
          meta: "Objetivo principal",
          durationMs: 7000,
        });
      }
    } finally {
      setSeedingIntro(false);
    }
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

  async function handleToggleMode(mode: "digital" | "hybrid") {
    if (!campaignId) return;
    const res = await fetch("/api/game/mode", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ campaignId, mode }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { ok: boolean; state: GameState };
    if (data.ok) {
      setGameState(data.state);
      pushToast({
        title: mode === "hybrid" ? "Modo Híbrido" : "Modo Digital",
        description:
          mode === "hybrid"
            ? "Toda la mesa declara sus dados físicos reales."
            : "El motor resolverá las tiradas automáticamente.",
        tone: "amber",
      });
    }
  }

  async function handleAddPartyMember(
    presetId: CharacterPresetId,
    playerName?: string,
  ) {
    if (!campaignId) return;
    const res = await fetch("/api/game/party", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ campaignId, presetId, playerName }),
    });
    const data = (await res.json()) as {
      ok: boolean;
      state?: GameState;
      event?: GameEvent;
      messageEs?: string;
    };
    if (!res.ok || !data.ok || !data.state) {
      pushToast({
        title: "No se pudo sumar personaje",
        description: data.messageEs ?? "Revisá las condiciones de la mesa.",
        tone: "rose",
      });
      return;
    }
    setGameState(data.state);
    if (data.event) {
      setEvents((prev) => [...prev, data.event!]);
      notifyNewEvents([data.event], false);
      setSelectedActorId(data.event.actor);
    }
  }

  async function handleRemovePartyMember(actorId: string) {
    if (!campaignId) return;
    const res = await fetch("/api/game/party", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ campaignId, actorId }),
    });
    const data = (await res.json()) as {
      ok: boolean;
      state?: GameState;
      event?: GameEvent;
      messageEs?: string;
    };
    if (!res.ok || !data.ok || !data.state) {
      pushToast({
        title: "No se pudo retirar personaje",
        description: data.messageEs ?? "Debe quedar al menos 1 personaje.",
        tone: "rose",
      });
      return;
    }
    setGameState(data.state);
    setPausedQueue((prev) => prev.filter((item) => item.actorId !== actorId));
    if (selectedActorId === actorId) {
      setSelectedActorId(Object.keys(data.state.characters)[0] ?? null);
    }
    if (data.event) {
      setEvents((prev) => [...prev, data.event!]);
      notifyNewEvents([data.event], false);
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
      setPausedQueue([]);
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
        setMessageSeqMap(buildSeqMapFromApiMessages(data.messages));
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
  const currentScene = gameState ? gameState.scenes[gameState.sceneId] : undefined;

  const pcNames = React.useMemo(
    () => partyChars.map((c) => c.name),
    [partyChars],
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

  const allDeclareChecks =
    lastMessage?.role === "assistant"
      ? lastMessage.parts.filter(
          (
            part,
          ): part is Extract<typeof part, { type: "tool-declare_check" }> =>
            part.type === "tool-declare_check",
        )
      : [];
  const resolvedDeclareCount = allDeclareChecks.filter(
    (p) => p.state === "output-available",
  ).length;
  const pendingDeclareCheck = allDeclareChecks.find(
    (p) => p.state === "input-streaming" || p.state === "input-available",
  );
  const pendingDeclareActor =
    pendingDeclareCheck &&
    "input" in pendingDeclareCheck &&
    pendingDeclareCheck.input?.actorId
      ? gameState?.characters[pendingDeclareCheck.input.actorId]
      : undefined;

  const firstAssistantIndex = messages.findIndex((m) => m.role === "assistant");
  const questProgress = React.useMemo(
    () => (gameState ? getAguasInquietasProgress(gameState) : null),
    [gameState],
  );

  const ttsAvailable = access.tier === "whitelisted" && settings.ttsEnabled;
  const showContextMeter = settings.showDevContextMeter;
  const showTensionMeter = settings.showDevTensionMeter;
  const activeTurnStatus =
    settings.showDevLatencyTimer &&
    (status === "submitted" || status === "streaming")
      ? status
      : null;

  const visibleCheckpointByMessageId = React.useMemo(() => {
    const map = new Map<string, number>();
    const currentLastSeq = gameState?.lastSeq ?? 0;
    if (currentLastSeq <= 0) {
      return map;
    }

    const lastMessageIdForSeq = new Map<number, string>();
    for (const msg of messages) {
      if (msg.role !== "assistant") continue;
      const mapped = messageSeqMap[msg.id];
      const seq =
        typeof mapped === "number" ? mapped : extractMaxSeqFromParts(msg.parts);
      if (seq !== null && seq < currentLastSeq) {
        lastMessageIdForSeq.set(seq, msg.id);
      }
    }

    for (const [seq, msgId] of lastMessageIdForSeq.entries()) {
      map.set(msgId, seq);
    }
    return map;
  }, [gameState?.lastSeq, messageSeqMap, messages]);

  const submitPrompt = React.useCallback(
    async (prompt: string) => {
      if (isBusy) return;

      if (
        pausedMode &&
        partyChars.length > 1 &&
        !gameState?.combat?.active &&
        activeActorId
      ) {
        setPausedQueue((prev) => [
          ...prev,
          { id: crypto.randomUUID(), actorId: activeActorId, text: prompt.trim() },
        ]);
        const currentIdx = partyChars.findIndex((c) => c.id === activeActorId);
        if (currentIdx >= 0) {
          const nextChar = partyChars[(currentIdx + 1) % partyChars.length];
          if (nextChar) setSelectedActorId(nextChar.id);
        }
        return;
      }

      const targetCampaignId = campaignId ?? (await ensureCampaignId());
      if (!targetCampaignId) {
        pushToast({
          title: "No se pudo crear la partida",
          description: "Intentá nuevamente en unos instantes.",
          tone: "rose",
        });
        return;
      }

      const resolvedActorId = activeActorId ?? "pc_kael";
      const outgoing =
        partyChars.length > 1 && activeActorId
          ? formatSingleActorMessage(activeActorId, prompt)
          : prompt;

      void sendMessage(
        { text: outgoing },
        {
          body: {
            model: effectiveModel,
            campaignId: targetCampaignId,
            reasoningEffort: settings.reasoningEffort,
            activeActorId: resolvedActorId,
          },
        },
      );
    },
    [
      activeActorId,
      campaignId,
      effectiveModel,
      ensureCampaignId,
      gameState?.combat?.active,
      isBusy,
      partyChars,
      pausedMode,
      sendMessage,
      settings.reasoningEffort,
    ],
  );

  const handleFlushPaused = React.useCallback(() => {
    if (isBusy || pausedQueue.length === 0) return;
    const consolidated = formatGroupRoundMessage(
      pausedQueue.map((item) => ({ actorId: item.actorId, text: item.text })),
    );
    if (!consolidated) return;
    setPausedQueue([]);
    setPausedMode(false);
    void sendMessage(
      { text: consolidated },
      {
        body: {
          model: effectiveModel,
          campaignId,
          reasoningEffort: settings.reasoningEffort,
          activeActorId,
        },
      },
    );
  }, [
    activeActorId,
    campaignId,
    effectiveModel,
    isBusy,
    pausedQueue,
    sendMessage,
    settings.reasoningEffort,
  ]);

  return (
    <div className="tavern-backdrop flex h-svh min-h-0 flex-1 flex-col overflow-hidden">
      {/* Header único superior (44px) */}
      <header className="flex h-11 shrink-0 items-center justify-between gap-1.5 border-b border-border bg-background px-2 sm:gap-2 sm:px-3.5">
        <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={() => {
              const next = !campaignSidebarOpen;
              setCampaignSidebarOpen(next);
              playSound(next ? "overlay.open" : "overlay.close");
              if (next) {
                void fetchCampaignsList();
              }
            }}
            title="Campañas (Alt+C)"
            aria-label="Abrir panel de campañas (Alt+C)"
            aria-controls="campaign-list-sidebar"
            aria-expanded={campaignSidebarOpen}
            className={cn(
              "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-none border px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              campaignSidebarOpen
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-card/60 text-muted-foreground hover:border-foreground/30 hover:text-foreground",
            )}
          >
            <PanelLeftIcon className="size-3.5 shrink-0" />
            <span
              className={cn(
                "hidden",
                partyChars.length > 1 ? "xl:inline" : "lg:inline",
              )}
            >
              Campañas
            </span>
          </button>

          <span aria-hidden="true" className="h-4 w-px shrink-0 bg-border" />

          <Link
            href="/"
            className="flex shrink-0 items-center gap-1.5 transition-opacity hover:opacity-85"
          >
            <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-none border border-amber-500/35 bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <FlameIcon className="size-3.5" />
            </span>
            <span className="hidden font-serif text-sm font-semibold tracking-tight text-foreground min-[360px]:inline sm:text-base">
              Dungeons
            </span>
          </Link>

          <AuthButton className="h-7 rounded-none px-2 text-xs" />

          <span
            aria-hidden="true"
            className="hidden h-4 w-px shrink-0 bg-border md:inline-block"
          />

          <div className="hidden min-w-0 items-center gap-2 md:flex">
            <span className="truncate font-serif text-sm font-medium text-foreground">
              {currentScene?.titleEs ?? "Aguas Inquietas"}
            </span>
            {questProgress && (
              <span className="hidden shrink-0 rounded-none border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground lg:inline-flex">
                Etapa {questProgress.currentStageIndex + 1}/
                {questProgress.quest.stages.length}
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
          {activeChar && gameState && (
            <button
              type="button"
              onClick={() => {
                playSound("interaction.subtle");
                setPartyHudOpen((prev) => !prev);
              }}
              aria-pressed={partyHudOpen}
              aria-label={
                partyHudOpen
                  ? "Ocultar party estilo RPG"
                  : "Mostrar party estilo RPG"
              }
              title={
                partyHudOpen
                  ? `Ocultar grupo (${partyChars.length} PJ)`
                  : `Mostrar grupo (${partyChars.length} PJ)`
              }
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded-full border px-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                partyHudOpen
                  ? "border-primary/60 bg-primary/15 text-primary"
                  : "border-border bg-card/60 text-muted-foreground hover:border-foreground/30 hover:text-foreground",
              )}
            >
              <span className="flex items-center -space-x-1.5">
                {partyChars.slice(0, 3).map((ch) => {
                  const initial = ch.name.trim().slice(0, 1).toUpperCase() || "J";
                  const isActive = ch.id === activeChar.id;
                  return (
                    <span
                      key={ch.id}
                      className={cn(
                        "inline-flex size-5 items-center justify-center rounded-full border text-[10px] font-semibold",
                        isActive
                          ? "z-10 border-primary bg-primary text-primary-foreground"
                          : "border-background bg-muted text-foreground",
                      )}
                    >
                      {initial}
                    </span>
                  );
                })}
              </span>
              {partyChars.length > 3 && (
                <span className="pr-0.5 font-mono text-[10px] font-semibold tabular-nums">
                  +{partyChars.length - 3}
                </span>
              )}
              {partyChars.length === 1 && (
                <UsersIcon className="hidden size-3 opacity-70 sm:inline-block" />
              )}
            </button>
          )}

          <div
            role="group"
            aria-label="Preferencias de la mesa"
            className="inline-flex items-center rounded-none border border-border bg-card/60"
          >
            <SoundToggle />
            <ThemeToggle />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Ajustes de la Mesa (P)"
              title="Ajustes de la Mesa (P)"
              onClick={() => {
                playSound("overlay.open");
                window.dispatchEvent(new CustomEvent("dungeons:open-settings"));
              }}
              className="rounded-none"
            >
              <SlidersHorizontalIcon className="size-4" />
            </Button>
          </div>

          <button
            type="button"
            onClick={() => {
              const next = !sidebarOpen;
              setSidebarOpen(next);
              playSound(next ? "overlay.open" : "overlay.close");
            }}
            title="Ver ficha completa, conjuros, memoria y rollback (Alt+H)"
            aria-label="Abrir panel de ficha (Alt+H)"
            aria-controls="campaign-hud-panel"
            aria-expanded={sidebarOpen}
            className={cn(
              "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-none border px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              sidebarOpen
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-card/60 text-muted-foreground hover:border-foreground/30 hover:text-foreground",
            )}
          >
            <PanelRightIcon className="size-3.5 shrink-0" />
            <span className="hidden lg:inline">Ficha</span>
          </button>
        </div>
      </header>

      {/* Shell de 3 zonas: flujo izquierdo + columna editorial + flujo derecho */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <CampaignSidebar
          open={campaignSidebarOpen}
          onClose={() => setCampaignSidebarOpen(false)}
          activeCampaignId={campaignId}
          campaigns={campaignsList}
          loadingCampaigns={loadingCampaigns}
          presets={presets}
          onSelectCampaign={handleSelectCampaign}
          onNewCampaign={handleNewCampaign}
          onDeleteCampaign={handleDeleteCampaign}
          onDeleteAllCampaigns={handleDeleteAllCampaigns}
        />

        {/* Columna editorial principal */}
        <main
          id="main-content"
          className="relative mx-auto flex min-h-0 min-w-0 flex-1 flex-col"
        >
          {/* Party HUD estilo RPG apilado en el margen derecho */}
          {partyHudOpen && !sidebarOpen && activeChar && gameState && (
            <aside
              aria-label="Estado del grupo"
              className="pointer-events-auto absolute right-3 top-3 z-20 hidden w-48 flex-col gap-1 sm:flex"
            >
              {partyChars.map((ch, idx) => {
                const isSelected = ch.id === activeChar.id;
                const isCombatTurn = combatActivePcId === ch.id;
                const first = ch.name.trim().split(/\s+/)[0] ?? ch.name;
                const hpPct = Math.max(
                  0,
                  Math.min(100, (ch.hp.current / Math.max(1, ch.hp.max)) * 100),
                );
                return (
                  <button
                    key={ch.id}
                    type="button"
                    aria-pressed={isSelected}
                    title={
                      partyChars.length > 1
                        ? `${ch.name}${ch.playerName ? ` (${ch.playerName})` : ""} · Clic para activar (Alt+${idx + 1}), o abrir ficha si ya está activo`
                        : `${ch.name} · Abrir ficha completa (Alt+H)`
                    }
                    onClick={() => {
                      if (partyChars.length > 1 && !isSelected) {
                        playSound("interaction.subtle");
                        setSelectedActorId(ch.id);
                      } else {
                        playSound("overlay.open");
                        setSidebarOpen(true);
                      }
                    }}
                    className={cn(
                      "group relative flex w-full flex-col overflow-hidden rounded-none border bg-card/90 px-2.5 py-1.5 text-left text-[11px] backdrop-blur-sm transition-colors hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      isCombatTurn
                        ? "border-rose-500/70 border-l-2 border-l-rose-500 bg-rose-500/10"
                        : isSelected
                          ? "border-primary/55 border-l-2 border-l-primary bg-card"
                          : "border-border text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <div className="flex w-full items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1">
                        {isCombatTurn && (
                          <SwordsIcon className="size-3 shrink-0 text-rose-500" />
                        )}
                        <span
                          className={cn(
                            "truncate font-medium",
                            isSelected ? "text-primary" : "text-foreground/85",
                          )}
                        >
                          {first}
                        </span>
                      </span>
                      <div className="flex shrink-0 items-center gap-2 font-mono text-[10.5px] tabular-nums">
                        <span className="inline-flex items-center gap-1 text-foreground">
                          {ch.hp.current === 0 ? (
                            <SkullIcon className="size-3 text-rose-500" />
                          ) : (
                            <HeartPulseIcon className="size-3 text-emerald-500" />
                          )}
                          {ch.hp.current}/{ch.hp.max}
                        </span>
                        <span className="inline-flex items-center gap-0.5 text-muted-foreground">
                          <ShieldIcon className="size-3" />
                          {ch.ac}
                        </span>
                      </div>
                    </div>
                    <span
                      aria-hidden="true"
                      className="mt-1.5 block h-0.5 w-full bg-muted"
                    >
                      <span
                        className={cn(
                          "block h-full transition-[width]",
                          ch.hp.current === 0
                            ? "bg-rose-500"
                            : hpPct <= 25
                              ? "bg-amber-500"
                              : "bg-emerald-500",
                        )}
                        style={{ width: `${hpPct}%` }}
                      />
                    </span>
                  </button>
                );
              })}
              {gameState.combat?.active && (
                <div className="flex items-center justify-between rounded-none border border-rose-500/50 bg-rose-500/15 px-2.5 py-1 font-mono text-[10px] font-semibold text-rose-800 dark:text-rose-200">
                  <span className="inline-flex items-center gap-1">
                    <SwordsIcon className="size-3" />
                    Combate activo
                  </span>
                  <span>Ronda {gameState.combat.round}</span>
                </div>
              )}
            </aside>
          )}
          {messages.length === 0 ? (
            <div className="flex min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
              <Empty className="m-auto max-w-2xl rounded-none border-none p-4 sm:p-8">
                <EmptyHeader className="max-w-lg">
                  <span className="inline-flex items-center gap-1.5 rounded-none border border-amber-500/25 bg-amber-500/10 px-2.5 py-0.5 font-mono text-[10px] font-medium text-amber-700 dark:text-amber-300">
                    SRD 5.2.1 · {gameState?.ruleset ?? "5e-full"} · Motor determinista · Voz STT
                  </span>
                  <EmptyTitle className="mt-2 font-serif text-3xl font-semibold tracking-tight">
                    <h1>Aguas Inquietas</h1>
                  </EmptyTitle>
                  <EmptyDescription className="text-[14px] leading-relaxed">
                    Crónica interactiva 5e asistida por motor determinista. Escribí,
                    dictá con el micrófono o abrí el panel lateral (
                    <KbdGroup>
                      <Kbd>Alt</Kbd>
                      <span>+</span>
                      <Kbd>H</Kbd>
                    </KbdGroup>
                    ) para elegir ficha o modo híbrido.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent className="max-w-xl">
                  <Suggestions
                    onStartCampaign={() => {
                      void handleStartCampaignIntro();
                    }}
                    onSelect={(prompt) => {
                      void submitPrompt(prompt);
                    }}
                    presets={presets}
                    onStartLocalParty={async (party, mode, ruleset) => {
                      const createdId = await handleNewCampaign(
                        party,
                        mode,
                        ruleset,
                      );
                      if (createdId) {
                        await handleStartCampaignIntro(createdId);
                      }
                    }}
                    disabled={isBusy || seedingIntro}
                  />
                </EmptyContent>
              </Empty>
            </div>
          ) : (
            <MessageScrollerProvider autoScroll>
              <MessageScroller className="relative flex-1">
                {/* Degradado superior sutil estilo lectura nocturna */}
                <div
                  aria-hidden
                  className="pointer-events-none sticky top-0 z-10 h-6 w-full bg-gradient-to-b from-background/90 to-transparent"
                />
                <MessageScrollerViewport>
                  <MessageScrollerContent className="mx-auto flex w-full max-w-[700px] flex-col gap-7 px-5 pb-8 pt-5 sm:px-6">
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
                            microLabel: "AGUAS INQUIETAS · NUEVA ESCENA",
                            title: transitionPart.output.titleEs,
                          };
                        } else if (idx === firstAssistantIndex && currentScene) {
                          sceneHeader = {
                            microLabel: `AGUAS INQUIETAS · ${gameState?.ruleset.toUpperCase() ?? "5E-FULL"}`,
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

                      const checkpointSeq =
                        visibleCheckpointByMessageId.get(message.id) ?? null;

                      return (
                        <MessageScrollerItem
                          key={message.id}
                          messageId={message.id}
                        >
                          <ChatMessage
                            message={message}
                            isStreaming={
                              (isBusy && message.id === lastMessage?.id) ||
                              message.id === streamingIntroId
                            }
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
                            checkpointSeq={checkpointSeq}
                            isRollingBack={
                              checkpointSeq !== null &&
                              rollingBackSeq === checkpointSeq
                            }
                            onRollback={
                              !isBusy
                                ? (seq) => {
                                    if (rollingBackSeq !== null) return;
                                    void (async () => {
                                      playSound("navigation.backward");
                                      setRollingBackSeq(seq);
                                      try {
                                        await handleRollback(seq);
                                      } finally {
                                        setRollingBackSeq(null);
                                      }
                                    })();
                                  }
                                : undefined
                            }
                            characterName={activeChar?.name}
                            characterClassName={activeChar?.className}
                            charactersById={gameState?.characters}
                            activeChar={activeChar}
                            ruleset={gameState?.ruleset}
                            turnOutcome={turnOutcome}
                            sceneHeader={sceneHeader}
                            pcNames={pcNames}
                            npcNames={npcNames}
                            onSelectSuggestion={(prompt) => {
                              void submitPrompt(prompt);
                            }}
                            onRetry={
                              !isBusy && message.id === lastMessage?.id
                                ? () =>
                                    regenerate({
                                      messageId: message.id,
                                      body: {
                                        model: effectiveModel,
                                        campaignId,
                                        reasoningEffort: settings.reasoningEffort,
                                        activeActorId,
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
                    {pendingQuestion && (
                      <MessageScrollerItem messageId="pending-question">
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
                      </MessageScrollerItem>
                    )}
                    {pausedQueue.map((entry) => {
                      const speakerChar = gameState?.characters[entry.actorId];
                      return (
                        <MessageScrollerItem
                          key={entry.id}
                          messageId={`paused-${entry.id}`}
                        >
                          <div className="flex justify-end">
                            <div className="w-full max-w-[88%] rounded-none border border-dashed border-amber-500/45 bg-amber-500/[0.04] px-3.5 py-2.5 sm:max-w-[78%]">
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex min-w-0 items-center gap-1.5">
                                  <span className="truncate text-xs font-semibold text-amber-700 dark:text-amber-300">
                                    {speakerChar?.name ?? entry.actorId}
                                  </span>
                                  {speakerChar?.playerName && (
                                    <span className="rounded-none bg-background/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                      {speakerChar.playerName}
                                    </span>
                                  )}
                                  <span className="inline-flex items-center gap-1 rounded-none border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[9.5px] font-medium text-amber-700 dark:text-amber-300">
                                    <PauseIcon className="size-2.5" />
                                    En pausa
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  aria-label="Quitar mensaje en pausa"
                                  onClick={() => {
                                    playSound("interaction.tap");
                                    setPausedQueue((prev) =>
                                      prev.filter((item) => item.id !== entry.id),
                                    );
                                  }}
                                  className="rounded-none p-0.5 text-muted-foreground hover:text-rose-500"
                                >
                                  <XIcon className="size-3.5" />
                                </button>
                              </div>
                              <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/90">
                                {entry.text}
                              </p>
                            </div>
                          </div>
                        </MessageScrollerItem>
                      );
                    })}
                    {pendingDeclareCheck &&
                      pendingDeclareCheck.state === "input-available" &&
                      campaignId && (
                        <MessageScrollerItem messageId="pending-declare-check">
                          <HybridCheckCard
                            key={pendingDeclareCheck.toolCallId}
                            campaignId={campaignId}
                            sceneId={pendingDeclareCheck.input.sceneId}
                            actorId={pendingDeclareCheck.input.actorId}
                            actorName={pendingDeclareActor?.name}
                            playerName={pendingDeclareActor?.playerName}
                            queuePosition={
                              allDeclareChecks.length > 1
                                ? {
                                    current: resolvedDeclareCount + 1,
                                    total: allDeclareChecks.length,
                                  }
                                : undefined
                            }
                            skill={pendingDeclareCheck.input.skill}
                            purpose={pendingDeclareCheck.input.purpose}
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
                        </MessageScrollerItem>
                      )}
                    {gameState &&
                      !isBusy &&
                      gameState.sceneId === "escena_08_otra_orilla" && (
                        <MessageScrollerItem messageId="epilogue-card">
                          <EpilogueCard
                            state={gameState}
                            onStartNewCampaign={() => {
                              setCampaignSidebarOpen(true);
                              void fetchCampaignsList();
                            }}
                          />
                        </MessageScrollerItem>
                      )}
                  </MessageScrollerContent>
                </MessageScrollerViewport>
                <MessageScrollerButton />
              </MessageScroller>
            </MessageScrollerProvider>
          )}

          {/* Dock inferior recto */}
          <div className="mx-auto w-full max-w-[700px] shrink-0 px-4 pb-4 pt-2 sm:px-6 sm:pb-5">
            {(error || ttsPlayer.error) && (
              <div className="mb-2 flex flex-col gap-2">
                {error && (
                  <Alert variant="destructive" className="rounded-none">
                    <AlertTitle>Error en la solicitud</AlertTitle>
                    <AlertDescription>{error.message}</AlertDescription>
                  </Alert>
                )}
                {ttsPlayer.error && (
                  <Alert variant="destructive" className="rounded-none">
                    <AlertTitle>Error de audio (TTS)</AlertTitle>
                    <AlertDescription>{ttsPlayer.error}</AlertDescription>
                    <AlertAction>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Cerrar alerta de audio"
                        onClick={ttsPlayer.clearError}
                        className="rounded-none"
                      >
                        <XIcon className="size-3.5" />
                      </Button>
                    </AlertAction>
                  </Alert>
                )}
              </div>
            )}
            <div className="flex flex-col rounded-none">
              {(showContextMeter ||
                (showTensionMeter && gameState) ||
                activeTurnStatus !== null) && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-none border-x border-t border-border bg-card/70 px-2.5 py-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {showContextMeter && (
                      <ContextMeter messages={messages} isBusy={isBusy} />
                    )}
                    {showTensionMeter && gameState && (
                      <TensionMeter
                        state={gameState}
                        events={events}
                        pendingPlayerRoll={Boolean(
                          pendingDeclareCheck || pendingQuestion,
                        )}
                        isStreaming={isBusy}
                      />
                    )}
                  </div>
                  {activeTurnStatus && (
                    <LiveTurnStatus status={activeTurnStatus} />
                  )}
                </div>
              )}
              <PromptForm
                formRef={promptFormRef}
                models={models}
                model={effectiveModel}
                lockedModelIds={lockedModelIds}
                onModelChange={(nextModel) => {
                  updateSettings({ textModel: nextModel });
                }}
                isBusy={isBusy}
                gameState={gameState}
                activeActorId={activeActorId}
                pausedMode={pausedMode}
                onTogglePausedMode={() => setPausedMode((prev) => !prev)}
                pausedCount={pausedQueue.length}
                onFlushPaused={handleFlushPaused}
                onClearPaused={() => setPausedQueue([])}
                onSubmit={(text) => {
                  setStreamingIntroId(null);
                  void submitPrompt(text);
                }}
                onStop={() => {
                  playSound("interaction.tap");
                  stop();
                }}
              />
            </div>
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
          activeActorId={activeActorId}
          onSelectActor={(actorId) => setSelectedActorId(actorId)}
          onAddPartyMember={handleAddPartyMember}
          onRemovePartyMember={handleRemovePartyMember}
          onStartNewSession={handleStartNewSession}
          onToggleMode={handleToggleMode}
          onRollback={handleRollback}
          onQuickAction={(commandDraft) => {
            playSound("interaction.tap");
            if (typeof window !== "undefined" && window.innerWidth < 1024) {
              setSidebarOpen(false);
            }
            promptFormRef.current?.setDraft(commandDraft);
          }}
        />
      </div>
    </div>
  );
}
