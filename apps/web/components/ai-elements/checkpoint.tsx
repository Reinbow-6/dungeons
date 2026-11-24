"use client";

import { Separator } from "@base-ui/react/separator";
import { BookmarkIcon } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function Checkpoint({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="checkpoint"
      className={cn(
        "flex items-center gap-2 overflow-hidden text-muted-foreground",
        className,
      )}
      {...props}
    >
      {children}
      <Separator className="h-px flex-1 bg-border/65" />
    </div>
  );
}

export function CheckpointIcon({
  className,
  children,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="checkpoint-icon"
      className={cn("inline-flex shrink-0 items-center", className)}
      {...props}
    >
      {children ?? <BookmarkIcon className="size-3.5 shrink-0" />}
    </span>
  );
}

export function CheckpointTrigger({
  className,
  children,
  variant = "ghost",
  size = "xs",
  tooltip,
  ...props
}: React.ComponentProps<typeof Button> & { tooltip?: string }) {
  const triggerButton = (
    <Button
      type="button"
      size={size}
      variant={variant}
      className={cn(
        "h-6 rounded-md px-2 text-[11px] font-medium text-muted-foreground hover:text-foreground",
        className,
      )}
      {...props}
    >
      {children ?? "Restaurar punto"}
    </Button>
  );

  if (!tooltip) {
    return triggerButton;
  }

  return (
    <Tooltip>
      <TooltipTrigger render={triggerButton} />
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
