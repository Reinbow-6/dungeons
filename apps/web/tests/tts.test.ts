import { afterEach, describe, expect, it, vi } from "vitest";

import {
  OPENROUTER_SPEECH_URL,
  sanitizeTextForTts,
  synthesizeSpeechWithOpenRouter,
  TtsError,
  wrapPcm16MonoAsWav,
} from "@/lib/ai/tts";
import * as whitelistModule from "@/lib/auth/whitelist";
import {
  DEFAULT_TTS_MODEL,
  isTtsModelAllowed,
  TTS_MODELS,
} from "@/lib/tts-models";
import { POST as ttsPostRoute } from "@/app/api/tts/route";

describe("tts-models catalog", () => {
  it("exposes curated HeyGen Voice Turbo and Fish Audio S2.1 Pro free models", () => {
    expect(DEFAULT_TTS_MODEL).toBe("heygen/heygen-voice-1-turbo:free");
    expect(TTS_MODELS.map((m) => m.id)).toEqual([
      "heygen/heygen-voice-1-turbo:free",
      "fish-audio/s2.1-pro-free:free",
    ]);
    expect(TTS_MODELS.map((m) => m.name)).toEqual(["HeyGen", "Fish"]);
    expect(isTtsModelAllowed("heygen/heygen-voice-1-turbo:free")).toBe(true);
    expect(isTtsModelAllowed("fish-audio/s2.1-pro-free:free")).toBe(true);
    expect(isTtsModelAllowed("openai/gpt-4o-mini-tts")).toBe(false);
    expect(isTtsModelAllowed("")).toBe(false);
    expect(isTtsModelAllowed(null)).toBe(false);
  });
});

describe("sanitizeTextForTts", () => {
  it("strips markdown headings, bold/italic, code blocks, inline code, and links", () => {
    const md = [
      "# Capítulo 1: Aguas Quietas",
      "",
      "**Kael** avanza con *cautela* hacia [el muelle](https://ejemplo.local/muelle) usando `Sigilo`.",
      "",
      "```json",
      '{"secret": "should-not-be-spoken"}',
      "```",
      "",
      "> *Una sombra* se desliza bajo el puente.",
    ].join("\n");

    const cleaned = sanitizeTextForTts(md);
    expect(cleaned).toBe(
      "Capítulo 1: Aguas Quietas Kael avanza con cautela hacia el muelle usando Sigilo. Una sombra se desliza bajo el puente.",
    );
    expect(cleaned).not.toContain("#");
    expect(cleaned).not.toContain("*");
    expect(cleaned).not.toContain("should-not-be-spoken");
    expect(cleaned).not.toContain("https://");
  });

  it("collapses whitespace and truncates cleanly within maxChars", () => {
    const cleaned = sanitizeTextForTts(
      "La   niebla   cubre   el   sendero   del   bosque",
      22,
    );
    expect(cleaned.length).toBeLessThanOrEqual(22);
    expect(cleaned).toBe("La niebla cubre el");
    expect(sanitizeTextForTts("```ts\nconst x = 1;\n```")).toBe("");
  });
});

describe("wrapPcm16MonoAsWav", () => {
  it("writes a valid 44-byte RIFF/WAVE header around 44.1 kHz 16-bit mono PCM", () => {
    const pcm = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05, 0x06]);
    const wav = wrapPcm16MonoAsWav(pcm, 44100);

    expect(wav.byteLength).toBe(44 + pcm.byteLength);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...wav.slice(8, 12))).toBe("WAVE");
    expect(String.fromCharCode(...wav.slice(12, 16))).toBe("fmt ");
    expect(String.fromCharCode(...wav.slice(36, 40))).toBe("data");

    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    expect(view.getUint32(4, true)).toBe(36 + pcm.byteLength);
    expect(view.getUint32(16, true)).toBe(16);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(44100);
    expect(view.getUint32(28, true)).toBe(88200);
    expect(view.getUint16(32, true)).toBe(2);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(pcm.byteLength);
    expect(Array.from(wav.slice(44))).toEqual(Array.from(pcm));
  });
});

describe("synthesizeSpeechWithOpenRouter", () => {
  it("throws MISSING_API_KEY TtsError when OPENROUTER_API_KEY is absent", async () => {
    await expect(
      synthesizeSpeechWithOpenRouter({
        text: "Hola aventurero",
        env: {},
      }),
    ).rejects.toMatchObject({
      name: "TtsError",
      code: "MISSING_API_KEY",
    });

    try {
      await synthesizeSpeechWithOpenRouter({ text: "Hola", env: {} });
    } catch (err) {
      expect(err).toBeInstanceOf(TtsError);
    }
  });

  it("wraps PCM/octet-stream from HeyGen Voice Turbo into audio/wav and respects voice/speed constraints", async () => {
    const pcmPayload = new Uint8Array([10, 20, 30, 40]);
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      calls.push({
        url: String(input),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      });
      return new Response(pcmPayload, {
        status: 200,
        headers: { "Content-Type": "audio/pcm" },
      });
    };

    const result = await synthesizeSpeechWithOpenRouter({
      text: "## Bienvenidos\n**Aventureros**",
      modelId: "heygen/heygen-voice-1-turbo:free",
      voice: "default",
      speed: 1.15,
      env: { OPENROUTER_API_KEY: "test-key" },
      fetchImpl: fetchMock,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(OPENROUTER_SPEECH_URL);
    expect(calls[0]!.body).toEqual({
      model: "heygen/heygen-voice-1-turbo:free",
      input: "Bienvenidos Aventureros",
      voice: "vincent",
      response_format: "pcm",
    });
    expect(result.modelUsed).toBe("heygen/heygen-voice-1-turbo:free");
    expect(result.fallbackUsed).toBe(false);
    expect(result.contentType).toBe("audio/wav");
    expect(result.audioBytes.byteLength).toBe(44 + pcmPayload.byteLength);
    expect(String.fromCharCode(...result.audioBytes.slice(0, 4))).toBe("RIFF");
  });

  it("resolves placeholder voice 'default' to the curated Fish Audio voice ID and preserves explicit voice IDs", async () => {
    const mp3Payload = new Uint8Array([0x49, 0x44, 0x33, 0x04]);
    const bodies: Array<Record<string, unknown>> = [];
    const fetchMock: typeof fetch = async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(mp3Payload, {
        status: 200,
        headers: { "Content-Type": "audio/mpeg" },
      });
    };

    await synthesizeSpeechWithOpenRouter({
      text: "La bruma se eleva.",
      modelId: "fish-audio/s2.1-pro-free:free",
      voice: "default",
      speed: 1.15,
      env: { OPENROUTER_API_KEY: "test-key" },
      fetchImpl: fetchMock,
    });

    await synthesizeSpeechWithOpenRouter({
      text: "Voz personalizada.",
      modelId: "fish-audio/s2.1-pro-free:free",
      voice: "802e3bc2b27e49c2995d23ef70e6ac89",
      speed: 0.9,
      env: { OPENROUTER_API_KEY: "test-key" },
      fetchImpl: fetchMock,
    });

    expect(bodies[0]).toEqual({
      model: "fish-audio/s2.1-pro-free:free",
      input: "La bruma se eleva.",
      voice: "872aed4c691c4cbb830649f8af64bd59",
      response_format: "mp3",
      speed: 1.15,
    });

    expect(bodies[1]).toEqual({
      model: "fish-audio/s2.1-pro-free:free",
      input: "Voz personalizada.",
      voice: "802e3bc2b27e49c2995d23ef70e6ac89",
      response_format: "mp3",
      speed: 0.9,
    });
  });

  it("falls back from HeyGen Voice Turbo to Fish Audio S2.1 Pro on 429", async () => {
    const mp3Payload = new Uint8Array([0x49, 0x44, 0x33, 0x04]);
    const modelsCalled: string[] = [];

    const fetchMock: typeof fetch = async (_input, init) => {
      const parsed = JSON.parse(String(init?.body)) as { model: string };
      modelsCalled.push(parsed.model);

      if (parsed.model === "heygen/heygen-voice-1-turbo:free") {
        return new Response(JSON.stringify({ error: "rate limited" }), {
          status: 429,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(mp3Payload, {
        status: 200,
        headers: { "Content-Type": "audio/mpeg" },
      });
    };

    const result = await synthesizeSpeechWithOpenRouter({
      text: "Tirá percepción",
      modelId: "heygen/heygen-voice-1-turbo:free",
      speed: 1.15,
      env: { OPENROUTER_API_KEY: "test-key" },
      fetchImpl: fetchMock,
    });

    expect(modelsCalled).toEqual([
      "heygen/heygen-voice-1-turbo:free",
      "fish-audio/s2.1-pro-free:free",
    ]);
    expect(result.fallbackUsed).toBe(true);
    expect(result.modelUsed).toBe("fish-audio/s2.1-pro-free:free");
    expect(result.contentType).toBe("audio/mpeg");
    expect(Array.from(result.audioBytes)).toEqual(Array.from(mp3Payload));
  });

  it("falls back in reverse from Fish Audio S2.1 Pro to HeyGen Voice Turbo on 429 and wraps octet-stream as WAV", async () => {
    const pcmPayload = new Uint8Array([1, 2, 3, 4]);
    const modelsCalled: string[] = [];

    const fetchMock: typeof fetch = async (_input, init) => {
      const parsed = JSON.parse(String(init?.body)) as { model: string };
      modelsCalled.push(parsed.model);

      if (parsed.model === "fish-audio/s2.1-pro-free:free") {
        return new Response(JSON.stringify({ error: "rate limited" }), {
          status: 429,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(pcmPayload, {
        status: 200,
        headers: { "Content-Type": "application/octet-stream" },
      });
    };

    const result = await synthesizeSpeechWithOpenRouter({
      text: "La taberna queda en silencio.",
      modelId: "fish-audio/s2.1-pro-free:free",
      env: { OPENROUTER_API_KEY: "test-key" },
      fetchImpl: fetchMock,
    });

    expect(modelsCalled).toEqual([
      "fish-audio/s2.1-pro-free:free",
      "heygen/heygen-voice-1-turbo:free",
    ]);
    expect(result.fallbackUsed).toBe(true);
    expect(result.modelUsed).toBe("heygen/heygen-voice-1-turbo:free");
    expect(result.contentType).toBe("audio/wav");
    expect(String.fromCharCode(...result.audioBytes.slice(0, 4))).toBe("RIFF");
  });

  it("throws RATE_LIMITED when fallback is disabled or both models return 429", async () => {
    const fetchMock: typeof fetch = vi.fn(
      async () =>
        new Response("too many requests", {
          status: 429,
        }),
    );

    await expect(
      synthesizeSpeechWithOpenRouter({
        text: "Prueba",
        fallbackOnRateLimit: false,
        env: { OPENROUTER_API_KEY: "test-key" },
        fetchImpl: fetchMock,
      }),
    ).rejects.toMatchObject({
      name: "TtsError",
      code: "RATE_LIMITED",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await expect(
      synthesizeSpeechWithOpenRouter({
        text: "Prueba",
        fallbackOnRateLimit: true,
        env: { OPENROUTER_API_KEY: "test-key" },
        fetchImpl: fetchMock,
      }),
    ).rejects.toMatchObject({
      name: "TtsError",
      code: "RATE_LIMITED",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("POST /api/tts", () => {
  const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (originalOpenRouterKey === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
    }
  });

  it("rejects guest requests with 403 AUTH_WHITELIST_REQUIRED", async () => {
    vi.spyOn(whitelistModule, "resolveRequestAccess").mockResolvedValue({
      authenticated: false,
      whitelisted: false,
      email: null,
      userId: null,
      tier: "guest",
      supabaseConfigured: true,
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const req = new Request("http://localhost:3000/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Hola mundo" }),
    });

    const res = await ttsPostRoute(req);
    expect(res.status).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(false);
    expect(body.code).toBe("AUTH_WHITELIST_REQUIRED");
  });

  it("streams binary audio with fallback headers for whitelisted requests", async () => {
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    vi.spyOn(whitelistModule, "resolveRequestAccess").mockResolvedValue({
      authenticated: true,
      whitelisted: true,
      email: "dm@example.com",
      userId: "user-123",
      tier: "whitelisted",
      supabaseConfigured: true,
    });
    vi.spyOn(console, "info").mockImplementation(() => {});

    const mp3Bytes = new Uint8Array([0x49, 0x44, 0x33, 0x03]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        const payload = JSON.parse(String(init?.body)) as { model: string };
        if (payload.model === "heygen/heygen-voice-1-turbo:free") {
          return new Response("busy", { status: 503 });
        }
        return new Response(mp3Bytes, {
          status: 200,
          headers: { "Content-Type": "audio/mpeg" },
        });
      }),
    );

    const req = new Request("http://localhost:3000/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "**La antorcha** titila en la oscuridad.",
        model: "heygen/heygen-voice-1-turbo:free",
        voice: "default",
        speed: 1.0,
      }),
    });

    const res = await ttsPostRoute(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-TTS-Model-Used")).toBe(
      "fish-audio/s2.1-pro-free:free",
    );
    expect(res.headers.get("X-TTS-Fallback")).toBe("1");

    const received = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(received)).toEqual(Array.from(mp3Bytes));
  });
});
