"use client";

import {
  FlameIcon,
  KeyRoundIcon,
  LogOutIcon,
  MailIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  SparklesIcon,
  UserIcon,
  XIcon,
} from "lucide-react";
import * as React from "react";
import { createPortal } from "react-dom";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSensoryUI } from "@/components/ui/sensory-ui/config/provider";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { AccessTier, RequestAccess } from "@/lib/auth/whitelist";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export const OPEN_AUTH_EVENT = "dungeons:open-auth";
export const AUTH_CHANGED_EVENT = "dungeons:auth-changed";

export interface AuthAccessState extends RequestAccess {
  loading: boolean;
}

export type UseAuthAccessResult = AuthAccessState & {
  refresh: () => Promise<void>;
};

const SERVER_AUTH_SNAPSHOT: AuthAccessState = {
  authenticated: false,
  whitelisted: false,
  email: null,
  userId: null,
  tier: "guest",
  supabaseConfigured: false,
  loading: true,
};

let authSnapshot: AuthAccessState = SERVER_AUTH_SNAPSHOT;
let hasInitializedAuthFetch = false;
let authFetchSeq = 0;
let inFlightAuthFetch: Promise<void> | null = null;
const authListeners = new Set<() => void>();
let detachAuthExternalListeners: (() => void) | null = null;

function notifyAuthListeners() {
  for (const listener of authListeners) {
    listener();
  }
}

function setAuthSnapshot(next: AuthAccessState) {
  if (
    authSnapshot.authenticated === next.authenticated &&
    authSnapshot.whitelisted === next.whitelisted &&
    authSnapshot.email === next.email &&
    authSnapshot.userId === next.userId &&
    authSnapshot.tier === next.tier &&
    authSnapshot.supabaseConfigured === next.supabaseConfigured &&
    authSnapshot.loading === next.loading
  ) {
    return;
  }
  authSnapshot = next;
  notifyAuthListeners();
}

function parseTier(raw: unknown): AccessTier {
  return raw === "whitelisted" ? "whitelisted" : "guest";
}

async function fetchAuthStatus(force = false): Promise<void> {
  if (typeof window === "undefined") {
    return;
  }
  if (inFlightAuthFetch && !force) {
    return inFlightAuthFetch;
  }

  const mySeq = ++authFetchSeq;
  if (!authSnapshot.loading) {
    setAuthSnapshot({ ...authSnapshot, loading: true });
  }

  const run = (async () => {
    try {
      const response = await fetch("/api/auth/status", {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = (await response.json()) as Partial<RequestAccess>;
      if (mySeq !== authFetchSeq) {
        return;
      }
      setAuthSnapshot({
        authenticated: Boolean(data.authenticated),
        whitelisted: Boolean(data.whitelisted),
        email: typeof data.email === "string" ? data.email : null,
        userId: typeof data.userId === "string" ? data.userId : null,
        tier: parseTier(data.tier),
        supabaseConfigured: Boolean(data.supabaseConfigured),
        loading: false,
      });
    } catch {
      if (mySeq !== authFetchSeq) {
        return;
      }
      setAuthSnapshot({
        ...authSnapshot,
        loading: false,
      });
    } finally {
      if (mySeq === authFetchSeq) {
        inFlightAuthFetch = null;
      }
    }
  })();

  inFlightAuthFetch = run;
  return run;
}

export async function refreshAuthAccess(): Promise<void> {
  hasInitializedAuthFetch = true;
  await fetchAuthStatus(true);
}

function attachExternalAuthListeners() {
  if (typeof window === "undefined" || detachAuthExternalListeners) {
    return;
  }

  const onAuthChanged = () => {
    void refreshAuthAccess();
  };
  window.addEventListener(AUTH_CHANGED_EVENT, onAuthChanged);

  let unsubscribeSupabase: (() => void) | null = null;
  const supabase = createSupabaseBrowserClient();
  if (supabase) {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (
        event === "SIGNED_IN" ||
        event === "SIGNED_OUT" ||
        event === "TOKEN_REFRESHED" ||
        event === "USER_UPDATED"
      ) {
        void refreshAuthAccess();
      }
    });
    unsubscribeSupabase = () => {
      data.subscription.unsubscribe();
    };
  }

  detachAuthExternalListeners = () => {
    window.removeEventListener(AUTH_CHANGED_EVENT, onAuthChanged);
    unsubscribeSupabase?.();
    detachAuthExternalListeners = null;
  };
}

function subscribeAuthStore(listener: () => void): () => void {
  authListeners.add(listener);
  attachExternalAuthListeners();
  return () => {
    authListeners.delete(listener);
    if (authListeners.size === 0) {
      detachAuthExternalListeners?.();
    }
  };
}

function getAuthSnapshot(): AuthAccessState {
  return authSnapshot;
}

function getServerAuthSnapshot(): AuthAccessState {
  return SERVER_AUTH_SNAPSHOT;
}

export function useAuthAccess(): UseAuthAccessResult {
  const snapshot = React.useSyncExternalStore(
    subscribeAuthStore,
    getAuthSnapshot,
    getServerAuthSnapshot,
  );

  React.useEffect(() => {
    if (!hasInitializedAuthFetch) {
      hasInitializedAuthFetch = true;
      void fetchAuthStatus(false);
    }
  }, []);

  const refresh = React.useCallback(async () => {
    await refreshAuthAccess();
  }, []);

  return React.useMemo(
    () => ({
      ...snapshot,
      refresh,
    }),
    [snapshot, refresh],
  );
}

// ---------------------------------------------------------------------------
// Shared uncontrolled dialog store (prevents duplicate modals across mounts)
// ---------------------------------------------------------------------------

interface DialogStoreState {
  open: boolean;
  standaloneHosts: readonly string[];
  buttonHosts: readonly string[];
}

const SERVER_DIALOG_STATE: DialogStoreState = {
  open: false,
  standaloneHosts: [],
  buttonHosts: [],
};

let dialogState: DialogStoreState = SERVER_DIALOG_STATE;
const dialogListeners = new Set<() => void>();
let detachOpenAuthListener: (() => void) | null = null;

function notifyDialogListeners() {
  for (const listener of dialogListeners) {
    listener();
  }
}

function setDialogOpenInStore(nextOpen: boolean) {
  if (dialogState.open === nextOpen) {
    return;
  }
  dialogState = { ...dialogState, open: nextOpen };
  notifyDialogListeners();
}

function registerDialogHost(kind: "standalone" | "button", id: string) {
  const list =
    kind === "standalone" ? dialogState.standaloneHosts : dialogState.buttonHosts;
  if (list.includes(id)) {
    return;
  }
  dialogState =
    kind === "standalone"
      ? { ...dialogState, standaloneHosts: [...list, id] }
      : { ...dialogState, buttonHosts: [...list, id] };
  notifyDialogListeners();
}

function unregisterDialogHost(kind: "standalone" | "button", id: string) {
  const list =
    kind === "standalone" ? dialogState.standaloneHosts : dialogState.buttonHosts;
  if (!list.includes(id)) {
    return;
  }
  const filtered = list.filter((item) => item !== id);
  dialogState =
    kind === "standalone"
      ? { ...dialogState, standaloneHosts: filtered }
      : { ...dialogState, buttonHosts: filtered };
  notifyDialogListeners();
}

function subscribeDialogStore(listener: () => void): () => void {
  dialogListeners.add(listener);
  if (typeof window !== "undefined" && !detachOpenAuthListener) {
    const onOpenAuth = () => {
      setDialogOpenInStore(true);
    };
    window.addEventListener(OPEN_AUTH_EVENT, onOpenAuth);
    detachOpenAuthListener = () => {
      window.removeEventListener(OPEN_AUTH_EVENT, onOpenAuth);
      detachOpenAuthListener = null;
    };
  }
  return () => {
    dialogListeners.delete(listener);
    if (dialogListeners.size === 0) {
      detachOpenAuthListener?.();
    }
  };
}

function getDialogSnapshot(): DialogStoreState {
  return dialogState;
}

function getServerDialogSnapshot(): DialogStoreState {
  return SERVER_DIALOG_STATE;
}

const noopSubscribe = () => () => {};
function useIsHydrated(): boolean {
  return React.useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type AuthMode = "signin" | "signup" | "magic";

export function getAccessTierLabel(
  access: Pick<RequestAccess, "authenticated" | "whitelisted">,
): string {
  if (!access.authenticated) {
    return "Invitado";
  }
  if (!access.whitelisted) {
    return "Cuenta sin whitelist";
  }
  return "Autorizado";
}

function translateAuthErrorEs(rawMessage: string): string {
  const normalized = rawMessage.toLowerCase();
  if (normalized.includes("invalid login credentials")) {
    return "Correo o contraseña incorrectos.";
  }
  if (normalized.includes("email not confirmed")) {
    return "Todavía falta confirmar tu correo electrónico. Revisá tu bandeja.";
  }
  if (normalized.includes("user already registered")) {
    return "Ese correo ya tiene una cuenta registrada. Probá iniciar sesión.";
  }
  if (normalized.includes("password should be at least")) {
    return "La contraseña debe tener al menos 6 caracteres.";
  }
  if (
    normalized.includes("rate limit") ||
    normalized.includes("too many requests") ||
    normalized.includes("429")
  ) {
    return "Demasiados intentos en poco tiempo. Esperá unos instantes e intentá de nuevo.";
  }
  if (normalized.includes("unable to validate email")) {
    return "Ingresá un correo electrónico válido.";
  }
  return "No se pudo completar la operación. Verificá los datos e intentá nuevamente.";
}

function isTypingOrValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

// ---------------------------------------------------------------------------
// AuthDialog
// ---------------------------------------------------------------------------

export interface AuthDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function AuthDialog({
  open: controlledOpen,
  onOpenChange,
}: AuthDialogProps) {
  const hostId = React.useId();
  const isControlled = controlledOpen !== undefined;
  const storeState = React.useSyncExternalStore(
    subscribeDialogStore,
    getDialogSnapshot,
    getServerDialogSnapshot,
  );
  const isHydrated = useIsHydrated();
  const access = useAuthAccess();
  const { playSound } = useSensoryUI();

  React.useEffect(() => {
    if (isControlled) {
      return;
    }
    registerDialogHost("standalone", hostId);
    return () => {
      unregisterDialogHost("standalone", hostId);
    };
  }, [hostId, isControlled]);

  const isPrimaryStandalone =
    !isControlled && storeState.standaloneHosts[0] === hostId;
  const isOpen = isControlled
    ? Boolean(controlledOpen)
    : isPrimaryStandalone && storeState.open;

  const setOpen = React.useCallback(
    (next: boolean) => {
      if (isControlled) {
        onOpenChange?.(next);
      } else {
        setDialogOpenInStore(next);
      }
    },
    [isControlled, onOpenChange],
  );

  const [mode, setMode] = React.useState<AuthMode>("signin");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [noticeMsg, setNoticeMsg] = React.useState<string | null>(null);

  const titleId = React.useId();
  const descId = React.useId();
  const closeButtonRef = React.useRef<HTMLButtonElement | null>(null);

  const handleClose = React.useCallback(() => {
    playSound("overlay.close");
    setErrorMsg(null);
    setNoticeMsg(null);
    setOpen(false);
  }, [playSound, setOpen]);

  React.useEffect(() => {
    if (!isOpen) {
      return;
    }

    const previousFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const frame = window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus();
    });

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        handleClose();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
      if (previousFocused && previousFocused.isConnected) {
        previousFocused.focus();
      }
    };
  }, [isOpen, handleClose]);

  function handleModeChange(nextMode: AuthMode) {
    if (nextMode === mode) {
      return;
    }
    playSound("navigation.tab");
    setMode(nextMode);
    setErrorMsg(null);
    setNoticeMsg(null);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setErrorMsg(null);
    setNoticeMsg(null);

    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      playSound("notification.warning");
      setErrorMsg(
        "Supabase Auth no está configurado en este entorno. Continuás en modo Invitado.",
      );
      return;
    }

    const trimmedEmail = email.trim().toLowerCase();
    if (!isTypingOrValidEmail(trimmedEmail)) {
      playSound("notification.warning");
      setErrorMsg("Ingresá un correo electrónico válido.");
      return;
    }

    if (mode !== "magic" && password.length < 6) {
      playSound("notification.warning");
      setErrorMsg("La contraseña debe tener al menos 6 caracteres.");
      return;
    }

    setSubmitting(true);
    try {
      if (mode === "magic") {
        const redirectTo = `${window.location.origin}/auth/callback`;
        const { error } = await supabase.auth.signInWithOtp({
          email: trimmedEmail,
          options: {
            emailRedirectTo: redirectTo,
          },
        });
        if (error) {
          playSound("notification.error");
          setErrorMsg(translateAuthErrorEs(error.message));
          return;
        }
        playSound("notification.success");
        setNoticeMsg(
          `Te enviamos un enlace mágico a ${trimmedEmail}. Abrilo desde tu correo para iniciar sesión.`,
        );
        return;
      }

      if (mode === "signup") {
        const redirectTo = `${window.location.origin}/auth/callback`;
        const { data, error } = await supabase.auth.signUp({
          email: trimmedEmail,
          password,
          options: {
            emailRedirectTo: redirectTo,
          },
        });
        if (error) {
          playSound("notification.error");
          setErrorMsg(translateAuthErrorEs(error.message));
          return;
        }

        if (!data.session) {
          playSound("notification.success");
          setPassword("");
          setNoticeMsg(
            `Cuenta creada para ${trimmedEmail}. Revisá tu correo para confirmar el registro antes de entrar.`,
          );
          return;
        }

        await access.refresh();
        window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
        playSound("notification.success");
        setPassword("");
        setNoticeMsg(
          "Cuenta creada e iniciada. Si tu correo está autorizado en la whitelist, los modelos principales quedan activos.",
        );
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });
      if (error) {
        playSound("notification.error");
        setErrorMsg(translateAuthErrorEs(error.message));
        return;
      }

      await access.refresh();
      window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
      playSound("notification.success");
      setPassword("");
      setOpen(false);
    } catch {
      playSound("notification.error");
      setErrorMsg("Error de red al conectar con Supabase Auth.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSignOut() {
    setErrorMsg(null);
    setNoticeMsg(null);
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        playSound("notification.error");
        setErrorMsg(translateAuthErrorEs(error.message));
        return;
      }
      await access.refresh();
      window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
      playSound("notification.success");
      setNoticeMsg("Sesión cerrada. Volviste al modo Invitado.");
    } catch {
      playSound("notification.error");
      setErrorMsg("No se pudo cerrar la sesión. Intentá nuevamente.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!isHydrated || !isOpen) {
    return null;
  }

  const tierLabel = getAccessTierLabel(access);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        aria-hidden="true"
        onClick={handleClose}
        className="fixed inset-0 bg-black/55 backdrop-blur-xs transition-opacity"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="relative z-10 flex w-full max-w-md flex-col gap-4 rounded-2xl border border-border/80 bg-card/95 p-5 text-card-foreground shadow-2xl backdrop-blur-xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-xl border border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <FlameIcon className="size-4" />
            </span>
            <div>
              <h2
                id={titleId}
                className="font-serif text-lg font-semibold tracking-tight text-foreground"
              >
                Acceso a la Mesa
              </h2>
              <p id={descId} className="text-xs text-muted-foreground">
                Modo invitado limitado · Aguas Quietas
              </p>
            </div>
          </div>

          <Button
            ref={closeButtonRef}
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Cerrar diálogo de acceso"
            onClick={handleClose}
          >
            <XIcon className="size-4" />
          </Button>
        </div>

        {/* Estado actual de acceso */}
        <div className="flex flex-col gap-2 rounded-xl border border-border/75 bg-background/60 p-3.5 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-muted-foreground">Nivel actual</span>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-medium",
                access.authenticated && access.whitelisted
                  ? "border-emerald-500/35 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                  : access.authenticated
                    ? "border-amber-500/35 bg-amber-500/15 text-amber-700 dark:text-amber-300"
                    : "border-border/80 bg-muted/70 text-foreground",
              )}
            >
              {access.authenticated && access.whitelisted ? (
                <ShieldCheckIcon className="size-3.5" />
              ) : access.authenticated ? (
                <ShieldAlertIcon className="size-3.5" />
              ) : (
                <UserIcon className="size-3.5 text-muted-foreground" />
              )}
              {tierLabel}
            </span>
          </div>

          {access.email && (
            <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-2">
              <span className="text-muted-foreground">Cuenta</span>
              <span className="truncate font-mono text-[11px] text-foreground">
                {access.email}
              </span>
            </div>
          )}

          <p className="leading-relaxed text-muted-foreground">
            {access.authenticated && access.whitelisted
              ? "Tu correo está autorizado. Tenés habilitado DeepSeek V4.1 Flash (Principal) y la voz del Dungeon Master (TTS)."
              : access.authenticated
                ? "Iniciaste sesión, pero este correo aún no figura en la whitelist del servidor. Seguís jugando gratis con OpenRouter Free Router."
                : "Podés jugar gratis sin cuenta con OpenRouter Free Router. Iniciá sesión con una cuenta autorizada para desbloquear DeepSeek V4.1 Flash y TTS."}
          </p>
        </div>

        {errorMsg && (
          <Alert variant="destructive">
            <AlertTitle>No se pudo completar el acceso</AlertTitle>
            <AlertDescription>{errorMsg}</AlertDescription>
          </Alert>
        )}

        {noticeMsg && (
          <Alert className="border-amber-500/35 bg-amber-500/10">
            <SparklesIcon className="size-4 text-amber-600 dark:text-amber-400" />
            <AlertTitle>Aviso de autenticación</AlertTitle>
            <AlertDescription>{noticeMsg}</AlertDescription>
          </Alert>
        )}

        {access.authenticated ? (
          <div className="flex items-center justify-end gap-2 border-t border-border/70 pt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleClose}
              disabled={submitting}
            >
              Seguir jugando
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={handleSignOut}
              disabled={submitting}
            >
              <LogOutIcon data-icon="inline-start" className="size-3.5" />
              {submitting ? "Cerrando…" : "Cerrar sesión"}
            </Button>
          </div>
        ) : !access.supabaseConfigured ? (
          <Alert>
            <ShieldAlertIcon className="size-4 text-amber-600 dark:text-amber-400" />
            <AlertTitle>Supabase Auth sin configurar</AlertTitle>
            <AlertDescription>
              Faltan variables públicas de Supabase en este entorno. Podés
              seguir jugando en modo Invitado.
            </AlertDescription>
          </Alert>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div
              role="tablist"
              aria-label="Método de acceso"
              className="grid grid-cols-3 gap-1 rounded-xl border border-border/80 bg-muted/45 p-1 text-xs"
            >
              {(
                [
                  { id: "signin", label: "Iniciar sesión" },
                  { id: "signup", label: "Crear cuenta" },
                  { id: "magic", label: "Enlace mágico" },
                ] as const
              ).map((tab) => {
                const selected = mode === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => handleModeChange(tab.id)}
                    className={cn(
                      "min-h-7 rounded-lg px-2 py-1 font-medium transition-colors",
                      selected
                        ? "bg-card text-foreground shadow-xs ring-1 ring-border/70"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <label className="flex flex-col gap-1.5 text-xs">
              <span className="font-medium text-muted-foreground">
                Correo electrónico
              </span>
              <Input
                type="email"
                autoComplete="email"
                placeholder="aventurero@correo.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-9 border border-border/75 bg-background/70"
                required
              />
            </label>

            {mode !== "magic" && (
              <label className="flex flex-col gap-1.5 text-xs">
                <span className="font-medium text-muted-foreground">
                  Contraseña
                </span>
                <Input
                  type="password"
                  autoComplete={
                    mode === "signup" ? "new-password" : "current-password"
                  }
                  placeholder="Mínimo 6 caracteres"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={6}
                  className="h-9 border border-border/75 bg-background/70"
                  required
                />
              </label>
            )}

            <div className="flex items-center justify-between gap-2 pt-1">
              <span className="text-[11px] text-muted-foreground">
                {mode === "magic"
                  ? "Recibirás un link de un solo uso."
                  : "Tu sesión queda guardada de forma segura."}
              </span>
              <Button type="submit" size="sm" disabled={submitting}>
                {mode === "magic" ? (
                  <MailIcon data-icon="inline-start" className="size-3.5" />
                ) : (
                  <KeyRoundIcon data-icon="inline-start" className="size-3.5" />
                )}
                {submitting
                  ? mode === "magic"
                    ? "Enviando…"
                    : mode === "signup"
                      ? "Creando…"
                      : "Ingresando…"
                  : mode === "magic"
                    ? "Enviar enlace"
                    : mode === "signup"
                      ? "Crear cuenta"
                      : "Iniciar sesión"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// AuthButton
// ---------------------------------------------------------------------------

export function AuthButton({ className }: { className?: string }) {
  const buttonHostId = React.useId();
  const access = useAuthAccess();
  const { playSound } = useSensoryUI();
  const dialogStore = React.useSyncExternalStore(
    subscribeDialogStore,
    getDialogSnapshot,
    getServerDialogSnapshot,
  );

  React.useEffect(() => {
    registerDialogHost("button", buttonHostId);
    return () => {
      unregisterDialogHost("button", buttonHostId);
    };
  }, [buttonHostId]);

  const shouldHostDialog =
    dialogStore.standaloneHosts.length === 0 &&
    dialogStore.buttonHosts[0] === buttonHostId;

  const label = getAccessTierLabel(access);

  const tooltipText = access.authenticated
    ? access.whitelisted
      ? `Autorizado (${access.email ?? "cuenta verificada"}) · Modelos principales y TTS habilitados`
      : `Cuenta sin whitelist (${access.email ?? "sin correo"}) · Modo gratuito activo`
    : "Invitado · Iniciá sesión para desbloquear DeepSeek V4.1 Flash y TTS";

  function handleOpen() {
    playSound("overlay.open");
    setDialogOpenInStore(true);
  }

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleOpen}
              aria-label={`Acceso: ${label}. Abrir opciones de cuenta`}
              className={cn(
                "h-7 gap-1.5 px-2.5 text-xs",
                access.authenticated &&
                  access.whitelisted &&
                  "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300",
                access.authenticated &&
                  !access.whitelisted &&
                  "border-amber-500/35 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:text-amber-300",
                className,
              )}
            >
              {access.authenticated && access.whitelisted ? (
                <ShieldCheckIcon
                  data-icon="inline-start"
                  className="size-3.5"
                />
              ) : access.authenticated ? (
                <ShieldAlertIcon
                  data-icon="inline-start"
                  className="size-3.5"
                />
              ) : (
                <UserIcon data-icon="inline-start" className="size-3.5" />
              )}
              <span className="truncate">{label}</span>
            </Button>
          }
        />
        <TooltipContent>{tooltipText}</TooltipContent>
      </Tooltip>

      {shouldHostDialog && (
        <AuthDialog
          open={dialogStore.open}
          onOpenChange={setDialogOpenInStore}
        />
      )}
    </>
  );
}
