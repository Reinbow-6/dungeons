"use client";

import type { RulesetProfile } from "@dungeons/rules";
import {
  ChevronLeftIcon,
  PlusCircleIcon,
  ScrollTextIcon,
  SwordIcon,
  Trash2Icon,
} from "lucide-react";
import * as React from "react";

import { PartyBuilder } from "@/components/game/party-builder";
import { Button } from "@/components/ui/button";
import { useSensoryUI } from "@/components/ui/sensory-ui/config/provider";
import type { CharacterPresetInfo, PartyMemberSpec } from "@/lib/game/presets";
import type { CampaignSummary } from "@/lib/game/store";
import { cn } from "@/lib/utils";

const SCENE_SHORT_LABELS: Record<string, string> = {
  escena_01_orilla: "Orilla del Río",
  escena_02_batalla_orilla: "Escaramuza",
  escena_03_parlamento: "Parlamento",
  escena_04_campamento: "Campamento",
  escena_04b_reparar_porton: "Portón",
  escena_05_asalto_campamento: "Asalto",
  escena_06_comandante: "Mireia",
  escena_07_travesia_barcaza: "Barcaza",
  escena_08_otra_orilla: "Otra Orilla",
};

function formatRelativeDate(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 60_000) return "Ahora";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `Hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Hace ${hrs} h`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "Ayer";
  return `Hace ${days} d`;
}

export function CampaignSidebar({
  open,
  onClose,
  activeCampaignId,
  campaigns,
  loadingCampaigns = false,
  presets,
  onSelectCampaign,
  onNewCampaign,
  onDeleteCampaign,
  onDeleteAllCampaigns,
}: {
  open: boolean;
  onClose: () => void;
  activeCampaignId: string | null;
  campaigns: readonly CampaignSummary[];
  loadingCampaigns?: boolean;
  presets: readonly CharacterPresetInfo[];
  onSelectCampaign: (campaignId: string) => Promise<void>;
  onNewCampaign: (
    party: PartyMemberSpec[],
    mode: "digital" | "hybrid",
    ruleset: RulesetProfile,
  ) => Promise<string | null>;
  onDeleteCampaign: (campaignId: string) => Promise<void>;
  onDeleteAllCampaigns: () => Promise<void>;
}) {
  const { playSound } = useSensoryUI();
  const [showNewForm, setShowNewForm] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [loadingId, setLoadingId] = React.useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(
    null,
  );
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = React.useState(false);
  const [deletingAll, setDeletingAll] = React.useState(false);

  async function handleCreate(
    party: PartyMemberSpec[],
    mode: "digital" | "hybrid",
    ruleset: RulesetProfile,
  ) {
    setCreating(true);
    try {
      await onNewCampaign(party, mode, ruleset);
      playSound("notification.success");
      setShowNewForm(false);
    } finally {
      setCreating(false);
    }
  }

  async function handleSelect(id: string) {
    if (id === activeCampaignId || loadingId || deletingId || deletingAll) {
      if (typeof window !== "undefined" && window.innerWidth < 1024) {
        onClose();
      }
      return;
    }
    playSound("interaction.tap");
    setConfirmDeleteId(null);
    setConfirmDeleteAll(false);
    setLoadingId(id);
    try {
      await onSelectCampaign(id);
    } finally {
      setLoadingId(null);
    }
  }

  async function handleConfirmDelete(id: string) {
    if (deletingId || deletingAll) return;
    setDeletingId(id);
    try {
      await onDeleteCampaign(id);
      playSound("interaction.tap");
      setConfirmDeleteId(null);
    } finally {
      setDeletingId(null);
    }
  }

  async function handleConfirmDeleteAll() {
    if (deletingAll || deletingId) return;
    setDeletingAll(true);
    try {
      await onDeleteAllCampaigns();
      playSound("interaction.tap");
      setConfirmDeleteAll(false);
      setConfirmDeleteId(null);
    } finally {
      setDeletingAll(false);
    }
  }

  return (
    <>
      {open && (
        <div
          aria-hidden
          onClick={() => {
            playSound("overlay.close");
            onClose();
          }}
          className="fixed inset-0 z-30 bg-black/45 backdrop-blur-[2px] transition-opacity lg:hidden"
        />
      )}

      <aside
        id="campaign-list-sidebar"
        aria-label="Campañas y navegación"
        aria-hidden={!open}
        inert={!open || undefined}
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-72 max-w-[88vw] flex-col rounded-none bg-sidebar text-xs text-sidebar-foreground shadow-2xl transition-[transform,width] duration-200 ease-out lg:static lg:inset-auto lg:z-auto lg:h-full lg:max-w-none lg:shrink-0 lg:translate-x-0 lg:shadow-none",
          open
            ? "translate-x-0 border-r border-sidebar-border lg:w-64"
            : "pointer-events-none -translate-x-full border-r-0 lg:w-0 lg:overflow-hidden lg:border-r-0",
        )}
      >
        <div className="flex h-full min-h-0 w-full flex-col lg:w-64 lg:shrink-0">
          <div className="flex items-center justify-between border-b border-sidebar-border px-3 py-2.5">
            <div className="flex items-center gap-2">
              <SwordIcon className="size-4 text-primary" />
              <span className="font-serif text-sm font-semibold tracking-tight">
                Campañas
              </span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-7 rounded-none text-sidebar-foreground hover:bg-sidebar-accent"
              onClick={() => {
                playSound("overlay.close");
                onClose();
              }}
              title="Ocultar campañas (Alt+C)"
              aria-label="Ocultar barra de campañas"
            >
              <ChevronLeftIcon className="size-4" />
            </Button>
          </div>

          <div className="border-b border-sidebar-border p-2.5">
            <Button
              type="button"
              size="sm"
              className="w-full justify-start gap-2 rounded-none bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={() => {
                playSound("interaction.subtle");
                setShowNewForm((prev) => !prev);
              }}
            >
              <PlusCircleIcon className="size-4" />
              <span>{showNewForm ? "Cerrar formulario" : "Nueva campaña"}</span>
            </Button>
          </div>

          {showNewForm && (
            <div className="max-h-[54vh] overflow-y-auto rounded-none border-b border-sidebar-border bg-card/85 p-2.5">
              <PartyBuilder
                presets={presets}
                busy={creating}
                compact
                submitLabel="Crear campaña"
                onSubmit={handleCreate}
              />
            </div>
          )}

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center justify-between gap-2 border-b border-sidebar-border px-3 py-1.5">
              <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Campañas recientes
              </h3>
              {campaigns.length > 0 && !confirmDeleteAll && (
                <button
                  type="button"
                  disabled={deletingAll || Boolean(deletingId)}
                  onClick={() => {
                    playSound("interaction.subtle");
                    setConfirmDeleteId(null);
                    setConfirmDeleteAll(true);
                  }}
                  className="rounded-none text-[10px] font-medium text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
                >
                  Limpiar todo
                </button>
              )}
            </div>

            {confirmDeleteAll && campaigns.length > 0 && (
              <div className="flex items-center justify-between gap-2 border-b border-destructive/35 bg-destructive/10 px-3 py-1.5 text-[10.5px]">
                <span className="font-medium text-destructive">
                  ¿Borrar {campaigns.length}?
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    disabled={deletingAll}
                    onClick={() => void handleConfirmDeleteAll()}
                    className="rounded-none border border-destructive/45 bg-destructive/15 px-2 py-0.5 font-semibold text-destructive transition-colors hover:bg-destructive/25 disabled:opacity-50"
                  >
                    {deletingAll ? "…" : "Sí"}
                  </button>
                  <button
                    type="button"
                    disabled={deletingAll}
                    onClick={() => {
                      playSound("interaction.subtle");
                      setConfirmDeleteAll(false);
                    }}
                    className="rounded-none border border-border bg-background px-2 py-0.5 font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                  >
                    No
                  </button>
                </div>
              </div>
            )}

            <div className="flex-1 divide-y divide-sidebar-border/60 overflow-y-auto">
              {loadingCampaigns && campaigns.length === 0 ? (
                <p className="px-3 py-3 text-[11px] text-muted-foreground">
                  Cargando partidas…
                </p>
              ) : campaigns.length === 0 ? (
                <p className="px-3 py-3 text-[11px] text-muted-foreground">
                  Todavía no hay otras campañas guardadas.
                </p>
              ) : (
                campaigns.map((camp) => {
                  const isActive = camp.campaignId === activeCampaignId;
                  const sceneShort =
                    SCENE_SHORT_LABELS[camp.sceneId] ?? camp.sceneId;
                  const isConfirming = confirmDeleteId === camp.campaignId;
                  const isDeleting = deletingId === camp.campaignId;
                  const isOwner = camp.role === "owner";

                  if (isConfirming) {
                    return (
                      <div
                        key={camp.campaignId}
                        className={cn(
                          "flex w-full items-center justify-between gap-2 rounded-none border-l-2 bg-destructive/10 px-2.5 py-2 text-[11px]",
                          isActive ? "border-l-primary" : "border-l-destructive",
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-foreground">
                            {camp.title}
                          </span>
                          <span className="text-[10px] font-medium text-destructive">
                            ¿Borrar?
                          </span>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            disabled={isDeleting || deletingAll}
                            onClick={() =>
                              void handleConfirmDelete(camp.campaignId)
                            }
                            className="rounded-none border border-destructive/45 bg-destructive/15 px-2 py-0.5 text-[10.5px] font-semibold text-destructive transition-colors hover:bg-destructive/25 disabled:opacity-50"
                          >
                            {isDeleting ? "…" : "Sí"}
                          </button>
                          <button
                            type="button"
                            disabled={isDeleting}
                            onClick={() => {
                              playSound("interaction.subtle");
                              setConfirmDeleteId(null);
                            }}
                            className="rounded-none border border-border bg-background px-2 py-0.5 text-[10.5px] font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                          >
                            No
                          </button>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={camp.campaignId}
                      className={cn(
                        "group flex w-full items-stretch rounded-none border-l-2 transition-colors",
                        isActive
                          ? "border-l-primary bg-primary/10 text-foreground"
                          : "border-l-transparent text-sidebar-foreground hover:bg-sidebar-accent",
                      )}
                    >
                      <button
                        type="button"
                        disabled={loadingId === camp.campaignId || deletingAll}
                        onClick={() => void handleSelect(camp.campaignId)}
                        className="flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-none px-2.5 py-2 text-left"
                      >
                        <div className="flex w-full items-center gap-1.5">
                          <ScrollTextIcon
                            className={cn(
                              "size-3.5 shrink-0",
                              isActive
                                ? "text-primary"
                                : "text-muted-foreground",
                            )}
                          />
                          <span className="min-w-0 flex-1 truncate font-medium">
                            {camp.title}
                          </span>
                          <span className="shrink-0 font-mono text-[9.5px] text-muted-foreground">
                            #{camp.lastSeq}
                          </span>
                        </div>
                        <div className="flex w-full items-center justify-between pl-5 text-[10.5px] text-muted-foreground">
                          <span className="truncate">{sceneShort}</span>
                          <span>{formatRelativeDate(camp.updatedAt)}</span>
                        </div>
                      </button>

                      {isOwner && (
                        <button
                          type="button"
                          disabled={deletingAll || Boolean(deletingId)}
                          aria-label={`Borrar ${camp.title}`}
                          title="Borrar campaña"
                          onClick={() => {
                            playSound("interaction.subtle");
                            setConfirmDeleteAll(false);
                            setConfirmDeleteId(camp.campaignId);
                          }}
                          className="flex shrink-0 items-center justify-center rounded-none border-l border-sidebar-border/40 px-2 text-muted-foreground opacity-70 transition-colors hover:bg-destructive/10 hover:text-destructive hover:opacity-100 disabled:opacity-30"
                        >
                          <Trash2Icon className="size-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
