"use client";

import * as React from "react";

export type VoiceRecorderPhase = "idle" | "recording" | "transcribing";

const PREFERRED_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
] as const;

function pickSupportedMimeType(): string {
  if (typeof MediaRecorder === "undefined") {
    return "";
  }
  for (const mime of PREFERRED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return "";
}

function getExtensionFromMime(mimeType: string): string {
  const lower = mimeType.toLowerCase();
  if (lower.includes("ogg")) return "ogg";
  if (lower.includes("mp4") || lower.includes("m4a")) return "m4a";
  if (lower.includes("wav")) return "wav";
  return "webm";
}

export interface UseVoiceRecorderResult {
  phase: VoiceRecorderPhase;
  elapsedSec: number;
  audioLevel: number;
  errorMsg: string | null;
  startRecording: () => Promise<void>;
  stopAndTranscribe: () => void;
  cancelRecording: () => void;
  clearError: () => void;
}

export function useVoiceRecorder(params: {
  onTranscript: (text: string) => void;
  maxDurationSec?: number;
}): UseVoiceRecorderResult {
  const maxDurationSec = params.maxDurationSec ?? 90;

  const [phase, setPhase] = React.useState<VoiceRecorderPhase>("idle");
  const [elapsedSec, setElapsedSec] = React.useState(0);
  const [audioLevel, setAudioLevel] = React.useState(0);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const onTranscriptRef = React.useRef(params.onTranscript);
  React.useEffect(() => {
    onTranscriptRef.current = params.onTranscript;
  }, [params.onTranscript]);

  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const rafRef = React.useRef<number | null>(null);
  const audioCtxRef = React.useRef<AudioContext | null>(null);
  const cancelledRef = React.useRef(false);

  const cleanupMedia = React.useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    setAudioLevel(0);
  }, []);

  React.useEffect(() => {
    return () => {
      cancelledRef.current = true;
      if (
        mediaRecorderRef.current &&
        mediaRecorderRef.current.state !== "inactive"
      ) {
        try {
          mediaRecorderRef.current.stop();
        } catch {
          // Ignore unmount stop errors
        }
      }
      cleanupMedia();
    };
  }, [cleanupMedia]);

  const uploadBlob = React.useCallback(async (blob: Blob, mimeType: string) => {
    setPhase("transcribing");
    try {
      const formData = new FormData();
      const ext = getExtensionFromMime(mimeType || blob.type);
      formData.append(
        "audio",
        new File([blob], `voice-turn.${ext}`, {
          type: mimeType || blob.type || "audio/webm",
        }),
      );
      formData.append("language", "es");

      const res = await fetch("/api/stt", {
        method: "POST",
        body: formData,
      });

      const data = (await res.json()) as {
        ok?: boolean;
        text?: string;
        empty?: boolean;
        error?: string;
      };

      if (!res.ok || !data.ok) {
        setErrorMsg(
          data.error ?? "No se pudo transcribir el audio. Intentá de nuevo.",
        );
        return;
      }

      if (data.empty || !data.text?.trim()) {
        setErrorMsg("No se detectó voz en el audio.");
        return;
      }

      onTranscriptRef.current(data.text.trim());
    } catch {
      setErrorMsg("Error de red al enviar el audio para transcripción.");
    } finally {
      setPhase("idle");
      setElapsedSec(0);
    }
  }, []);

  const stopAndTranscribe = React.useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      return;
    }
    cancelledRef.current = false;
    cleanupMedia();
    try {
      recorder.stop();
    } catch {
      setPhase("idle");
      setErrorMsg("No se pudo finalizar la grabación.");
    }
  }, [cleanupMedia]);

  const cancelRecording = React.useCallback(() => {
    cancelledRef.current = true;
    const recorder = mediaRecorderRef.current;
    chunksRef.current = [];
    cleanupMedia();
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        // Ignore
      }
    }
    setPhase("idle");
    setElapsedSec(0);
  }, [cleanupMedia]);

  const startRecording = React.useCallback(async () => {
    setErrorMsg(null);

    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setErrorMsg(
        "Tu navegador no soporta grabación de micrófono en este entorno.",
      );
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setErrorMsg(
        "No se pudo acceder al micrófono. Verificá los permisos del navegador.",
      );
      return;
    }

    cancelledRef.current = false;
    streamRef.current = stream;
    chunksRef.current = [];

    const mimeType = pickSupportedMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
    } catch {
      cleanupMedia();
      setErrorMsg("No se pudo inicializar el grabador de audio.");
      return;
    }

    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) {
        chunksRef.current.push(ev.data);
      }
    };

    recorder.onstop = () => {
      mediaRecorderRef.current = null;
      const wasCancelled = cancelledRef.current;
      const recordedChunks = chunksRef.current;
      chunksRef.current = [];
      cleanupMedia();

      if (wasCancelled) {
        setPhase("idle");
        setElapsedSec(0);
        return;
      }

      const finalMime = recorder.mimeType || mimeType || "audio/webm";
      const blob = new Blob(recordedChunks, { type: finalMime });
      if (blob.size < 100) {
        setPhase("idle");
        setElapsedSec(0);
        setErrorMsg("Grabación demasiado corta.");
        return;
      }

      void uploadBlob(blob, finalMime);
    };

    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (AudioCtx) {
        const audioCtx = new AudioCtx();
        audioCtxRef.current = audioCtx;
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 64;
        source.connect(analyser);
        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        const sampleLevel = () => {
          if (!audioCtxRef.current) return;
          analyser.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i += 1) {
            sum += dataArray[i] ?? 0;
          }
          const avg = dataArray.length > 0 ? sum / dataArray.length : 0;
          setAudioLevel(Math.min(1, avg / 96));
          rafRef.current = requestAnimationFrame(sampleLevel);
        };
        rafRef.current = requestAnimationFrame(sampleLevel);
      }
    } catch {
      // Visualizer is optional; recording continues cleanly
    }

    const startedMs = Date.now();
    setElapsedSec(0);
    setPhase("recording");
    recorder.start(250);

    timerRef.current = setInterval(() => {
      const sec = Math.floor((Date.now() - startedMs) / 1000);
      setElapsedSec(sec);
      if (sec >= maxDurationSec) {
        stopAndTranscribe();
      }
    }, 1000);
  }, [cleanupMedia, maxDurationSec, stopAndTranscribe, uploadBlob]);

  const clearError = React.useCallback(() => {
    setErrorMsg(null);
  }, []);

  return {
    phase,
    elapsedSec,
    audioLevel,
    errorMsg,
    startRecording,
    stopAndTranscribe,
    cancelRecording,
    clearError,
  };
}
