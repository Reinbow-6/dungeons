export const STT_PROVIDER = "groq" as const;
export const STT_MODEL_ID = "whisper-large-v3-turbo" as const;
export const STT_MAX_AUDIO_BYTES = 10 * 1024 * 1024;
export const STT_MIN_AUDIO_BYTES = 100;
export const STT_DEFAULT_LANGUAGE = "es" as const;
export const STT_DEFAULT_PROMPT =
  "Partida de rol D&D 5e en español. Términos: Aguas Quietas, Kael, Brenna, Lira, Comandante Mireia, Explorador de la Espesura, Necrófago de río, Percepción, Investigación, Sigilo, Persuasión, Atletismo, CD, d20, PG, CA, ventaja, desventaja, iniciativa.";

const GROQ_TRANSCRIPTIONS_URL =
  "https://api.groq.com/openai/v1/audio/transcriptions";

export type SttErrorCode =
  | "MISSING_API_KEY"
  | "INVALID_AUDIO"
  | "AUDIO_TOO_LARGE"
  | "AUDIO_TOO_SHORT"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "PROVIDER_UNAVAILABLE"
  | "EMPTY_TRANSCRIPT";

export class SttError extends Error {
  readonly code: SttErrorCode;

  constructor(code: SttErrorCode, message: string) {
    super(message);
    this.name = "SttError";
    this.code = code;
  }
}

const MIME_TO_EXT: Record<string, string> = {
  "audio/webm": "webm",
  "video/webm": "webm",
  "audio/ogg": "ogg",
  "application/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/flac": "flac",
};

const EXT_TO_MIME: Record<string, { mimeType: string; extension: string }> = {
  webm: { mimeType: "audio/webm", extension: "webm" },
  ogg: { mimeType: "audio/ogg", extension: "ogg" },
  m4a: { mimeType: "audio/mp4", extension: "m4a" },
  mp4: { mimeType: "audio/mp4", extension: "mp4" },
  mp3: { mimeType: "audio/mpeg", extension: "mp3" },
  wav: { mimeType: "audio/wav", extension: "wav" },
  flac: { mimeType: "audio/flac", extension: "flac" },
};

/**
 * Strips codec parameters and validates audio MIME/extension against Groq Whisper's allowlist.
 */
export function normalizeAudioMediaType(
  rawMime?: string,
  fileName?: string,
): { mimeType: string; extension: string } | null {
  const baseMime = (rawMime ?? "").split(";")[0]?.trim().toLowerCase() ?? "";

  if (baseMime && baseMime !== "application/octet-stream") {
    const ext = MIME_TO_EXT[baseMime];
    if (!ext) {
      return null;
    }
    return { mimeType: baseMime, extension: ext };
  }

  const extMatch = fileName?.trim().toLowerCase().match(/\.([a-z0-9]+)$/);
  const extFromName = extMatch?.[1];
  if (extFromName && EXT_TO_MIME[extFromName]) {
    return EXT_TO_MIME[extFromName];
  }

  return null;
}

export interface TranscribeAudioParams {
  audioBytes: Uint8Array;
  mimeType?: string;
  fileName?: string;
  language?: string;
  prompt?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

export interface TranscribeAudioResult {
  text: string;
  modelId: typeof STT_MODEL_ID;
  language: string;
  durationMs: number;
}

function normalizeLanguage(raw?: string): string {
  const cleaned = raw?.trim().toLowerCase();
  if (cleaned && /^[a-z]{2}$/.test(cleaned)) {
    return cleaned;
  }
  return STT_DEFAULT_LANGUAGE;
}

/**
 * Transcribes spoken player audio via Groq `whisper-large-v3-turbo`.
 */
export async function transcribeAudioWithGroq(
  params: TranscribeAudioParams,
): Promise<TranscribeAudioResult> {
  const startedAt = Date.now();
  const apiKey = (params.apiKey ?? process.env.GROQ_API_KEY)?.trim();
  if (!apiKey) {
    throw new SttError(
      "MISSING_API_KEY",
      "Falta GROQ_API_KEY en el entorno para transcribir voz con Groq Whisper.",
    );
  }

  if (!(params.audioBytes instanceof Uint8Array)) {
    throw new SttError(
      "INVALID_AUDIO",
      "El archivo de audio recibido no es válido.",
    );
  }

  if (params.audioBytes.byteLength < STT_MIN_AUDIO_BYTES) {
    throw new SttError(
      "AUDIO_TOO_SHORT",
      "La grabación es demasiado corta para transcribir.",
    );
  }

  if (params.audioBytes.byteLength > STT_MAX_AUDIO_BYTES) {
    throw new SttError(
      "AUDIO_TOO_LARGE",
      "La grabación supera el límite permitido de 10 MB.",
    );
  }

  const normalized = normalizeAudioMediaType(params.mimeType, params.fileName);
  if (!normalized) {
    throw new SttError(
      "UNSUPPORTED_MEDIA_TYPE",
      "Formato de audio no soportado. Usá webm, ogg, mp4/m4a, mp3, wav o flac.",
    );
  }

  const language = normalizeLanguage(params.language);
  const formData = new FormData();
  const audioFile = new File(
    [new Uint8Array(params.audioBytes)],
    `audio.${normalized.extension}`,
    { type: normalized.mimeType },
  );
  formData.append("file", audioFile);
  formData.append("model", STT_MODEL_ID);
  formData.append("language", language);
  formData.append("response_format", "json");
  formData.append("temperature", "0");
  formData.append("prompt", params.prompt ?? STT_DEFAULT_PROMPT);

  const fetchFn = params.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchFn(GROQ_TRANSCRIPTIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
      signal: params.signal,
    });
  } catch {
    throw new SttError(
      "PROVIDER_UNAVAILABLE",
      "No se pudo conectar con Groq Whisper para transcribir el audio. Intentá de nuevo.",
    );
  }

  if (!response.ok) {
    throw new SttError(
      "PROVIDER_UNAVAILABLE",
      "No se pudo transcribir el audio con Groq Whisper. Intentá de nuevo.",
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new SttError(
      "PROVIDER_UNAVAILABLE",
      "Groq Whisper devolvió una respuesta inválida. Intentá de nuevo.",
    );
  }

  const rawText =
    payload &&
    typeof payload === "object" &&
    typeof (payload as { text?: unknown }).text === "string"
      ? (payload as { text: string }).text
      : "";
  const text = rawText.trim();

  if (text.length === 0) {
    throw new SttError(
      "EMPTY_TRANSCRIPT",
      "No se detectó voz clara en la grabación.",
    );
  }

  return {
    text,
    modelId: STT_MODEL_ID,
    language,
    durationMs: Math.max(0, Date.now() - startedAt),
  };
}
