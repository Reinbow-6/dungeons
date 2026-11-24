"use client";

import * as React from "react";
import { Volume2Icon, VolumeXIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { useSensoryUI } from "@/components/ui/sensory-ui/config/provider";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function SoundToggle() {
  const { muted, setMuted, playSound, reducedMotion } = useSensoryUI();

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.key.toLowerCase() !== "d"
      ) {
        return;
      }

      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT")
      ) {
        return;
      }

      setMuted(!muted);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [muted, setMuted]);

  function handleToggle() {
    const nextMuted = !muted;
    setMuted(nextMuted);
    if (!nextMuted) {
      void playSound("interaction.toggle");
    }
  }

  const label = muted
    ? "Activar efectos de sonido (Crisp)"
    : "Silenciar efectos de sonido";

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`${label} (D)`}
            aria-pressed={!muted}
            onClick={handleToggle}
          >
            {muted ? (
              <VolumeXIcon className="size-4 text-muted-foreground" />
            ) : (
              <Volume2Icon className="size-4 text-amber-600 dark:text-amber-400" />
            )}
          </Button>
        }
      />
      <TooltipContent>
        {reducedMotion ? (
          "Sonidos atenuados por preferencia de movimiento reducido del sistema"
        ) : (
          <>
            {label} · Pack Crisp <Kbd>D</Kbd>
          </>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
