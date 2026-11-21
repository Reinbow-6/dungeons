import { describe, expect, it, vi } from "vitest";
import {
  STT_DEFAULT_LANGUAGE,
  STT_MAX_AUDIO_BYTES,
  STT_MIN_AUDIO_BYTES,
  STT_MODEL_ID,
  SttError,
  normalizeAudioMediaType,
  transcribeAudioWithGroq,
} from "../lib/ai/stt";

describe("normalizeAudioMediaType", () => {
  it("strips codec parameters for webm, ogg, mp4, and wav", () => {
    expect(normalizeAudioMediaType("audio/webm;codecs=opus")).toEqual({
      mimeType: "audio/webm",
      extension: "webm",
    });
    expect(normalizeAudioMediaType("audio/ogg; codecs=opus")).toEqual({
      mimeType: "audio/ogg",
      extension: "ogg",
    });
    expect(normalizeAudioMediaType("audio/mp4")).toEqual({
      mimeType: "audio/mp4",
      extension: "m4a",
    });
    expect(normalizeAudioMediaType("audio/wav")).toEqual({
      mimeType: "audio/wav",
      extension: "wav",
    });
  });

  it("falls back to file extension when MIME is empty or application/octet-stream", () => {
    expect(normalizeAudioMediaType("", "grabacion.webm")).toEqual({
      mimeType: "audio/webm",
      extension: "webm",
    });
    expect(
      normalizeAudioMediaType("application/octet-stream", "nota.m4a"),
    ).toEqual({
      mimeType: "audio/mp4",
      extension: "m4a",
    });
    expect(normalizeAudioMediaType(undefined, "clip.WAV")).toEqual({
      mimeType: "audio/wav",
      extension: "wav",
    });
  });

  it("rejects non-audio MIME types and unsupported extensions", () => {
    expect(normalizeAudioMediaType("application/pdf", "doc.pdf")).toBeNull();
    expect(normalizeAudioMediaType("text/plain", "notes.txt")).toBeNull();
    expect(
      normalizeAudioMediaType("application/octet-stream", "archive.zip"),
    ).toBeNull();
    expect(normalizeAudioMediaType("", "sin-extension")).toBeNull();
  });
});

describe("transcribeAudioWithGroq", () => {
  it("throws MISSING_API_KEY when no key is provided or set in env", async () => {
    const previousKey = process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEY;
    try {
      await expect(
        transcribeAudioWithGroq({
          audioBytes: new Uint8Array(256),
          mimeType: "audio/webm",
          apiKey: "",
        }),
      ).rejects.toMatchObject({
        name: "SttError",
        code: "MISSING_API_KEY",
      });
    } finally {
      if (previousKey !== undefined) {
        process.env.GROQ_API_KEY = previousKey;
      }
    }
  });

  it("throws AUDIO_TOO_SHORT when audio buffer is below minimum bytes", async () => {
    await expect(
      transcribeAudioWithGroq({
        audioBytes: new Uint8Array(STT_MIN_AUDIO_BYTES - 1),
        mimeType: "audio/webm",
        apiKey: "gsk_test_key",
      }),
    ).rejects.toMatchObject({
      name: "SttError",
      code: "AUDIO_TOO_SHORT",
    });
  });

  it("throws AUDIO_TOO_LARGE when audio buffer exceeds maximum bytes", async () => {
    await expect(
      transcribeAudioWithGroq({
        audioBytes: new Uint8Array(STT_MAX_AUDIO_BYTES + 1),
        mimeType: "audio/webm",
        apiKey: "gsk_test_key",
      }),
    ).rejects.toMatchObject({
      name: "SttError",
      code: "AUDIO_TOO_LARGE",
    });
  });

  it("throws UNSUPPORTED_MEDIA_TYPE for unsupported MIME or extension", async () => {
    await expect(
      transcribeAudioWithGroq({
        audioBytes: new Uint8Array(256),
        mimeType: "application/pdf",
        fileName: "script.pdf",
        apiKey: "gsk_test_key",
      }),
    ).rejects.toMatchObject({
      name: "SttError",
      code: "UNSUPPORTED_MEDIA_TYPE",
    });
  });

  it("throws PROVIDER_UNAVAILABLE on upstream HTTP 500 without leaking secrets or raw body", async () => {
    const secret = "gsk_super_secret_should_never_leak";
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(`upstream error ${secret}`, {
        status: 500,
        statusText: "Internal Server Error",
      }),
    );

    let caught: unknown;
    try {
      await transcribeAudioWithGroq({
        audioBytes: new Uint8Array(256),
        mimeType: "audio/webm;codecs=opus",
        apiKey: secret,
        fetchImpl: fetchMock,
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(SttError);
    expect((caught as SttError).code).toBe("PROVIDER_UNAVAILABLE");
    expect((caught as SttError).message).not.toContain(secret);
    expect((caught as SttError).message).not.toContain("upstream error");
  });

  it("throws PROVIDER_UNAVAILABLE when fetch rejects", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      transcribeAudioWithGroq({
        audioBytes: new Uint8Array(256),
        mimeType: "audio/ogg;codecs=opus",
        apiKey: "gsk_test_key",
        fetchImpl: fetchMock,
      }),
    ).rejects.toMatchObject({
      name: "SttError",
      code: "PROVIDER_UNAVAILABLE",
    });
  });

  it("throws EMPTY_TRANSCRIPT when Groq returns blank text", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ text: "   \n  " }, { status: 200 }));

    await expect(
      transcribeAudioWithGroq({
        audioBytes: new Uint8Array(256),
        mimeType: "audio/wav",
        apiKey: "gsk_test_key",
        fetchImpl: fetchMock,
      }),
    ).rejects.toMatchObject({
      name: "SttError",
      code: "EMPTY_TRANSCRIPT",
    });
  });

  it("posts FormData to Groq Whisper Turbo and returns normalized transcript", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;

    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      capturedInit = init;
      return Response.json(
        { text: "  Investigo la estatua de piedra con sigilo.  " },
        { status: 200 },
      );
    });

    const result = await transcribeAudioWithGroq({
      audioBytes: new Uint8Array(512),
      mimeType: "audio/webm;codecs=opus",
      apiKey: "gsk_test_123",
      fetchImpl: fetchMock,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(capturedUrl).toBe(
      "https://api.groq.com/openai/v1/audio/transcriptions",
    );
    expect(capturedInit?.method).toBe("POST");
    expect(capturedInit?.headers).toEqual({
      Authorization: "Bearer gsk_test_123",
    });

    const formData = capturedInit?.body;
    expect(formData).toBeInstanceOf(FormData);
    const fd = formData as FormData;
    expect(fd.get("model")).toBe(STT_MODEL_ID);
    expect(fd.get("language")).toBe(STT_DEFAULT_LANGUAGE);
    expect(fd.get("response_format")).toBe("json");

    const file = fd.get("file");
    expect(file).toBeInstanceOf(File);
    expect((file as File).name).toBe("audio.webm");
    expect((file as File).type).toBe("audio/webm");

    expect(result).toEqual({
      text: "Investigo la estatua de piedra con sigilo.",
      modelId: STT_MODEL_ID,
      language: STT_DEFAULT_LANGUAGE,
      durationMs: expect.any(Number),
    });
  });
});
