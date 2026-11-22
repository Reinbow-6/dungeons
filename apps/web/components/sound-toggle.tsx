"use client";

import { Volume2Icon, VolumeXIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useSensoryUI } from "@/components/ui/sensory-ui/config/provider";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function SoundToggle() {
  const { muted, setMuted, playSound, reducedMotion } = useSensoryUI();

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
            aria-label={label}
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
        {reducedMotion
          ? "Sonidos atenuados por preferencia de movimiento reducido del sistema"
          : `${label} · Pack Crisp`}
      </TooltipContent>
    </Tooltip>
  );
}
