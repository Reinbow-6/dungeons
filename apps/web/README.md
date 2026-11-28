# `@dungeons/web` — Aplicación Web (Next.js 16)

Frontend, agente DM (AI SDK) y endpoints HTTP de **Dungeons**. Para la guía general del monorepo, instalación y variables de entorno, consultá [el README raíz](../../README.md) y [AGENTS.md](../../AGENTS.md).

## Scripts del paquete

Ejecutar desde la raíz con `pnpm --filter @dungeons/web <script>` (o `pnpm.cmd` en Windows PowerShell):

| Script | Descripción |
| --- | --- |
| `dev` | Compila `@dungeons/rules` y `@dungeons/srd` (`predev`) y levanta Next.js 16 en `http://localhost:3000`. |
| `build` | Compila paquetes del workspace (`prebuild`) y genera el build de producción de Next.js. |
| `start` | Inicia el servidor Next.js en modo producción. |
| `typecheck` | Corre `tsc --noEmit` sobre el proyecto web. |
| `test` | Ejecuta la suite de Vitest en `apps/web/tests/`. |
| `lint` | Ejecuta `eslint` (el flujo de verificación exige `pnpm --filter @dungeons/web exec eslint --max-warnings 0 .`). |
| `format` | Formatea archivos `.ts`/`.tsx` con Prettier. |
| `db:generate` / `db:migrate` / `db:push` / `db:studio` | Utilidades de Drizzle Kit para Supabase Postgres. |
| `smoke:providers` / `smoke:stt` | Scripts locales para probar conectividad LLM y STT Whisper. |

## Rutas API principales

| Ruta | Métodos | Uso |
| --- | --- | --- |
| `/api/chat` | `POST` | Turno streaming del DM con compactación de contexto, tool calls deterministas y `stopWhen`. |
| `/api/game/campaigns` | `GET`, `POST`, `DELETE` | Lista (`?list=1` con `limit`/`offset`), carga (`?campaignId=`), creación y eliminación individual o total (`?all=1`) de campañas. |
| `/api/game/campaigns/intro` | `POST` | Siembra la introducción determinista de escena sin costo de LLM. |
| `/api/game/declare-check` | `POST` | Verificación de tiradas declaradas en Modo Híbrido (`check` e `investigate`). |
| `/api/game/mode` | `PATCH` | Cambia el modo de tiradas global de la mesa (`digital` o `hybrid`). |
| `/api/game/party` | `POST`, `DELETE` | Suma o retira integrantes (`1–4` PJs) en la campaña activa. |
| `/api/game/rollback` | `POST` | Revierte la campaña y el chat a una secuencia `targetSeq`. |
| `/api/game/sessions` | `POST` | Cierra la sesión activa con resumen y abre la siguiente. |
| `/api/stt` | `POST` | Dictado de voz a texto con Groq Whisper. |
| `/api/tts` | `POST` | Narración de audio (OpenRouter HeyGen/Fish o Fish Audio directo). |
| `/api/auth/status` | `GET` | Estado de sesión Supabase, tier y whitelist. |
| `/api/usage` | `GET` | Métricas de consumo diario del invitado. |

## Variables de entorno

Usá [.env.example](.env.example) como plantilla para crear `.env.local`.
