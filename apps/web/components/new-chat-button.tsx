import { RotateCcwIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

export function NewChatButton() {
  return (
    <Button
      variant="outline"
      size="sm"
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
