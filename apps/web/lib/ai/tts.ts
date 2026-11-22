import {
  DEFAULT_TTS_MODEL,
  findTtsModelOption,
  isTtsModelAllowed,
  TTS_MODELS,
  type TtsModelId,
} from "@/lib/tts-models";

export const OPENROUTER_SPEECH_URL = "https://openrouter.ai/api/v1/audio/speech";
export const TTS_DEFAULT_MAX_CHARS = 4500;
export const TTS_PCM_SAMPLE_RATE = 44100;

const RETRYABLE_TTS_STATUSES = new Set([429, 502, 503]);

export type TtsErrorCode =
  | "MISSING_API_KEY"
  | "INVALID_TEXT"
  | "INVALID_MODEL"
  | "RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_BAD_REQUEST";

export class TtsError extends Error {
  readonly code: TtsErrorCode;
  readonly status?: number;

  constructor(code: TtsErrorCode, message: string, status?: number) {
    super(message);
    this.name = "TtsError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Strips markdown syntax (headings, emphasis, code blocks, links) and collapses
 * whitespace so DM narrations read naturally via TTS within `maxChars`.
 */
export function sanitizeTextForTts(
  markdown: string,
  maxChars: number = TTS_DEFAULT_MAX_CHARS,
): string {
  if (typeof markdown !== "string" || maxChars <= 0) {
    return "";
  }

  let text = markdown.replace(/\r\n?/g, "\n");

  // Drop fenced code blocks so raw JSON/code snippets are not spoken aloud
  text = text.replace(/```[\s\S]*?```/g, " ");
  text = text.replace(/~~~[\s\S]*?~~~/g, " ");

  // Unwrap inline code backticks while keeping the spoken term
  text = text.replace(/`([^`]*)`/g, "$1");

  // Convert markdown images & links to their visible label
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  text = text.replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1");
  text = text.replace(/^\s*\[[^\]]+\]:\s+\S+.*$/gm, "");
  text = text.replace(/<https?:\/\/[^>]+>/gi, "");

  // Strip block-level markdown markers
  text = text.replace(/^\s{0,3}#{1,6}\s*/gm, "");
  text = text.replace(/^\s{0,3}>\s?/gm, "");
  text = text.replace(/^\s{0,3}([-*_])\s*(?:\1\s*){2,}$/gm, " ");
  text = text.replace(/^\s*[-*+]\s+/gm, "");
  text = text.replace(/<br\s*\/?>/gi, " ");

  // Strip inline emphasis markers while preserving underscores inside identifiers
  text = text.replace(/\*\*\*([\s\S]+?)\*\*\*/g, "$1");
  text = text.replace(/\*\*([\s\S]+?)\*\*/g, "$1");
  text = text.replace(/\*([^*\n]+?)\*/g, "$1");
  text = text.replace(/~~([\s\S]+?)~~/g, "$1");
  text = text.replace(/__([\s\S]+?)__/g, "$1");
  text = text.replace(
    /(^|[\s(\["'])_([^_\n]+?)_(?=$|[\s).,!?:;"'\-\]])/g,
    "$1$2",
  );

  // Remove any leftover stray markdown symbols (#, *, `)
  text = text.replace(/[*`]/g, "");
  text = text.replace(/(^|\s)#+/g, "$1");

  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxChars) {
    return collapsed;
  }

  const slice = collapsed.slice(0, maxChars);
  const nextChar = collapsed[maxChars];
  if (nextChar !== undefined && /\s/.test(nextChar)) {
    return slice.trimEnd();
  }

  const lastSpace = slice.lastIndexOf(" ");
  if (lastSpace > 0 && lastSpace >= Math.floor(maxChars * 0.4)) {
    return slice.slice(0, lastSpace).trimEnd();
  }

  return slice.trimEnd();
}

/**
 * Prepends a standard 44-byte RIFF/WAVE header around raw signed 16-bit LE mono PCM bytes.
 */
export function wrapPcm16MonoAsWav(
  pcmBytes: Uint8Array,
  sampleRate: number = TTS_PCM_SAMPLE_RATE,
): Uint8Array {
  const safeSampleRate =
    Number.isFinite(sampleRate) && sampleRate > 0
      ? Math.round(sampleRate)
      : TTS_PCM_SAMPLE_RATE;
  const numChannels = 1;
  const bitsPerSample = 16;
  const blockAlign = numChannels * (bitsPerSample / 8);
  const byteRate = safeSampleRate * blockAlign;
  const dataSize = pcmBytes.byteLength;

  const wavBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(wavBuffer);
  const outBytes = new Uint8Array(wavBuffer);

  // "RIFF" chunk descriptor
  view.setUint8(0, 0x52); // R
  view.setUint8(1, 0x49); // I
  view.setUint8(2, 0x46); // F
  view.setUint8(3, 0x46); // F
  view.setUint32(4, 36 + dataSize, true);
  view.setUint8(8, 0x57); // W
  view.setUint8(9, 0x41); // A
  view.setUint8(10, 0x56); // V
  view.setUint8(11, 0x45); // E

  // "fmt " sub-chunk
  view.setUint8(12, 0x66); // f
  view.setUint8(13, 0x6d); // m
  view.setUint8(14, 0x74); // t
  view.setUint8(15, 0x20); // (space)
  view.setUint32(16, 16, true); // PCM sub-chunk size
  view.setUint16(20, 1, true); // AudioFormat = 1 (PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, safeSampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // "data" sub-chunk
  view.setUint8(36, 0x64); // d
  view.setUint8(37, 0x61); // a
  view.setUint8(38, 0x74); // t
  view.setUint8(39, 0x61); // a
  view.setUint32(40, dataSize, true);

  outBytes.set(pcmBytes, 44);
  return outBytes;
}

function hasWavHeader(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 12) return false;
  return (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x41 &&
    bytes[10] === 0x56 &&
    bytes[11] === 0x45
  );
}

function isPcmOrOctetContentType(
  rawContentType: string | null,
  modelId: TtsModelId,
): boolean {
  const base = rawContentType?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (
    base.includes("pcm") ||
    base.includes("l16") ||
    base === "application/octet-stream" ||
    base === "binary/octet-stream"
  ) {
    return true;
  }
  return base === "" && modelId === "heygen/heygen-voice-1-turbo:free";
}

function getFallbackTtsModel(primary: TtsModelId): TtsModelId | null {
  return TTS_MODELS.find((model) => model.id !== primary)?.id ?? null;
}

function buildOpenRouterSpeechBody(params: {
  modelId: TtsModelId;
  input: string;
  voice?: string;
  speed?: number;
}): Record<string, unknown> {
  const option = findTtsModelOption(params.modelId);
  const rawVoice = params.voice?.trim();
  const isHeygen = params.modelId === "heygen/heygen-voice-1-turbo:free";

  const resolvedVoice = isHeygen
    ? !rawVoice || rawVoice.toLowerCase() === "default"
      ? (option?.defaultVoice ?? "vincent")
      : rawVoice
    : rawVoice || option?.defaultVoice || "default";

  const body: Record<string, unknown> = {
    model: params.modelId,
    input: params.input,
    voice: resolvedVoice,
    response_format: isHeygen ? "pcm" : "mp3",
  };

  if (
    option?.supportsSpeed &&
    typeof params.speed === "number" &&
    Number.isFinite(params.speed)
  ) {
    const clampedSpeed = Math.min(2.0, Math.max(0.5, params.speed));
    body.speed = clampedSpeed;
  }

  return body;
}

export interface SynthesizeSpeechParams {
  text: string;
  modelId?: TtsModelId | string;
  voice?: string;
  speed?: number;
  fallbackOnRateLimit?: boolean;
  signal?: AbortSignal;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}

export interface SynthesizeSpeechResult {
  audioBytes: Uint8Array;
  contentType: string;
  modelUsed: TtsModelId;
  fallbackUsed: boolean;
  sanitizedText: string;
}

function mapHttpStatusToTtsError(status: number): TtsError {
  if (status === 429) {
    return new TtsError(
      "RATE_LIMITED",
      "El servicio de voz alcanzó temporalmente el límite de solicitudes. Intentá de nuevo en unos segundos.",
      429,
    );
  }
  if (status === 502 || status === 503 || status >= 500) {
    return new TtsError(
      "PROVIDER_UNAVAILABLE",
      "El servicio de síntesis de voz no está disponible en este momento.",
      503,
    );
  }
  return new TtsError(
    "PROVIDER_BAD_REQUEST",
    "No se pudo sintetizar el audio con los parámetros solicitados.",
    status,
  );
}

/**
 * Generates spoken audio through OpenRouter `/api/v1/audio/speech` with
 * automatic fallback between the curated free TTS models on 429/502/503 and
 * automatic WAV framing when raw 44.1 kHz PCM is returned.
 */
export async function synthesizeSpeechWithOpenRouter(
  params: SynthesizeSpeechParams,
): Promise<SynthesizeSpeechResult> {
  const env = params.env ?? process.env;
  const apiKey = env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new TtsError(
      "MISSING_API_KEY",
      "Falta OPENROUTER_API_KEY en el entorno para usar síntesis de voz (TTS).",
      503,
    );
  }

  const sanitizedText = sanitizeTextForTts(params.text);
  if (sanitizedText.length === 0) {
    throw new TtsError(
      "INVALID_TEXT",
      "No hay texto legible para convertir en voz.",
      400,
    );
  }

  const requestedRaw =
    typeof params.modelId === "string" && params.modelId.trim().length > 0
      ? params.modelId.trim()
      : DEFAULT_TTS_MODEL;

  if (!isTtsModelAllowed(requestedRaw)) {
    throw new TtsError(
      "INVALID_MODEL",
      `El modelo TTS "${requestedRaw}" no está habilitado.`,
      400,
    );
  }

  const primaryModel: TtsModelId = requestedRaw;
  const fallbackOnRateLimit = params.fallbackOnRateLimit ?? true;
  const fallbackModel = fallbackOnRateLimit
    ? getFallbackTtsModel(primaryModel)
    : null;
  const candidates: TtsModelId[] = fallbackModel
    ? [primaryModel, fallbackModel]
    : [primaryModel];

  const fetchFn = params.fetchImpl ?? fetch;

  let lastError: TtsError | null = null;

  for (let i = 0; i < candidates.length; i += 1) {
    const modelId = candidates[i]!;
    const isFallbackAttempt = i > 0;
    const body = buildOpenRouterSpeechBody({
      modelId,
      input: sanitizedText,
      voice: params.voice,
      speed: params.speed,
    });

    let response: Response;
    try {
      response = await fetchFn(OPENROUTER_SPEECH_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: params.signal,
      });
    } catch (err) {
      if (params.signal?.aborted) {
        throw err;
      }
      lastError = new TtsError(
        "PROVIDER_UNAVAILABLE",
        "No se pudo conectar con OpenRouter TTS para generar el audio.",
        503,
      );
      if (!isFallbackAttempt && candidates.length > 1) {
        continue;
      }
      throw lastError;
    }

    if (!response.ok) {
      lastError = mapHttpStatusToTtsError(response.status);
      if (
        !isFallbackAttempt &&
        candidates.length > 1 &&
        RETRYABLE_TTS_STATUSES.has(response.status)
      ) {
        continue;
      }
      throw lastError;
    }

    const rawBytes = new Uint8Array(await response.arrayBuffer());
    if (rawBytes.byteLength === 0) {
      lastError = new TtsError(
        "PROVIDER_UNAVAILABLE",
        "OpenRouter TTS devolvió una respuesta de audio vacía.",
        503,
      );
      if (!isFallbackAttempt && candidates.length > 1) {
        continue;
      }
      throw lastError;
    }

    const rawContentType = response.headers.get("content-type");
    const baseContentType =
      rawContentType?.split(";")[0]?.trim().toLowerCase() ?? "";

    const shouldWrapPcm =
      !hasWavHeader(rawBytes) &&
      isPcmOrOctetContentType(rawContentType, modelId);

    const audioBytes = shouldWrapPcm
      ? wrapPcm16MonoAsWav(rawBytes, TTS_PCM_SAMPLE_RATE)
      : rawBytes;
    const contentType = shouldWrapPcm
      ? "audio/wav"
      : hasWavHeader(rawBytes)
        ? "audio/wav"
        : baseContentType || "audio/mpeg";

    return {
      audioBytes,
      contentType,
      modelUsed: modelId,
      fallbackUsed: isFallbackAttempt,
      sanitizedText,
    };
  }

  throw (
    lastError ??
    new TtsError(
      "PROVIDER_UNAVAILABLE",
      "No se pudo completar la síntesis de voz.",
      503,
    )
  );
}
