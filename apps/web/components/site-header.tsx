import { FlameIcon } from "lucide-react";
import Link from "next/link";

import { AuthButton } from "@/components/auth-dialog";
import { NewChatButton } from "@/components/new-chat-button";
import { SettingsPanel } from "@/components/settings-panel";
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
          Aguas Quietas
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
        <AuthButton className="max-w-[118px] px-2 sm:max-w-none sm:px-2.5" />
        <SettingsPanel />
        <SoundToggle />
        <ThemeToggle />
        <span
          title="Recargar mesa"
          className="inline-flex shrink-0 max-sm:[&_a]:w-7 max-sm:[&_a]:gap-0 max-sm:[&_a]:px-0 max-sm:[&_a]:has-data-[icon=inline-start]:pl-0 max-sm:[&_a]:text-[0px]"
        >
          <NewChatButton />
        </span>
      </div>
    </header>
  );
}
