"use client"

import * as React from "react"
import { LockIcon } from "lucide-react"

import { type GatewayModel } from "@/lib/models"
import { usePlaySound } from "@/components/ui/sensory-ui/config/use-play-sound"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export function ModelSelect({
  models,
  value,
  onValueChange,
  lockedModelIds,
}: {
  models: GatewayModel[]
  value: string
  onValueChange: (value: string) => void
  lockedModelIds?: ReadonlySet<string>
}) {
  const { play } = usePlaySound({ sound: "interaction.toggle" })
  const items = React.useMemo(
    () => models.map((model) => ({ label: model.name, value: model.id })),
    [models]
  )

  return (
    <Select
      items={items}
      value={value}
      onValueChange={(next) => {
        if (typeof next === "string" && !lockedModelIds?.has(next)) {
          play()
          onValueChange(next)
        }
      }}
    >
      <SelectTrigger aria-label="Modelo LLM" className="bg-background">
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} className="min-w-60">
        <SelectGroup>
          {items.map((item) => {
            const locked = lockedModelIds?.has(item.value) ?? false
            return (
              <SelectItem key={item.value} value={item.value} disabled={locked}>
                <span className="flex flex-1 items-center justify-between gap-2">
                  <span className="truncate">{item.label}</span>
                  {locked && (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-none border border-amber-500/35 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-amber-700 dark:text-amber-300">
                      <LockIcon className="size-2.5" />
                      Whitelist
                    </span>
                  )}
                </span>
              </SelectItem>
            )
          })}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
