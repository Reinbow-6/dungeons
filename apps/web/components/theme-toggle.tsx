"use client";

import { MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { usePlaySound } from "@/components/ui/sensory-ui/config/use-play-sound";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const { play } = usePlaySound({ sound: "interaction.toggle" });

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Cambiar tema (N)"
            onClick={() => {
              play();
              setTheme(resolvedTheme === "dark" ? "light" : "dark");
            }}
          >
            <SunIcon className="hidden size-4 dark:block" />
            <MoonIcon className="block size-4 dark:hidden" />
          </Button>
        }
      />
      <TooltipContent>
        Cambiar tema <Kbd>N</Kbd>
      </TooltipContent>
    </Tooltip>
  );
}
