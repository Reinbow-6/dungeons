# AGENTS.md — Guía de Arquitectura y Convenciones

Este documento define las invariantes técnicas y convenciones de trabajo para este monorepo (UI `apps/web/components` → Agente/API `apps/web/agent` + `app/api` → Reglas puras `packages/rules` / `packages/srd`).  
*(Nota: [apps/web/AGENTS.md](apps/web/AGENTS.md) contiene reglas internas autogeneradas por Next.js 16 y debe preservarse sin conflictos.)*

---

## 1. Invariantes de arquitectura

1. **Separación estricta entre narrativa y reglas (`packages/rules` ↔ LLM):**
   - El agente DM (`apps/web/agent/`) **nunca muta el estado ni inventa resultados de dados**.
   - Toda mutación de campaña (checks, salvaciones, pistas, combate, inventario, conjuros, descansos, miembros del grupo, rollback) ocurre dentro de funciones puras deterministas en `packages/rules` y genera un `GameEvent` en `event_log`.
   - Toda escritura persistida pasa por `appendEvent` en `apps/web/lib/game/store.ts` con verificación optimista contra `logHeadSeq` (`StaleSeqError`). Nunca derives `expectedSeq` únicamente del estado revertido tras un rollback; usá siempre `logHeadSeq`.

2. **Frontera Digital vs Híbrido (`rollAuthority`):**
   - Si toda la mesa tiene `rollAuthority === "player-declared"` (`!hasEngineRolled`), `selectActiveDmTools` (`apps/web/agent/agent.ts`) excluye `resolve_check`, `resolve_save` e `investigate` del toolset enviado al modelo. En ejecución, `resolveCheck`, `resolveSave` y `resolveInvestigate` (`packages/rules/src/resolvers.ts`) validan por personaje y devuelven `WRONG_MODE` si un actor `player-declared` carece de `declared`.
   - Todo pedido de tirada o búsqueda de pistas para actores `player-declared` debe ir por `declare_check` (con `purpose: "investigate"` para investigar escenas) y validarse vía `POST /api/game/declare-check`.

3. **Precedencia de reglas SRD 5.2.1:**
   - Según [ATTRIBUTION.md](ATTRIBUTION.md), **SRD 5.2.1 prevalece siempre** sobre material legado 5.1 (incluido *Exhaustion* acumulado `-2` por nivel a pruebas de d20 y reglas vigentes en `packages/srd/src/overrides-521.ts`).

4. **Consistencia UI ↔ Estado:**
   - Cada transición de escena, combate, creación/eliminación de campaña y rollback debe reflejarse inmediatamente en el cliente sin estados huérfanos. Si un usuario queda con `0` campañas tras borrar partidas, `GET /api/game/campaigns` no crea una campaña fantasma en automático; el cliente crea bajo demanda vía `ensureCampaignId()`.

---

## 2. Convenciones de UI/UX y Frontend

- **Geometría arquitectónica recta:** `--radius: 0rem` en `apps/web/app/globals.css` y `rounded-none` en componentes, botones, tarjetas, modales, inputs y toasts, con bordes finos de `1px`. Única excepción permitida: micro-indicadores de estado circulares mínimos (`size-1.5` en pulso en vivo/grabación o el toggle de burbuja de avatares).
- **Shell unificado:** Un único `<header>` (`44px`) en `apps/web/components/chat.tsx` sin cabeceras ni footers duplicados; sidebars acoplados en flujo `flex` en `lg+` (`CampaignSidebar` a la izquierda, `GameSidebar` a la derecha) y overlay drawer solo bajo `1024px`.
- **Reglas estrictas de React / ESLint:**
  - `eslint --max-warnings 0` está exigido en `@dungeons/web`: **cero** imports, props o variables sin usar.
  - Nunca llames a `setState` de forma síncrona dentro de `useEffect` (`react-hooks/set-state-in-effect`). Para `localStorage` o snapshots externos usá `useSyncExternalStore` con `getServerSnapshot` estable/cacheado, o callbacks asíncronos.
- **Formato narrativo del DM:** Diálogos literarios en markdown blockquote (`>`) con comillas latinas `« »` y nombre opcional del hablante conocido (ver `apps/web/agent/instructions.md` y `apps/web/components/parts/narrative-text.tsx`).

---

## 3. Mapa de carpetas clave

| Ruta | Responsabilidad |
| --- | --- |
| `packages/rules/src/` | Tipos (`types.ts`), eventos/rollback (`events.ts`), resolvers (`resolvers.ts`), combate (`combat.ts`), conjuros (`spells.ts`), descansos (`rest-and-death.ts`), grupo (`party.ts`), lorebook (`lorebook.ts`), narrativa (`narrative-engine.ts`) y aventura (`adventures/aguas-quietas.ts`). |
| `packages/srd/src/` | Carga/validación SRD (`catalog.ts`, `schemas.ts`), `overrides-521.ts`, `translations-es.ts` y bestiario (`aguas-quietas-bestiary.ts`). |
| `apps/web/agent/` | Prompt en capas + filtrado de tools (`agent.ts`), reglas del DM (`instructions.md`), `tools/*`, subagente de memoria (`subagents/memory/`). |
| `apps/web/app/api/` | Endpoints `chat`, `game/campaigns` (`GET`/`POST`/`DELETE`), `game/campaigns/intro`, `game/declare-check`, `game/mode`, `game/party`, `game/rollback`, `game/sessions`, `auth/status`, `stt`, `tts`, `usage`. |
| `apps/web/lib/` | Store Postgres/InMemory (`game/store.ts`), presets e intros (`game/presets.ts`, `game/intro.ts`), Drizzle (`db/schema.ts`), auth/whitelist (`auth/`), guardrails/provider (`ai/`, `guardrails/`). |
| `apps/web/components/` | `chat.tsx`, `chat-message.tsx`, `prompt-form.tsx`, `settings-panel.tsx`, `auth-dialog.tsx`, `game/*` (`campaign-sidebar`, `game-sidebar`, `dice-roll-card`, `hybrid-check-card`, `suggested-actions`, `epilogue-card`, `combat-tracker`, `party-builder`) y primitivos `ui/*`. |

---

## 4. Flujo de verificación obligatorio

Antes de dar por terminado cualquier cambio (en Windows PowerShell usá `pnpm.cmd` y evitá `&&`):

1. Si editaste `packages/rules` o `packages/srd`, compilalos antes de probar `web`:
   ```powershell
   pnpm.cmd --filter @dungeons/rules build
   pnpm.cmd --filter @dungeons/srd build
   ```
2. Verificación completa:
   ```powershell
   pnpm.cmd typecheck
   pnpm.cmd --filter @dungeons/web exec eslint --max-warnings 0 .
   pnpm.cmd test
   pnpm.cmd --filter @dungeons/web build
   ```
   *(En Windows, si `next build` falla con `os error 5` por enlaces junction de Turbopack en sandbox, ejecutalo fuera del sandbox.)*
3. Mantené `apps/web/.env.local` y archivos temporales locales fuera de commits.
