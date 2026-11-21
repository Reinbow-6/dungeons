import { DicesIcon } from "lucide-react";
import Link from "next/link";

import { NewChatButton } from "@/components/new-chat-button";
import { ThemeToggle } from "@/components/theme-toggle";

export function SiteHeader() {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border/80 bg-background/85 px-4 backdrop-blur-md lg:px-6">
      <div className="flex min-w-0 items-center gap-2.5">
        <Link
          href="/"
          className="flex items-center gap-2 text-sm font-semibold tracking-tight text-foreground transition-opacity hover:opacity-85"
        >
          <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-indigo-500/15 text-indigo-400 ring-1 ring-indigo-500/25">
            <DicesIcon className="size-3.5" />
          </span>
          <span>Dungeons</span>
        </Link>
        <span className="text-muted-foreground/50">/</span>
        <span className="truncate text-xs font-medium text-muted-foreground">
          Aguas Quietas
        </span>
        <span className="hidden rounded border border-border/80 bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground sm:inline-flex">
          5e-lite
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <ThemeToggle />
        <NewChatButton />
      </div>
    </header>
  );
}
