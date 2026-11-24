import { FlameIcon } from "lucide-react";
import Link from "next/link";

import { AuthButton } from "@/components/auth-dialog";
import { SoundToggle } from "@/components/sound-toggle";
import { ThemeToggle } from "@/components/theme-toggle";

export function SiteHeader() {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-1.5 border-b border-border/50 bg-background/85 px-2.5 backdrop-blur-md sm:gap-2 sm:px-4 lg:px-6">
      <div className="flex min-w-0 shrink items-center gap-2">
        <Link
          href="/"
          className="flex min-w-0 items-center gap-1.5 transition-opacity hover:opacity-85 sm:gap-2"
        >
          <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-md border border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <FlameIcon className="size-3.5" />
          </span>
          <span className="truncate font-serif text-base font-semibold tracking-tight text-foreground sm:text-lg">
            Dungeons
          </span>
        </Link>
        <span className="hidden text-muted-foreground/40 sm:inline">·</span>
        <span className="hidden truncate font-serif text-sm italic text-muted-foreground sm:inline">
          Aguas Inquietas
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
        <AuthButton className="max-w-[94px] px-2 sm:max-w-none sm:px-2.5" />
        <div
          role="group"
          aria-label="Preferencias rápidas"
          className="inline-flex items-center gap-0.5 rounded-lg border border-border/60 bg-muted/25 p-0.5"
        >
          <SoundToggle />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
