import { RotateCcwIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

export function NewChatButton() {
  return (
    <Button
      variant="outline"
      size="sm"
      aria-label="Recargar mesa"
      title="Recargar mesa"
      className="max-sm:size-8 max-sm:gap-0 max-sm:px-0 max-sm:text-[0px]"
      render={
        // eslint-disable-next-line @next/next/no-html-link-for-pages
        <a href="/" />
      }
      nativeButton={false}
    >
      <RotateCcwIcon data-icon="inline-start" className="size-3.5" />
      Recargar mesa
    </Button>
  );
}
