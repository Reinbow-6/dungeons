"use client";

import * as React from "react";

import {
  DEFAULT_TTS_MODEL,
  findTtsModelOption,
  type TtsModelId,
} from "@/lib/tts-models";

export interface TtsSpeakRequest {
  id: string;
  text: string;
  model?: TtsModelId | string;
  voice?: string;
  speed?: number;
}

export interface UseTtsPlayerDefaults {
  model?: TtsModelId | string;
  voice?: string;
  speed?: number;
}

export interface UseTtsPlayerResult {
  playingId: string | null;
  loadingId: string | null;
  error: string | null;
  speak: (request: TtsSpeakRequest) => Promise<void>;
  stop: () => void;
  clearError: () => void;
}

export function useTtsPlayer(
  defaults?: UseTtsPlayerDefaults,
): UseTtsPlayerResult {
  const [playingId, setPlayingId] = React.useState<string | null>(null);
  const [loadingId, setLoadingId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = React.useRef<string | null>(null);
  const abortControllerRef = React.useRef<AbortController | null>(null);
  const requestSeqRef = React.useRef(0);

  const defaultModel = defaults?.model ?? DEFAULT_TTS_MODEL;
  const defaultVoice = defaults?.voice ?? "default";
  const defaultSpeed = defaults?.speed ?? 1.0;

  const revokeObjectUrl = React.useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  const teardownMedia = React.useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    const audio = audioRef.current;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      if (typeof audio.removeAttribute === "function") {
        audio.removeAttribute("src");
      }
      if (typeof audio.load === "function") {
        audio.load();
      }
    }
    revokeObjectUrl();
  }, [revokeObjectUrl]);

  const stop = React.useCallback(() => {
    requestSeqRef.current += 1;
    teardownMedia();
    setLoadingId(null);
    setPlayingId(null);
  }, [teardownMedia]);

  const clearError = React.useCallback(() => {
    setError(null);
  }, []);

  const speak = React.useCallback(
    async (request: TtsSpeakRequest): Promise<void> => {
      const cleanText = request.text.trim();
      if (!cleanText) {
        return;
      }

      requestSeqRef.current += 1;
      const seq = requestSeqRef.current;

      teardownMedia();
      setError(null);
      setPlayingId(null);
      setLoadingId(request.id);

      const controller = new AbortController();
      abortControllerRef.current = controller;

      const requestedSpeed = request.speed ?? defaultSpeed;

      try {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: cleanText,
            model: request.model ?? defaultModel,
            voice: request.voice ?? defaultVoice,
            speed: requestedSpeed,
          }),
          signal: controller.signal,
        });

        if (seq !== requestSeqRef.current || controller.signal.aborted) {
          return;
        }

        if (!res.ok) {
          let message =
            res.status === 403
              ? "Iniciá sesión con una cuenta autorizada (whitelist) para usar voz."
              : "No se pudo generar el audio de la narración.";
          try {
            const payload = (await res.json()) as { error?: string };
            if (typeof payload.error === "string" && payload.error.trim()) {
              message = payload.error;
            }
          } catch {
            // Keep default localized error message if body isn't JSON
          }
          setLoadingId(null);
          setPlayingId(null);
          setError(message);
          return;
        }

        const blob = await res.blob();
        if (seq !== requestSeqRef.current || controller.signal.aborted) {
          return;
        }

        if (blob.size === 0) {
          setLoadingId(null);
          setPlayingId(null);
          setError("El servidor devolvió un archivo de audio vacío.");
          return;
        }

        const objectUrl = URL.createObjectURL(blob);
        if (seq !== requestSeqRef.current || controller.signal.aborted) {
          URL.revokeObjectURL(objectUrl);
          return;
        }

        revokeObjectUrl();
        objectUrlRef.current = objectUrl;

        if (!audioRef.current) {
          audioRef.current = new Audio();
        }
        const audio = audioRef.current;

        audio.onended = () => {
          if (seq !== requestSeqRef.current) {
            return;
          }
          revokeObjectUrl();
          setPlayingId(null);
        };

        audio.onerror = () => {
          if (seq !== requestSeqRef.current) {
            return;
          }
          revokeObjectUrl();
          setLoadingId(null);
          setPlayingId(null);
          setError("No se pudo reproducir el audio generado.");
        };

        const usedModelHeader = res.headers.get("x-tts-model-used");
        const usedModelOption = usedModelHeader
          ? findTtsModelOption(usedModelHeader)
          : undefined;
        const applyClientPlaybackRate =
          usedModelOption !== undefined && !usedModelOption.supportsSpeed;

        audio.src = objectUrl;
        audio.playbackRate = applyClientPlaybackRate
          ? Math.min(2.0, Math.max(0.5, requestedSpeed))
          : 1;

        await audio.play();
        if (seq !== requestSeqRef.current || controller.signal.aborted) {
          return;
        }

        setLoadingId(null);
        setPlayingId(request.id);
      } catch (err) {
        if (
          controller.signal.aborted ||
          (err instanceof DOMException && err.name === "AbortError")
        ) {
          return;
        }
        if (seq !== requestSeqRef.current) {
          return;
        }

        revokeObjectUrl();
        setLoadingId(null);
        setPlayingId(null);

        if (err instanceof DOMException && err.name === "NotAllowedError") {
          setError(
            "El navegador bloqueó la reproducción automática. Tocá el botón de audio para escuchar.",
          );
          return;
        }

        setError("Error de red o audio al reproducir la narración.");
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    },
    [defaultModel, defaultSpeed, defaultVoice, revokeObjectUrl, teardownMedia],
  );

  React.useEffect(() => {
    return () => {
      requestSeqRef.current += 1;
      teardownMedia();
    };
  }, [teardownMedia]);

  return {
    playingId,
    loadingId,
    error,
    speak,
    stop,
    clearError,
  };
}
