# Dungeons — Dungeon Master IA con Motor Determinista 5e

Plataforma multi-campaña de rol de mesa D&D 5e (**SRD 5.2.1**) en español rioplatense donde la IA narra e interpreta las reglas mientras un **motor determinista en TypeScript** valida cada tirada, combate, espacio de conjuro, pista descubierta y punto de golpe mediante un registro de eventos inmutable (`event_log`).

Incluye la campaña integrada **Aguas Quietas**, soporte para **importar módulos propios (`AdventurePack` v1 `.json`)**, compilación local desde PDF (`pnpm compile:pdf`), **multijugador local en una pantalla (`1–4` jugadores)** y modo **Digital** (d20 resuelto en servidor) o **Híbrido** (d20 físico en tu mesa o botón *Tirar por mí*).

---

## Características principales

- **Motor multi-campaña (`AdventurePack` v1):** Desacoplamiento completo de escenas, pistas, lorebook, PNJs compartimentados, bestiario y finales. Podés jugar *Aguas Quietas* por defecto, importar packs `.json` desde **Campañas → Módulos (.json)** (persistidos en Postgres vía `/api/game/packs`) o compilar módulos desde PDF con `scripts/compile-adventure-pdf.mjs`.

- **Motor de reglas determinista (`@dungeons/rules`):** El LLM nunca muta estado ni inventa resultados de dados; toda acción mecánica pasa por tools validadas con Zod, registro de eventos con concurrencia optimista (`logHeadSeq` / `StaleSeqError`) y rollback completo a cualquier secuencia anterior.
- **Modo Digital y Modo Híbrido:** Alterná a nivel de mesa entre tiradas automáticas del motor o tiradas declaradas por los jugadores (con tarjeta interactiva de verificación, ventaja/desventaja y botón digital opcional *Tirar por mí*).
- **Soporte `5e-full` y `5e-lite`:** Combate por iniciativa, condiciones SRD 5.2.1, salvaciones de muerte en `0 PG`, lanzamiento y concentración de conjuros, consumo de Dados de Golpe en descansos cortos/largos y curación por poción o Medicina.
- **Mesa local (`1–4` PJs) y *DM en pausa*:** Sumá hasta 4 personajes con alias de jugador, cambiá el foco con un clic o `Alt+1..4` y acumulá diálogos/acciones entre jugadores sin gastar turnos del DM hasta enviar el bloque grupal.
- **Investigación y finales múltiples:** Descubrimiento progresivo de pistas por escena (`investigate` / `/investigar`), termómetro de tensión narrativa, lorebook contextual y epílogo según rutas desbloqueadas.
- **Voz y accesibilidad:** Dictado por micrófono con **Groq Whisper** (`/api/stt`), narración TTS opcional (`/api/tts` con HeyGen o Fish Audio) para usuarios autorizados, atajos de teclado para navegación y acciones, y soporte de temas claro/oscuro.

---

## Estructura del monorepo

```text
.
├── packages/
│   ├── rules/          # Motor puro determinista, AdventurePackSchema, combate, conjuros, grupos, lorebook y campaña integrada
│   └── srd/            # Catálogo SRD 5.2.1 validado con Zod, overrides 5.2.1 y traducciones al español
├── scripts/            # Compilador CLI PDF -> AdventurePack JSON (compile-adventure-pdf.mjs)
└── apps/
    └── web/            # Aplicación Next.js 16 (App Router), agente DM (AI SDK), Drizzle ORM (Postgres) y UI
```

---

## Requisitos y configuración local

- **Node.js** 22+ y **pnpm** `11.x` (`packageManager: pnpm@11.24.0`).
- **Base de datos Postgres** (opcional en tests unitarios, recomendada para persistencia real con Supabase Postgres + Drizzle).
- Credencial de OpenRouter (`OPENROUTER_API_KEY`) para el DM y TTS, y opcionalmente `GROQ_API_KEY` para dictado por voz (`STT`).

### 1. Instalar dependencias

```bash
pnpm install
```

### 2. Configurar variables de entorno

Copiá el archivo de ejemplo y completá tus claves en `apps/web/.env.local`:

```bash
cp apps/web/.env.example apps/web/.env.local
```

Variables principales en `apps/web/.env.local`:

| Variable | Uso | Requerida para |
| --- | --- | --- |
| `DATABASE_URL` / `DIRECT_URL` | Conexión Postgres (`DATABASE_URL` en runtime; `DIRECT_URL` opcional para CLI `drizzle-kit`) | Persistencia en DB |
| `OPENROUTER_API_KEY` | Modelos LLM de texto (`openrouter/free` y DeepSeek) y punto de entrada de `/api/tts` | DM y TTS |
| `GROQ_API_KEY` | Transcripción de voz STT con Whisper (`/api/stt`) y script `smoke:providers` | Micrófono |
| `FISH_API_KEY` | TTS directo con Fish Audio (requiere también `OPENROUTER_API_KEY` configurada) | Opcional (TTS Fish directo) |
| `SESSION_SECRET` | Firma HMAC de cookie anónima (`>= 16` chars en producción) | Producción |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Autenticación con Supabase | Login y whitelist |
| `AUTH_WHITELIST_EMAILS` | Lista de emails autorizados (acceso a modelos tier `whitelisted` y TTS) | Opcional |

### 3. Esquema de base de datos (Drizzle)

Desde la raíz, aplicá las migraciones o sincronizá el esquema hacia Postgres:

```bash
pnpm --filter @dungeons/web db:push
# o migraciones versionadas:
pnpm --filter @dungeons/web db:migrate
```

### 4. Levantar en desarrollo

```bash
pnpm --filter @dungeons/web dev
```

*(El hook `predev` compila automáticamente `@dungeons/rules` y `@dungeons/srd` antes de iniciar Next.js en `http://localhost:3000`.)*

---

## Scripts útiles

```bash
# Verificación de tipos en todo el monorepo
pnpm typecheck

# Suite completa de tests (Vitest en rules, srd y web)
pnpm test

# Linter estricto sin warnings en la app web
pnpm --filter @dungeons/web exec eslint --max-warnings 0 .

# Build completo de paquetes y aplicación Next.js
pnpm build
```

---

## Documentación relacionada

- [FEATURES.md](FEATURES.md) — Features implementadas, prioridades aprobadas y alcance descartado.
- [AGENTS.md](AGENTS.md) — Invariantes de arquitectura, reglas de UI, convenciones del agente DM y guía para colaboradores/agentes.
- [ATTRIBUTION.md](ATTRIBUTION.md) — Licencia CC-BY-4.0 del **SRD 5.2.1** de Wizards of the Coast y precedencia sobre 5.1.
- [apps/web/README.md](apps/web/README.md) — Referencia específica de endpoints y scripts de `@dungeons/web`.
