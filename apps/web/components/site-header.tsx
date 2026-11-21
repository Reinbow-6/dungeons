import { FlameIcon } from "lucide-react";
import Link from "next/link";

import { NewChatButton } from "@/components/new-chat-button";
import { ThemeToggle } from "@/components/theme-toggle";

export function SiteHeader() {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border/50 bg-background/85 px-4 backdrop-blur-md lg:px-6">
      <div className="flex min-w-0 items-center gap-2.5">
        <Link
          href="/"
          className="flex items-center gap-2 transition-opacity hover:opacity-85"
        >
          <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-md border border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <FlameIcon className="size-3.5" />
          </span>
          <span className="font-serif text-lg font-semibold tracking-tight text-foreground">
            Dungeons
          </span>
        </Link>
        <span className="text-muted-foreground/40">·</span>
        <span className="truncate font-serif text-sm italic text-muted-foreground">
          Aguas Quietas
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <ThemeToggle />
        <NewChatButton />
      </div>
    </header>
  );
}
