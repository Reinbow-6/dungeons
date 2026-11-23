"use client";

import * as React from "react";

import type { StreamSpeed } from "@/lib/settings/app-settings";

const CHARS_PER_SECOND: Record<Exclude<StreamSpeed, "instant">, number> = {
  slow: 48,
  normal: 82,
  fast: 165,
};

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Smooths bursty LLM token chunks into a comfortable narrative reading cadence.
 * Historical messages mounted with `isStreaming === false` render immediately.
 */
export function useSmoothText(
  text: string,
  isStreaming: boolean,
  speed: StreamSpeed = "normal",
): string {
  const [smoothingActive, setSmoothingActive] = React.useState<boolean>(
    () => isStreaming && speed !== "instant" && !prefersReducedMotion(),
  );
  const [revealedLength, setRevealedLength] = React.useState<number>(() =>
    isStreaming && speed !== "instant" && !prefersReducedMotion()
      ? 0
      : text.length,
  );

  const floatPosRef = React.useRef<number>(revealedLength);
  const targetTextRef = React.useRef<string>(text);

  React.useEffect(() => {
    targetTextRef.current = text;

    if (speed === "instant" || prefersReducedMotion()) {
      floatPosRef.current = text.length;
      return;
    }

    if (!smoothingActive && !isStreaming) {
      floatPosRef.current = text.length;
      return;
    }

    if (floatPosRef.current > text.length) {
      floatPosRef.current = text.length;
    }

    const baseRate = CHARS_PER_SECOND[speed];
    let rafId = 0;
    let lastTime = performance.now();
    let lastCommitted = Math.floor(floatPosRef.current);

    const tick = (now: number) => {
      if (isStreaming && !smoothingActive) {
        setSmoothingActive(true);
      }

      const targetLen = targetTextRef.current.length;
      const dt = Math.min(0.1, Math.max(0, (now - lastTime) / 1000));
      lastTime = now;

      const remaining = targetLen - floatPosRef.current;
      if (remaining <= 0) {
        if (lastCommitted !== targetLen) {
          lastCommitted = targetLen;
          setRevealedLength(targetLen);
        }
        return;
      }

      // Gently accelerate when network chunks get far ahead so long scenes stay responsive.
      const catchupBoost = remaining > 420 ? (remaining - 420) * 0.6 : 0;
      floatPosRef.current = Math.min(
        targetLen,
        floatPosRef.current + (baseRate + catchupBoost) * dt,
      );

      const nextLen = Math.floor(floatPosRef.current);
      if (nextLen !== lastCommitted) {
        lastCommitted = nextLen;
        setRevealedLength(nextLen);
      }

      if (floatPosRef.current < targetLen) {
        rafId = window.requestAnimationFrame(tick);
      }
    };

    if (floatPosRef.current < text.length || (isStreaming && !smoothingActive)) {
      rafId = window.requestAnimationFrame(tick);
    }

    return () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [text, isStreaming, speed, smoothingActive]);

  if (!smoothingActive || speed === "instant") {
    return text;
  }

  return text.slice(0, Math.min(text.length, revealedLength));
}
