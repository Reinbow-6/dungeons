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
    name: "HeyGen Voice Turbo (Gratis)",
    provider: "openrouter",
    description: "Baja latencia; entrega PCM 44.1 kHz mono convertido a WAV.",
    supportsSpeed: false,
    defaultVoice: "vincent",
  },
  {
    id: "fish-audio/s2.1-pro-free:free",
    name: "Fish Audio S2.1 Pro (Gratis)",
    provider: "openrouter",
    description: "Narración expresiva multilingüe con soporte de velocidad.",
    supportsSpeed: true,
    defaultVoice: "default",
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
