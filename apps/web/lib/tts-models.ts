export type TtsModelId =
  | "heygen/heygen-voice-1-turbo:free"
  | "fish-audio/s2.1-pro-free:free";

export interface TtsModelOption {
  id: TtsModelId;
  name: string;
  provider: "openrouter" | "fish";
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
    provider: "fish",
    description: "Voz expresiva directa con control de velocidad.",
    supportsSpeed: true,
    defaultVoice: "bcc53d68b3d1409386d7b4e081a761de",
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
