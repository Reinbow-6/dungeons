# HANDOFF PARA ANTIGRAVITY — Proyecto Dungeons (AI DM 5e-lite)

Fecha: 2026-11-20. Estado: **P0 del code review implementado y verificado**. Este archivo es la fuente de verdad para continuar. No asumas que lo que sigue está hecho: está verificado con comandos reales.

---

## 1. Estado actual (NO rehacer)

### Verificación ejecutada por el agente revisor (2026-11-20)

```bash
cd C:/Users/Ezequiel/Documents/Eze/dev/dungeons
pnpm test        # exit 0 → rules 42/42, srd 5/5, web 17/17 = 64/64
pnpm typecheck   # exit 0 → 3 paquetes OK
```

`pnpm lint` **no existe en la raíz**; `pnpm --filter @dungeons/web lint` da 4 errores **preexistentes** (3 `react-hooks` en `apps/web/components/chat.tsx` líneas 68/72/119 y 1 `any` en `apps/web/tests/dm-agent.test.ts:16`). No fueron tocados: son P1.

### Backup

No hay repo git todavía. Backup de solo lectura de los archivos originales:

`C:/Users/Ezequiel/AppData/Local/hermes/cache/scratch/dungeons-backup-20261120-002607`

### Fix P0 aplicados

| # | Fix | Dónde |
|---|---|---|
| 1 | `tempHpChanges` entra en `stateDelta` y se aplica dentro de `applyDelta`. Antes la reducción de PG temporales se hacía post-`applyDelta`, así que `reduceEvents()` no reproducía el estado y el rollback mentía. | `packages/rules/src/events.ts`, `combat.ts`, `resolvers.ts`; test `packages/rules/tests/temp-hp-replay.test.ts` |
| 2 | Autoridad de dados enforceada en el motor: `WRONG_MODE` si `resolve_check`/`resolve_save` se llaman con actor `player-declared`, e inversamente en `declare_check`. | `packages/rules/src/resolvers.ts`, `apps/web/agent/tools/{resolve-check,resolve-save,declare-check}.ts`, ruta `declare-check`, `agent/types.ts` |
| 3 | `dcRef` opcional: la CD se resuelve desde pistas reales de la escena, el número del modelo queda auditado en `payload.dcDeclaredByModel`. Sin DC → `DC_REQUIRED`. | `resolvers.ts`, tools, ruta `declare-check` |
| 4 | `expectedSeq` + `STALE_SEQ` con reintento. Tras el retry se **recarga el estado autoritativo** (corrección de verificación: no reintroducir el snapshot viejo). | `apps/web/lib/game/store.ts`, `agent/tools/runtime.ts`, `app/api/chat/route.ts` (`commitEventWithRetry`), test `apps/web/tests/store-consistency.test.ts` |
| 5 | Rollback coherente: `eventSeq`/`revertedBySeq`, migración `0001_message_event_seq.sql` + snapshot, `loadCampaign` filtra mensajes revertidos, tool y REST comparten `performRollback`. | `apps/web/lib/db/schema.ts`, `drizzle/0001_*`, `api/game/rollback/route.ts`, `agent/tools/rollback-to-event.ts` |
| 6 | Precondiciones de transición: mapa `transitionRequirements` por arista `origen>destino`, `MISSING_PRECONDITION`. IDs usados: `pista_camp_14`, `pista_camp_12`, `pista_porton_14`. Se quitó `flagsSet` arbitrario del input. | `packages/rules/src/types.ts`, `adventures/aguas-quietas.ts`, `resolvers.ts`, test `transition-preconditions.test.ts` |

### Trampa conocida (NO tocar)

`apps/web/lib/ai/provider.ts:163` se ve como `apiKey: ***` **solo en la vista de herramientas** (redacción de secretos). El código real usa `googleKey` definido arriba. No es un bug: `typecheck` pasa.

### Migración pendiente de aplicar

Hay DB real configurada: ejecutar `pnpm --filter @dungeons/web db:migrate`. Los tests usan `InMemoryGameStore` y no la ejercitan.

---

## 2. Pendiente del code review (P1, en orden)

1. **Guardrails persistentes**: `rate-limit.ts` y `spend-cap.ts` usan `Map` en memoria; la IP se lee de `x-forwarded-for` (spoofable); la tabla `guest_usage` existe pero no se usa. Mover a contadores atómicos en Postgres/Redis con TTL por `guestId`+día. Usar IP de la plataforma, no headers.
2. **No filtrar `err.message` al cliente**: 5 rutas lo devuelven. Responder mensaje genérico en español, loguear servidor con `correlationId`.
3. **Fail-fast sin `DATABASE_URL`**: `getDefaultGameStore()` cae silenciosamente a memoria. En producción debe fallar en arranque.
4. **Autorización por `campaign_members`**: hoy `loadCampaign` solo filtra por `ownerGuestId`. Sin esto no hay multijugador real. `GET /api/game/campaigns` además crea campañas como efecto secundario: pasar a POST y paginar.
5. **Sesiones decorativas**: se crea una sola (`sessionNumber: 1`). Implementar ciclo de vida o quitar `sessions` del modelo.
6. **Condiciones SRD 5.2.1**: `blinded`, `frightened`, `restrained`, `prone`, etc. tienen metadata en `overrides-521.ts` pero `modifiers.ts`/`combat.ts` no la consumen. Falta ventaja/desventaja a ambos lados, fallos automáticos, exhaustion acumulativa, concentración y `resistant` en `DamageRelation`.
7. **Prompt injection**: el test `dm-agent.test.ts:391` dice "prompt injection" pero no contiene payload. No hay delimitación de contenido no confiable. Añadir defensa observada + test.
8. **Lint**: 4 errores preexistentes.
9. **UI híbrida**: el tool `declare_check` sigue exigiendo `dc` numérico porque `hybrid-check-card.tsx` lo consume. El motor ya acepta `dcRef`; exponerlo en la UI.
10. **Cobertura de tests**: añadir casos con `temp>0`, condiciones, resistencias, concentración y prompt injection.

---

## 3. Proveedores: alcance exacto deseado

El usuario **no quiere** sumar Anthropic, Gemini directo ni OpenRouter de pago. Alcance:

- **Mantener:** `openrouter:openrouter/free` como default gratuito (`MODELS[0]`).
- **Agregar/habilitar:** Groq con `qwen/qwen3.8-27b`.

Datos verificados de Groq (2026-11-20):

- ID real: **`qwen/qwen3.8-27b`** (no `qwen3.8-27b`). Es **preview**, puede discontinuarse.
- Capacidades: tool use, JSON mode, reasoning, visión. Contexto 131072, max completion 16384.
- Precio: $0.80/M input, $4.00/M output. Límites developer: 250K TPM, 1K RPM.
- Requiere `GROQ_API_KEY`. Con `@ai-sdk/groq` ya está en `package.json`.

### Por qué hoy no funciona

`apps/web/lib/models.ts` **no contiene** ninguna entrada para Qwen en Groq. `isModelAllowed(id)` rechaza el modelo antes de llamar al proveedor, y `/api/chat` responde `El modelo "..." no está disponible`. Eso explica "todos los demás tiran error" mejor que una falla de red.

Acciones:

1. Agregar a `MODELS`: `{ id: "groq:qwen/qwen3.8-27b", name: "Qwen 3.8 27B (Groq)", provider: "groq", modelId: "qwen/qwen3.8-27b" }`.
2. Confirmar que `resolveLanguageModel` en `lib/ai/provider.ts` acepte el prefijo `groq:` y use `createGroq({ apiKey: GROQ_API_KEY })` con ese `modelId`.
3. Probar un tool-call real con el DM (no solo `hola`): verificar que devuelve `tool_calls` y no XML en `content`. Si el reasoning del modelo contamina `content`, aplicar la misma estrategia que con Qwen local: `--reasoning-format deepseek` equivalente del SDK / normalizar reasoning en `reasoning_content`.
4. Recortar `MODELS` a las dos opciones deseadas si el objetivo es reducir superficie. No borrar `LLMProviderId` sin migrar los tipos.

---

## 4. Observabilidad mínima (sí implementar)

No hace falta una plataforma pesada. Requisitos:

- Log estructurado **solo servidor** por request: `requestId`, `provider`, `modelId`, `status`, `errorCode`, `promptTokens`, `completionTokens`, `toolCalls`, `lastSeq`, `guestId` hasheado.
- Tabla `provider_health` (o `agent_events`) con latencia y fallos por proveedor/modelo/día. Conectar `guest_usage` de una vez.
- Errores **tipados hacia el modelo** para que el agente pueda reaccionar: ya existen `WRONG_MODE`, `STALE_SEQ`, `DC_REQUIRED`, `MISSING_PRECONDITION`; agregar `PROVIDER_UNAVAILABLE` y `MISSING_API_KEY`.
- Nunca devolver `err.message` al cliente (P1.2).
- Guardar un smoke test que instancie los dos proveedores permitidos y haga un tool-call corto.

Nota conceptual: la telemetría da visibilidad **al humano**; para que el agente "intercepte" bugs hacen falta los errores estructurados en el tool result, no un dashboard.

---

## 5. Roadmap (Antigravity) con correcciones

El orden propuesto (Memoria → Voz → Visual → Multijugador) es razonable pero salta los P1. Orden corregido:

1. P1.1–P1.4 (guardrails, errores, fail-fast, autorización).
2. Proveedores + observabilidad (sección 3 y 4).
3. **Sincronización rollback↔chat** (ya hecha en el lado del store; verificar el render de `chat.tsx`).
4. **Memoria**: `memory/agent.ts` + `memory_facts`. Condición dura: cada hecho debe llevar `eventSeq`/seq de origen y **revertirse con el rollback**. Si no, la memoria narrará hechos deshechos.
5. **Pulido visual fantasy** sobre `shadcn/ui`: tipografía, paleta, tarjetas de ficha/tirada/tracker. Barato, se puede hacer en paralelo.
6. **Voz STT/TTS**: Web Speech API gratis; útil pero no desbloquea correctness. Después de memoria.
7. **Multijugador** (después del MVP): Supabase Auth + `campaign_members` con roles.

**No adoptes `vercel-labs/ui` (UI SDK) ahora**: es una librería *headless de comportamientos* (foco, teclado, selección, DnD, ARIA), en beta, no un kit visual. No aporta estética fantasy y agrega churn de API.

**No adoptes la plantilla `knowledge-agent-template`**: es una app Vercel con auth/drizzle/sandbox; sirve como referencia de "grep en vez de embeddings" y de política de comandos read-only, no como base del MVP.

---

## 6. Modo swarm y GitHub

Hoy **no hay repo git** (`.git` no existe). Eso bloquea: diff, reverts, worktrees, PR review y paralelismo seguro.

**Recomendación: sí, subir a GitHub antes de swarm.** Es requisito, no opcional.

```bash
cd C:/Users/Ezequiel/Documents/Eze/dev/dungeons
git init
git add .
git commit -m "feat: MVP 5e-lite con P0 verificado"
git remote add origin <URL_DEL_REPO>
git push -u origin main
```

`.gitignore` ya cubre `node_modules/`, `dist/`, `.next/`, `coverage/`, `.env`, `.env.local`, `.env.*.local`, `*.log`, PDFs de referencia. **Verificar con `git status` antes del primer commit** que no haya credenciales.

Reglas para swarm:

- Un agente por rama/worktree (`git worktree add ../dungeons-agente-X -b agente/X`). Nunca dos agentes escribiendo el mismo working tree.
- Cada agente corre `pnpm test` y `pnpm typecheck` antes de reportar.
- Los cambios llegan por PR; el revisor es un agente distinto del implementador.
- No mezclar P1, features y fixes en el mismo PR.
- Si se usa Hermes: perfiles/workspaces separados, no compartir skills/memories entre agentes que compiten.

---

## 7. Comandos útiles

```bash
cd C:/Users/Ezequiel/Documents/Eze/dev/dungeons
pnpm test
pnpm typecheck
pnpm --filter @dungeons/web lint
pnpm --filter @dungeons/web db:migrate
pnpm --filter @dungeons/rules build
```
