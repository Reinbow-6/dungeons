# FEATURES.md — Estado, Prioridades y Criterio de Producto

Documento vivo de decisiones funcionales y prioridades para **Dungeons**. Reemplaza el plan puntual de `CONTEXT-OPTIMIZATION.md` (cuyas fases clave ya fueron incorporadas al código).

---

## 1. Implementado en producción

- **Motor determinista 5e (SRD 5.2.1):** Resolvers puros con Zod en `@dungeons/rules`, `event_log` inmutable con concurrencia optimista (`logHeadSeq`), rollback completo a cualquier secuencia y precedencia SRD 5.2.1 (`-2` por nivel de *Exhaustion*).
- **Perfiles `5e-full` y `5e-lite`:** Combate por iniciativa, conjuros con espacios/concentración/escalado, salvaciones de muerte en `0 PG`, Dados de Golpe en descansos cortos/largos y curación por poción o Medicina.
- **Modo Digital e Híbrido:** Tiradas resueltas en servidor o d20 físico validado por el motor (`declare_check` tanto para pruebas como para `purpose: "investigate"`), con botón digital opcional *Tirar por mí*.
- **Multijugador local (`1–4` PJs):** Gestión dinámica de grupo, alias de jugador, cambio rápido de foco (`Alt+1..4` o desde header/HUD) y **DM en pausa** para acumular diálogos/acciones antes de enviar el bloque grupal.
- **Narrativa, voz y UI arquitectónica:** Campaña integrada *Aguas Quietas* (pistas, lorebook, arco/tensión, epílogo), header único de `44px`, geometría recta (`--radius: 0px`), Party HUD estilo RPG, borrado individual/masivo de campañas, STT (Groq Whisper), TTS (OpenRouter HeyGen / Fish) y optimización activa de contexto (`intro.ts` 0 tokens, poda de tool outputs previos, `selectActiveDmTools`, prompt en capas y registro de `cachedTokens`).
- **Motor multi-campaña (`AdventurePack` v1 + Importador JSON + Compilador PDF):** Esquema estándar `AdventurePackSchema` con validación de grafo (`validateAdventurePackGraph`), tabla `adventure_packs` + API `/api/game/packs`, selector de módulo e importador `.json` en `CampaignSidebar` y compilador CLI (`pnpm compile:pdf` → `scripts/compile-adventure-pdf.mjs`) con extracción 2 columnas (`pdfjs-dist`), checkpoints `--resume` y salida local en `data/packs/` (excluida de Git).

> [!WARNING]
> **Recordatorio operativo vigente:** el modelo gratuito `fish-audio/s2.1-pro-free:free` listado en [tts-models.ts](apps/web/lib/tts-models.ts) vence el **30/11/2026**. Revisar reemplazo o dejar `heygen/heygen-voice-1-turbo:free` como único default antes de esa fecha.

---

## 2. Roadmap priorizado (Qué entra y cuándo)

| Prioridad | Feature | Alcance / Criterio | Cuándo |
| --- | --- | --- | --- |
| **P2** | **Modificadores con fuente + Predicados declarativos** *(ref. Foundry PF2e)* | Núcleo liviano `Modifier { slug, label, value \| dice, type, predicate[] }` sobre tags de actor/escena/condición, con desglose auditable en `DiceRollCard` (sin replicar la complejidad completa de *Rule Elements*). | **Corto plazo** |
| **P2** | **Duración automática de efectos y condiciones en combate** *(ref. Foundry PF2e + DiceCloud)* | `ActiveEffect` con `durationRounds`, tick en inicio/fin de turno dentro de `advanceCombatTurn` y limpieza automática al perder concentración, descansar o terminar combate. | **Corto plazo (junto a Modificadores)** |
| **P2** | **Branching / Rewind limpio de campaña** *(ref. SillyTavern)* | Permitir **«Bifurcar campaña desde turno #N»** clonando estado/eventos hasta `seq N` en una rama nueva, aprovechando el `event_log` ya existente. | **Corto plazo** |
| **P3** | **Progresión (XP / Nivel) y Economía básica** | Subida de nivel, ganancia de XP y manejo formal de oro/recompensas para sostener campañas largas más allá de nivel 1–2. | **Mediano plazo** |
| **P3** | **Memoria editable + Medidor de afinidad con NPCs** | Permitir al jugador corregir o fijar `memory_facts` desde el HUD y trackear relación determinista con NPCs clave. | **Mediano plazo** |
| **P3** | **Epílogo enriquecido + Exportar crónica** | Ampliar `EpilogueCard` con resumen de decisiones clave y exportación limpia a Markdown. | **Mediano plazo** |
| **P4** | **Simulación de Dados 3D** | Capa visual cosmética opcional sobre los `rolls[]` ya resueltos por `@dungeons/rules`, con toggle en Ajustes y respeto a `reducedMotion`. | **Opcional / Pulido** |
| **P4** | **Visualización espacial ligera (`react-konva` + JSON `(x, y)`)** | Empezar como mapa de escenas/zonas conectadas; escalar a tablero por coordenadas `(x, y)` sobre *Dungeon Scrawl* únicamente cuando el motor v2 esté estable. | **Largo plazo / Evaluar** |
| **P4** | **Multijugador remoto con código de sala** | Sincronización Realtime, permisos por jugador y turnos concurrentes sobre Postgres/Supabase. | **Largo plazo** |

---

## 3. Descartado explícitamente (Qué sale)

- **Pizarra libre (`@excalidraw/excalidraw`):** Bundle pesado, estética incompatible con la geometría recta del sitio e incapacidad de la IA para interpretar trazos libres sin costos altos de visión por turno.
- **VTT táctico completo desde cero:** Reglas milimétricas de línea de visión, casillas y áreas de efecto compiten con VTTs dedicados y deterioran el ritmo narrativo en móvil.
- **Inferencia en vivo con Google Colab (200 CU) + MCP:** Las sesiones efímeras, timeouts e inestabilidad de red de Colab degradan el *tool calling* en tiempo real frente a OpenRouter/DeepSeek. *(Uso válido únicamente offline/batch para generación de packs, assets estáticos o evals.)*
- **Micro-recortes de Fase 5 de `CONTEXT-OPTIMIZATION.md`:** Quitar la tool `suggest_actions` para parsear texto libre u ocultar `knownSpells` al DM introduce fragilidad sin ahorro económico relevante bajo el esquema actual de caché.
