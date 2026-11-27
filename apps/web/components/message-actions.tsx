"use client"

import * as React from "react"
import {
  CheckIcon,
  CopyIcon,
  HistoryIcon,
  Loader2Icon,
  RefreshCcwIcon,
  SquareIcon,
  Volume2Icon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { MessageFooter } from "@/components/ui/message"
import { useSensoryUI } from "@/components/ui/sensory-ui/config/provider"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export function MessageActions({
  text,
  onRetry,
  ttsAvailable = false,
  isSpeaking = false,
  isLoadingAudio = false,
  onSpeak,
  onStopAudio,
  checkpointSeq = null,
  isRollingBack = false,
  onRollback,
}: {
  text: string
  onRetry?: () => void
  ttsAvailable?: boolean
  isSpeaking?: boolean
  isLoadingAudio?: boolean
  onSpeak?: () => void
  onStopAudio?: () => void
  checkpointSeq?: number | null
  isRollingBack?: boolean
  onRollback?: (seq: number) => void
}) {
  const [copied, setCopied] = React.useState(false)
  const { playSound } = useSensoryUI()

  React.useEffect(() => {
    if (!copied) {
      return
    }

    const timeout = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timeout)
  }, [copied])

  const audioActive = isSpeaking || isLoadingAudio
  const audioLabel = audioActive ? "Detener audio" : "Escuchar respuesta"

  return (
    <MessageFooter className="px-0">
      <MessageAction
        label={copied ? "Copiado" : "Copiar mensaje"}
        onClick={() => {
          navigator.clipboard
            .writeText(text)
            .then(() => {
              setCopied(true)
              void playSound("notification.success")
            })
            .catch(() => {})
        }}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </MessageAction>
      {ttsAvailable && (
        <MessageAction
          label={audioLabel}
          aria-pressed={audioActive}
          aria-busy={isLoadingAudio}
          onClick={() => {
            void playSound("interaction.subtle")
            if (audioActive) {
              onStopAudio?.()
            } else {
              onSpeak?.()
            }
          }}
        >
          {isLoadingAudio ? (
            <Loader2Icon className="animate-spin text-amber-600 dark:text-amber-400" />
          ) : isSpeaking ? (
            <SquareIcon className="fill-current text-amber-600 dark:text-amber-400" />
          ) : (
            <Volume2Icon />
          )}
        </MessageAction>
      )}
      {onRetry && (
        <MessageAction
          label="Reintentar respuesta"
          onClick={() => {
            void playSound("interaction.tap")
            onRetry()
          }}
        >
          <RefreshCcwIcon />
        </MessageAction>
      )}
      {typeof checkpointSeq === "number" && onRollback && (
        <MessageAction
          label={`Restaurar punto #${checkpointSeq}`}
          disabled={isRollingBack}
          onClick={() => {
            void playSound("navigation.backward")
            onRollback(checkpointSeq)
          }}
        >
          <HistoryIcon />
        </MessageAction>
      )}
    </MessageFooter>
  )
}

function MessageAction({
  label,
  children,
  className,
  ...props
}: React.ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            className={cn("rounded-none", className)}
            {...props}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent className="rounded-none">
        <p>{label}</p>
      </TooltipContent>
    </Tooltip>
  )
}
