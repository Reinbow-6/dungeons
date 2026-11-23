export type TtsModelId =
  | "heygen/heygen-voice-1-turbo:free"
  | "fish-audio/s2.1-pro-free:free";

export interface TtsModelOption {
  id: TtsModelId;
  name: string;
  provider: "openrouter";
  description: string;
  supportsSpeed: boolean;
  defaultVoice: string;
}

export const TTS_MODELS: TtsModelOption[] = [
  {
    id: "heygen/heygen-voice-1-turbo:free",
    name: "HeyGen",
    provider: "openrouter",
    description: "Voz rápida de baja latencia.",
    supportsSpeed: false,
    defaultVoice: "vincent",
  },
  {
    id: "fish-audio/s2.1-pro-free:free",
    name: "Fish",
    provider: "openrouter",
    description: "Voz expresiva con control de velocidad.",
    supportsSpeed: true,
    defaultVoice: "872aed4c691c4cbb830649f8af64bd59",
  },
];

export const DEFAULT_TTS_MODEL: TtsModelId = "heygen/heygen-voice-1-turbo:free";

export function findTtsModelOption(id: string): TtsModelOption | undefined {
  return TTS_MODELS.find((model) => model.id === id);
}

export function isTtsModelAllowed(id: unknown): id is TtsModelId {
  return (
    typeof id === "string" && TTS_MODELS.some((model) => model.id === id)
  );
}
