"use client";

import * as React from "react";

import {
  DEFAULT_MODEL,
  MODELS,
  type ReasoningEffort,
} from "@/lib/models";
import {
  DEFAULT_TTS_MODEL,
  TTS_MODELS,
  type TtsModelId,
} from "@/lib/tts-models";

export const APP_SETTINGS_STORAGE_KEY = "dungeons:app-settings";
export const APP_SETTINGS_CHANGED_EVENT = "dungeons:settings-changed";

export interface AppSettings {
  textModel: string;
  reasoningEffort: ReasoningEffort;
  ttsEnabled: boolean;
  ttsModel: TtsModelId;
  ttsVoice: string;
  ttsAutoPlay: boolean;
  ttsSpeed: number;
  showDevContextMeter: boolean;
  showDevLatencyTimer: boolean;
  showDevReasoningView: boolean;
}

export const DEFAULT_APP_SETTINGS: AppSettings = Object.freeze({
  textModel: DEFAULT_MODEL,
  reasoningEffort: "none",
  ttsEnabled: true,
  ttsModel: DEFAULT_TTS_MODEL,
  ttsVoice: "default",
  ttsAutoPlay: false,
  ttsSpeed: 1.0,
  showDevContextMeter: true,
  showDevLatencyTimer: true,
  showDevReasoningView: true,
});

const VALID_REASONING_EFFORTS = new Set<ReasoningEffort>([
  "none",
  "low",
  "medium",
  "high",
]);

function normalizeReasoningEffortValue(raw: unknown): ReasoningEffort {
  if (
    typeof raw === "string" &&
    VALID_REASONING_EFFORTS.has(raw as ReasoningEffort)
  ) {
    return raw as ReasoningEffort;
  }
  return DEFAULT_APP_SETTINGS.reasoningEffort;
}

function normalizeTtsModelValue(raw: unknown): TtsModelId {
  if (typeof raw === "string" && TTS_MODELS.some((m) => m.id === raw)) {
    return raw as TtsModelId;
  }
  return DEFAULT_APP_SETTINGS.ttsModel;
}

function normalizeTextModelValue(raw: unknown): string {
  if (typeof raw === "string" && MODELS.some((m) => m.id === raw)) {
    return raw;
  }
  return DEFAULT_APP_SETTINGS.textModel;
}

function normalizeSpeedValue(raw: unknown): number {
  if (
    typeof raw === "number" &&
    Number.isFinite(raw) &&
    raw >= 0.5 &&
    raw <= 2.0
  ) {
    return Math.round(raw * 100) / 100;
  }
  return DEFAULT_APP_SETTINGS.ttsSpeed;
}

export function normalizeAppSettings(raw: unknown): AppSettings {
  if (!raw || typeof raw !== "object") {
    return DEFAULT_APP_SETTINGS;
  }
  const obj = raw as Record<string, unknown>;

  return {
    textModel: normalizeTextModelValue(obj.textModel),
    reasoningEffort: normalizeReasoningEffortValue(obj.reasoningEffort),
    ttsEnabled:
      typeof obj.ttsEnabled === "boolean"
        ? obj.ttsEnabled
        : DEFAULT_APP_SETTINGS.ttsEnabled,
    ttsModel: normalizeTtsModelValue(obj.ttsModel),
    ttsVoice:
      typeof obj.ttsVoice === "string" && obj.ttsVoice.trim().length > 0
        ? obj.ttsVoice.trim()
        : DEFAULT_APP_SETTINGS.ttsVoice,
    ttsAutoPlay:
      typeof obj.ttsAutoPlay === "boolean"
        ? obj.ttsAutoPlay
        : DEFAULT_APP_SETTINGS.ttsAutoPlay,
    ttsSpeed: normalizeSpeedValue(obj.ttsSpeed),
    showDevContextMeter:
      typeof obj.showDevContextMeter === "boolean"
        ? obj.showDevContextMeter
        : DEFAULT_APP_SETTINGS.showDevContextMeter,
    showDevLatencyTimer:
      typeof obj.showDevLatencyTimer === "boolean"
        ? obj.showDevLatencyTimer
        : DEFAULT_APP_SETTINGS.showDevLatencyTimer,
    showDevReasoningView:
      typeof obj.showDevReasoningView === "boolean"
        ? obj.showDevReasoningView
        : DEFAULT_APP_SETTINGS.showDevReasoningView,
  };
}

// Module-level snapshot cache so useSyncExternalStore gets referential stability
// when localStorage hasn't changed (required in React 19 to prevent loops).
let cachedRawJson: string | null | undefined = undefined;
let cachedSnapshot: AppSettings = DEFAULT_APP_SETTINGS;
let memoryOnlyOverride = false;

function getServerSnapshot(): AppSettings {
  return DEFAULT_APP_SETTINGS;
}

function getSnapshot(): AppSettings {
  if (typeof window === "undefined") {
    return DEFAULT_APP_SETTINGS;
  }
  if (memoryOnlyOverride) {
    return cachedSnapshot;
  }

  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(APP_SETTINGS_STORAGE_KEY);
  } catch {
    return cachedSnapshot;
  }

  if (raw === cachedRawJson) {
    return cachedSnapshot;
  }

  cachedRawJson = raw;
  if (!raw) {
    cachedSnapshot = DEFAULT_APP_SETTINGS;
    return cachedSnapshot;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    cachedSnapshot = normalizeAppSettings(parsed);
  } catch {
    cachedSnapshot = DEFAULT_APP_SETTINGS;
  }
  return cachedSnapshot;
}

function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === APP_SETTINGS_STORAGE_KEY) {
      memoryOnlyOverride = false;
      callback();
    }
  };

  window.addEventListener("storage", onStorage);
  window.addEventListener(APP_SETTINGS_CHANGED_EVENT, callback);

  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(APP_SETTINGS_CHANGED_EVENT, callback);
  };
}

export function updateAppSettings(patch: Partial<AppSettings>): void {
  const current = getSnapshot();
  const next = normalizeAppSettings({ ...current, ...patch });
  const serialized = JSON.stringify(next);

  if (!memoryOnlyOverride && serialized === cachedRawJson) {
    return;
  }

  cachedSnapshot = next;

  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(APP_SETTINGS_STORAGE_KEY, serialized);
    cachedRawJson = serialized;
    memoryOnlyOverride = false;
  } catch {
    memoryOnlyOverride = true;
  }

  window.dispatchEvent(new Event(APP_SETTINGS_CHANGED_EVENT));
}

export function resetAppSettings(): void {
  memoryOnlyOverride = false;
  cachedSnapshot = DEFAULT_APP_SETTINGS;

  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(APP_SETTINGS_STORAGE_KEY);
    cachedRawJson = null;
  } catch {
    cachedRawJson = null;
  }

  window.dispatchEvent(new Event(APP_SETTINGS_CHANGED_EVENT));
}

export interface UseAppSettingsResult {
  settings: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => void;
  resetSettings: () => void;
}

export function useAppSettings(): UseAppSettingsResult {
  const settings = React.useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  return {
    settings,
    updateSettings: updateAppSettings,
    resetSettings: resetAppSettings,
  };
}
