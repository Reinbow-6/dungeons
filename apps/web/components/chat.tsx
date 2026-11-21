"use client";

import { useChat } from "@ai-sdk/react";
import type { GameEvent, GameState } from "@dungeons/rules";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
} from "ai";
import * as React from "react";

import { ChatMessage } from "@/components/chat-message";
import { GameSidebar } from "@/components/game/game-sidebar";
import { HybridCheckCard } from "@/components/game/hybrid-check-card";
import { PromptForm } from "@/components/prompt-form";
import { QuestionCard } from "@/components/question-card";
import { StatusIcon } from "@/components/status-icon";
import { Suggestions } from "@/components/suggestions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Trace, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace";
import type { CharacterPresetInfo } from "@/lib/game/presets";
import type { SessionSummaryItem, StoredMemoryFact } from "@/lib/game/store";
import { type GatewayModel } from "@/lib/models";
import { type ChatUIMessage } from "@/tools";

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
  const [model, setModel] = React.useState(models[0]?.id ?? "");
  const [campaignId, setCampaignId] = React.useState<string | null>(null);
  const [sessionNumber, setSessionNumber] = React.useState<number>(1);
  const [gameState, setGameState] = React.useState<GameState | null>(null);
  const [events, setEvents] = React.useState<GameEvent[]>([]);
  const [sessionSummaries, setSessionSummaries] = React.useState<
    SessionSummaryItem[]
  >([]);
  const [memoryFacts, setMemoryFacts] = React.useState<StoredMemoryFact[]>([]);
  const [presets, setPresets] = React.useState<CharacterPresetInfo[]>([]);

  const resolvedModel = models.some((m) => m.id === model)
    ? model
    : (models[0]?.id ?? "");

  const [transportBundle] = React.useState(() => {
    let currentBody: { model: string; campaignId: string | null } = {
      model: models[0]?.id ?? "",
      campaignId: null,
    };
    return {
      updateBody(next: { model: string; campaignId: string | null }) {
        currentBody = next;
      },
      transport: new DefaultChatTransport({
        api: "/api/chat",
        body: () => currentBody,
      }),
    };
  });

  React.useEffect(() => {
    transportBundle.updateBody({ model: resolvedModel, campaignId });
  }, [transportBundle, resolvedModel, campaignId]);

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

  const refreshCampaign = React.useCallback(
    async (targetCampaignId?: string, restoreMessages = false) => {
      const url = targetCampaignId
        ? `/api/game/campaigns?campaignId=${encodeURIComponent(targetCampaignId)}`
        : "/api/game/campaigns";
      const res = await fetch(url);
      if (!res.ok) return;
      const data = (await res.json()) as CampaignApiPayload;
      setCampaignId(data.campaignId);
      setSessionNumber(data.sessionNumber ?? 1);
      setGameState(data.state);
      setEvents(data.events);
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
    [setMessages],
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
            ruleset: "5e-lite",
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
  }, [setMessages]);

  const prevStatusRef = React.useRef(status);
  React.useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    if (
      (prev === "submitted" || prev === "streaming") &&
      status === "ready" &&
      campaignId
    ) {
      void refreshCampaign(campaignId, false);
    }
  }, [status, campaignId, refreshCampaign]);

  async function handleNewCampaign(
    presetId: string,
    mode: "digital" | "hybrid",
  ) {
    const res = await fetch("/api/game/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ presetId, mode, ruleset: "5e-lite" }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as CampaignApiPayload;
    setCampaignId(data.campaignId);
    setSessionNumber(data.sessionNumber ?? 1);
    setGameState(data.state);
    setEvents(data.events);
    setSessionSummaries(data.sessionSummaries ?? []);
    setMemoryFacts(data.memoryFacts ?? []);
    setPresets(data.presets ?? []);
    setMessages([]);
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
      if (data.events) setEvents(data.events);
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
    }
  }

  const isBusy = status === "submitted" || status === "streaming";
  const lastMessage = messages.at(-1);

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

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <div className="mx-auto flex min-h-0 w-full flex-1 flex-col">
        {messages.length === 0 ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <Empty>
              <EmptyHeader>
                <EmptyTitle>Aguas Quietas — IA Dungeon Master</EmptyTitle>
                <EmptyDescription>
                  Aventura D&amp;D 5e (SRD 5.2.1). El motor resuelve las reglas;
                  podés alternar entre modo digital y mesa híbrida en el panel
                  lateral.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Suggestions
                  onSelect={(prompt) =>
                    sendMessage(
                      { text: prompt },
                      { body: { model: resolvedModel, campaignId } },
                    )
                  }
                />
              </EmptyContent>
            </Empty>
          </div>
        ) : (
          <MessageScrollerProvider>
            <MessageScroller className="flex-1">
              <MessageScrollerViewport>
                <MessageScrollerContent className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-6">
                  {messages.map((message) => (
                    <MessageScrollerItem
                      key={message.id}
                      messageId={message.id}
                      scrollAnchor={message.role === "user"}
                    >
                      <ChatMessage
                        message={message}
                        isStreaming={isBusy && message.id === lastMessage?.id}
                        onRetry={
                          !isBusy && message.id === lastMessage?.id
                            ? () =>
                                regenerate({
                                  messageId: message.id,
                                  body: { model: resolvedModel, campaignId },
                                })
                            : undefined
                        }
                      />
                    </MessageScrollerItem>
                  ))}
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

        <div className="mx-auto flex w-full max-w-2xl flex-col gap-2 px-6 pb-6">
          {error && (
            <Alert variant="destructive">
              <AlertTitle>Error en la solicitud</AlertTitle>
              <AlertDescription>{error.message}</AlertDescription>
            </Alert>
          )}
          <PromptForm
            models={models}
            model={resolvedModel}
            onModelChange={setModel}
            isBusy={isBusy}
            onSubmit={(text) =>
              sendMessage(
                { text },
                { body: { model: resolvedModel, campaignId } },
              )
            }
            onStop={() => stop()}
          />
        </div>
      </div>

      <GameSidebar
        campaignId={campaignId}
        sessionNumber={sessionNumber}
        state={gameState}
        events={events}
        sessionSummaries={sessionSummaries}
        memoryFacts={memoryFacts}
        presets={presets}
        onNewCampaign={handleNewCampaign}
        onStartNewSession={handleStartNewSession}
        onStateUpdated={setGameState}
        onToggleMode={handleToggleMode}
        onRollback={handleRollback}
        onManualDeclareVerified={(result, nextState, event) => {
          setGameState(nextState);
          setEvents((prev) => [...prev, event]);
          if (!pendingDeclareCheck && !isBusy) {
            void sendMessage(
              {
                text: `[Tirada física validada] ${result.skill}: dados [${result.dieResults.join(", ")}], total ${result.declaredTotal} vs CD ${result.dc} → ${result.success ? "Éxito" : "Fallo"}.`,
              },
              { body: { model: resolvedModel, campaignId } },
            );
          }
        }}
      />
    </div>
  );
}
