#!/usr/bin/env node
/**
 * PDF -> AdventurePack v1 compiler CLI.
 *
 * Usage:
 *   node scripts/compile-adventure-pdf.mjs <pdfPath> --inspect
 *   node scripts/compile-adventure-pdf.mjs <pdfPath> \
 *     --id la-maldicion-de-strahd-acto-1 \
 *     --title "La Maldición de Strahd · Acto I" \
 *     --pages "5-12,33-48,211-220" \
 *     --out data/packs/la-maldicion-de-strahd-acto-1.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

const SKILLS = [
  "acrobatics",
  "animal_handling",
  "arcana",
  "athletics",
  "deception",
  "history",
  "insight",
  "intimidation",
  "investigation",
  "medicine",
  "nature",
  "perception",
  "performance",
  "persuasion",
  "religion",
  "sleight_of_hand",
  "stealth",
  "survival",
];

function printUsage() {
  console.log(`Uso:
  node scripts/compile-adventure-pdf.mjs <pdfPath> [opciones]

Opciones:
  --inspect                 Analiza páginas, caracteres/página y encabezados detectados
  --id <slug>               ID/slug del pack (a-z, 0-9, -, 3..64 chars)
  --title <titulo>          Título en español para el módulo
  --pages <rangos>          Páginas 1-based a compilar (ej: "5-12,33-48,211-220")
  --bestiary-pages <rangos> Páginas adicionales con bloques de monstruos (opcional)
  --out <ruta>              Ruta de salida JSON (ej: data/packs/mi-campana.json)
  --model <id>              Modelo OpenRouter (default: google/gemini-2.5-flash)
  --ocr <auto|off|gemini>   Estrategia ante páginas escaneadas <50 chars (default: auto)
  --max-scenes <n>          Máximo sugerido de escenas (default: 10)
  --resume                  Reutiliza checkpoints en <out>.work/ si existen
  --help                    Muestra esta ayuda`);
}

function parseArgs(argv) {
  const opts = {
    pdfPath: null,
    inspect: false,
    id: null,
    title: null,
    pages: null,
    bestiaryPages: null,
    out: null,
    model: "google/gemini-2.5-flash",
    ocr: "auto",
    maxScenes: 10,
    resume: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      opts.help = true;
    } else if (arg === "--inspect") {
      opts.inspect = true;
    } else if (arg === "--resume") {
      opts.resume = true;
    } else if (arg === "--id") {
      opts.id = argv[++i] ?? null;
    } else if (arg === "--title") {
      opts.title = argv[++i] ?? null;
    } else if (arg === "--pages") {
      opts.pages = argv[++i] ?? null;
    } else if (arg === "--bestiary-pages") {
      opts.bestiaryPages = argv[++i] ?? null;
    } else if (arg === "--out") {
      opts.out = argv[++i] ?? null;
    } else if (arg === "--model") {
      opts.model = argv[++i] ?? opts.model;
    } else if (arg === "--ocr") {
      opts.ocr = argv[++i] ?? opts.ocr;
    } else if (arg === "--max-scenes") {
      opts.maxScenes = Math.max(4, Math.min(24, Number(argv[++i]) || 10));
    } else if (!arg.startsWith("--") && !opts.pdfPath) {
      opts.pdfPath = arg;
    } else {
      throw new Error(`Argumento desconocido: ${arg}`);
    }
  }
  return opts;
}

function parsePageRanges(spec, maxPage) {
  if (!spec) {
    return Array.from({ length: maxPage }, (_, i) => i + 1);
  }
  const set = new Set();
  for (const part of spec.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (trimmed.includes("-")) {
      const [rawStart, rawEnd] = trimmed.split("-");
      const start = Math.max(1, Number.parseInt(rawStart, 10));
      const end = Math.min(maxPage, Number.parseInt(rawEnd, 10));
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
        throw new Error(`Rango de páginas inválido: "${trimmed}"`);
      }
      for (let p = start; p <= end; p += 1) set.add(p);
    } else {
      const p = Number.parseInt(trimmed, 10);
      if (!Number.isFinite(p) || p < 1 || p > maxPage) {
        throw new Error(`Número de página fuera de rango (1..${maxPage}): "${trimmed}"`);
      }
      set.add(p);
    }
  }
  return Array.from(set).sort((a, b) => a - b);
}

function loadOpenRouterApiKey() {
  if (process.env.OPENROUTER_API_KEY?.trim()) {
    return process.env.OPENROUTER_API_KEY.trim();
  }
  const candidates = [
    path.join(REPO_ROOT, "apps", "web", ".env.local"),
    path.join(REPO_ROOT, ".env.local"),
    path.join(REPO_ROOT, ".env"),
  ];
  for (const envPath of candidates) {
    if (!existsSync(envPath)) continue;
    const raw = readFileSync(envPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = /^OPENROUTER_API_KEY\s*=\s*(.+)$/.exec(trimmed);
      if (match) {
        const val = match[1].trim().replace(/^["']|["']$/g, "");
        if (val) return val;
      }
    }
  }
  return null;
}

function sortColumnItemsIntoLines(items) {
  if (items.length === 0) return "";
  const sorted = [...items].sort((a, b) => {
    const dy = b.y - a.y;
    if (Math.abs(dy) > 3.2) return dy;
    return a.x - b.x;
  });

  const lines = [];
  let currentLine = [];
  let currentY = sorted[0].y;

  for (const item of sorted) {
    if (Math.abs(item.y - currentY) <= 3.2) {
      currentLine.push(item);
    } else {
      lines.push(
        currentLine
          .sort((a, b) => a.x - b.x)
          .map((it) => it.str)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim(),
      );
      currentLine = [item];
      currentY = item.y;
    }
  }
  if (currentLine.length > 0) {
    lines.push(
      currentLine
        .sort((a, b) => a.x - b.x)
        .map((it) => it.str)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
    );
  }
  return lines.filter(Boolean).join("\n");
}

function extractHeadings(items) {
  const heights = items
    .map((it) => it.h)
    .filter((h) => h > 0)
    .sort((a, b) => a - b);
  const median = heights.length > 0 ? heights[Math.floor(heights.length / 2)] : 10;

  const grouped = [];
  const sorted = [...items].sort((a, b) =>
    Math.abs(b.y - a.y) > 3.2 ? b.y - a.y : a.x - b.x,
  );
  let cur = [];
  let curY = sorted[0]?.y ?? 0;
  for (const it of sorted) {
    if (Math.abs(it.y - curY) <= 3.2) {
      cur.push(it);
    } else {
      grouped.push(cur);
      cur = [it];
      curY = it.y;
    }
  }
  if (cur.length > 0) grouped.push(cur);

  const headings = [];
  for (const line of grouped) {
    const text = line
      .sort((a, b) => a.x - b.x)
      .map((i) => i.str)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (text.length < 3 || text.length > 85) continue;
    const maxH = Math.max(...line.map((i) => i.h));
    const isLarger = maxH >= median * 1.24;
    const isChapterLike =
      /^(CAP[ÍI]TULO|CHAPTER|AP[ÉE]NDICE|APPENDIX|INTRODUCCI[ÓO]N|PR[ÓO]LOGO|CASA DE LA MUERTE|DEATH HOUSE|BAROVIA|TSER POOL)/i.test(
        text,
      );
    if (isLarger || isChapterLike) {
      headings.push(text);
    }
  }
  return Array.from(new Set(headings)).slice(0, 6);
}

async function extractPdfPages(pdfPath, pageNumbers) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(readFileSync(pdfPath));
  const loadingTask = pdfjs.getDocument({
    data,
    verbosity: 0,
    isEvalSupported: false,
  });
  const doc = await loadingTask.promise;
  const numPages = doc.numPages;
  const targetPages = pageNumbers
    ? pageNumbers.filter((p) => p >= 1 && p <= numPages)
    : Array.from({ length: numPages }, (_, i) => i + 1);

  const pages = [];
  for (const pageNum of targetPages) {
    const page = await doc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.0 });
    const textContent = await page.getTextContent();
    const rawItems = textContent.items
      .filter((it) => typeof it.str === "string" && it.str.trim().length > 0)
      .map((it) => ({
        str: it.str,
        x: Array.isArray(it.transform) ? it.transform[4] : 0,
        y: Array.isArray(it.transform) ? it.transform[5] : 0,
        h: Math.abs(it.height || (Array.isArray(it.transform) ? it.transform[3] : 10) || 10),
      }));

    const midX = viewport.width * 0.48;
    const leftItems = rawItems.filter((it) => it.x < midX);
    const rightItems = rawItems.filter((it) => it.x >= midX);
    const isTwoColumn =
      rawItems.length >= 20 &&
      leftItems.length >= rawItems.length * 0.18 &&
      rightItems.length >= rawItems.length * 0.18;

    const text = isTwoColumn
      ? `${sortColumnItemsIntoLines(leftItems)}\n\n${sortColumnItemsIntoLines(rightItems)}`
      : sortColumnItemsIntoLines(rawItems);

    const headings = extractHeadings(rawItems);
    pages.push({
      page: pageNum,
      chars: text.length,
      scanned: text.length < 50,
      headings,
      text,
    });
  }

  return { numPages, pages };
}

async function callOpenRouterJson({ apiKey, model, system, user, maxTokens = 16000 }) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://dungeons.local",
      "X-Title": "Dungeons AdventurePack PDF Compiler",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenRouter HTTP ${res.status}: ${errText.slice(0, 400)}`);
  }

  const payload = await res.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("OpenRouter devolvió respuesta vacía.");
  }

  const cleaned = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  return JSON.parse(cleaned);
}

function slugifyId(raw, fallback) {
  const base = String(raw || fallback || "item")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return base || fallback || "item";
}

function normalizePackSlug(raw, fallback) {
  const slug = String(raw || fallback || "custom-adventure")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug.length >= 3 ? slug : "custom-adventure";
}

function clampInt(n, min, max, fallback) {
  const num = Number(n);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.round(num)));
}

function repairAdventurePackShape(raw, { id, title }) {
  const pack = raw && typeof raw === "object" ? { ...raw } : {};
  pack.schemaVersion = 1;
  pack.id = normalizePackSlug(id || pack.id, "custom-adventure");
  pack.titleEs = String(title || pack.titleEs || "Aventura Importada").trim();
  pack.worldSummaryEs =
    String(pack.worldSummaryEs || "Aventura de fantasía oscura D&D 5e.").trim();
  pack.tonePromptEs =
    String(
      pack.tonePromptEs ||
        "Horror gótico y fantasía oscura con tensión sostenida, dilemas morales y peligro tangible.",
    ).trim();
  pack.recommendedRuleset =
    pack.recommendedRuleset === "5e-lite" ? "5e-lite" : "5e-full";

  if (pack.recommendedLevels) {
    const min = clampInt(pack.recommendedLevels.min, 1, 20, 1);
    const max = clampInt(pack.recommendedLevels.max, min, 20, Math.max(min, 3));
    pack.recommendedLevels = { min, max };
  } else {
    pack.recommendedLevels = { min: 1, max: 3 };
  }

  // Normalize scenes
  const rawScenes = Array.isArray(pack.scenes)
    ? Object.fromEntries(pack.scenes.map((s) => [s.id || s.titleEs, s]))
    : pack.scenes && typeof pack.scenes === "object"
      ? pack.scenes
      : {};

  const sceneEntries = Object.entries(rawScenes);
  const idMap = new Map();
  const normalizedScenes = {};
  const seenClueIds = new Set();

  for (let idx = 0; idx < sceneEntries.length; idx += 1) {
    const [origKey, sc] = sceneEntries[idx];
    if (!sc || typeof sc !== "object") continue;
    const cleanId = slugifyId(sc.id || origKey, `escena_${idx + 1}`);
    idMap.set(origKey, cleanId);
    if (sc.id) idMap.set(sc.id, cleanId);
  }

  const validMappedIds = new Set(idMap.values());

  for (let idx = 0; idx < sceneEntries.length; idx += 1) {
    const [origKey, sc] = sceneEntries[idx];
    if (!sc || typeof sc !== "object") continue;
    const cleanId = idMap.get(origKey);
    const clues = Array.isArray(sc.clues)
      ? sc.clues.slice(0, 4).map((clue, cIdx) => {
          let clueId = slugifyId(
            clue.id,
            `${cleanId}_pista_${cIdx + 1}`,
          );
          while (seenClueIds.has(clueId)) {
            clueId = `${clueId}_${seenClueIds.size + 1}`;
          }
          seenClueIds.add(clueId);
          return {
            id: clueId,
            dc: clampInt(clue.dc, 5, 30, 12),
            titleEs: String(clue.titleEs || `Pista ${cIdx + 1}`).trim(),
            descriptionEs: String(
              clue.descriptionEs || "Indicio relevante descubierto en la escena.",
            ).trim(),
            tacticalEffectEs: String(
              clue.tacticalEffectEs ||
                "Aporta información clave o ventaja táctica para avanzar en el acto.",
            ).trim(),
          };
        })
      : [];

    const allowedTransitions = Array.isArray(sc.allowedTransitions)
      ? Array.from(
          new Set(
            sc.allowedTransitions
              .map((t) => idMap.get(t) ?? slugifyId(t, ""))
              .filter((t) => t && t !== cleanId && validMappedIds.has(t)),
          ),
        )
      : [];

    const cleanScene = {
      id: cleanId,
      titleEs: String(sc.titleEs || `Escena ${idx + 1}`).trim(),
      shortLabelEs: String(
        sc.shortLabelEs || String(sc.titleEs || cleanId).slice(0, 24),
      ).trim(),
      baseTension: clampInt(sc.baseTension, 5, 95, Math.min(85, 18 + idx * 8)),
      summaryEs: String(
        sc.summaryEs || "Escena clave del Acto I.",
      ).trim(),
      narrativeHookEs: String(
        sc.narrativeHookEs || sc.summaryEs || "El entorno aguarda tu primer paso.",
      ).trim(),
      allowedTransitions,
      clues,
    };
    if (sc.transitionRequirements && typeof sc.transitionRequirements === "object") {
      const cleanedReqs = {};
      for (const [targetKey, req] of Object.entries(sc.transitionRequirements)) {
        const mappedTarget = idMap.get(targetKey);
        if (!mappedTarget || !cleanScene.allowedTransitions.includes(mappedTarget)) {
          continue;
        }
        const entry = {};
        if (Array.isArray(req.requiredClues) && req.requiredClues.length > 0) {
          const validClues = req.requiredClues.filter((cid) => seenClueIds.has(cid));
          if (validClues.length > 0) entry.requiredClues = validClues;
        }
        if (Array.isArray(req.requiredFlags) && req.requiredFlags.length > 0) {
          entry.requiredFlags = req.requiredFlags.map((f) => String(f));
        }
        if (Object.keys(entry).length > 0) {
          cleanedReqs[mappedTarget] = entry;
        }
      }
      if (Object.keys(cleanedReqs).length > 0) {
        cleanScene.transitionRequirements = cleanedReqs;
      }
    }
    normalizedScenes[cleanId] = cleanScene;
  }

  const allSceneIds = Object.keys(normalizedScenes);
  const rawInitial = idMap.get(pack.initialSceneId) ?? pack.initialSceneId;
  pack.initialSceneId =
    rawInitial && normalizedScenes[rawInitial] ? rawInitial : allSceneIds[0];

  const mappedEpilogues = Array.isArray(pack.epilogueSceneIds)
    ? pack.epilogueSceneIds
        .map((eid) => idMap.get(eid) ?? eid)
        .filter((eid) => Boolean(normalizedScenes[eid]))
    : [];
  pack.epilogueSceneIds =
    mappedEpilogues.length > 0 ? mappedEpilogues : [allSceneIds.at(-1)];
  for (const epId of pack.epilogueSceneIds) {
    if (normalizedScenes[epId]) {
      normalizedScenes[epId].allowedTransitions = [];
      delete normalizedScenes[epId].transitionRequirements;
    }
  }

  for (const sc of Object.values(normalizedScenes)) {
    sc.allowedTransitions = sc.allowedTransitions.filter(
      (t) => Boolean(normalizedScenes[t]) && t !== sc.id,
    );
  }

  // Ensure every scene is reachable from initialSceneId via BFS
  const visited = new Set([pack.initialSceneId]);
  const queue = [pack.initialSceneId];
  while (queue.length > 0) {
    const cur = queue.shift();
    for (const next of normalizedScenes[cur]?.allowedTransitions ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  const epilogueSet = new Set(pack.epilogueSceneIds);
  let lastNonEpilogue =
    allSceneIds.find((sid) => visited.has(sid) && !epilogueSet.has(sid)) ??
    pack.initialSceneId;
  for (const sid of allSceneIds) {
    if (!visited.has(sid)) {
      if (
        normalizedScenes[lastNonEpilogue] &&
        !epilogueSet.has(lastNonEpilogue) &&
        lastNonEpilogue !== sid
      ) {
        normalizedScenes[lastNonEpilogue].allowedTransitions.push(sid);
        visited.add(sid);
        if (!epilogueSet.has(sid)) lastNonEpilogue = sid;
      }
    }
  }

  pack.scenes = normalizedScenes;

  // Normalize quest (MainQuestSpecSchema)
  const q = pack.quest && typeof pack.quest === "object" ? pack.quest : {};
  const stages = Array.isArray(q.stages) && q.stages.length > 0
    ? q.stages.map((st, idx) => {
        const mappedScenes = (
          Array.isArray(st.sceneIds)
            ? st.sceneIds
            : Array.isArray(st.completedInScenes)
              ? st.completedInScenes
              : []
        )
          .map((s) => idMap.get(s) ?? s)
          .filter((s) => Boolean(normalizedScenes[s]));
        return {
          id: slugifyId(st.id, `stage_${idx + 1}`),
          order: idx + 1,
          titleEs: String(st.titleEs || `Etapa ${idx + 1}`).trim(),
          goalEs: String(st.goalEs || st.summaryEs || "Avanzar en el Acto I.").trim(),
          sceneIds:
            mappedScenes.length > 0
              ? mappedScenes
              : [allSceneIds[Math.min(idx, allSceneIds.length - 1)]],
          actTitleEs: String(st.actTitleEs || `Acto I · Parte ${idx + 1}`).trim(),
          dramaticBeatEs: String(st.dramaticBeatEs || "Tensión creciente.").trim(),
        };
      })
    : [
        {
          id: "stage_inicio",
          order: 1,
          titleEs: "Cruzar las Brumas",
          goalEs: "Sobrevivir al umbral inicial de la aventura.",
          sceneIds: [pack.initialSceneId],
          actTitleEs: "Acto I · Inicio",
          dramaticBeatEs: "Las brumas se cierran detrás del grupo.",
        },
        {
          id: "stage_epilogo",
          order: 2,
          titleEs: "Cierre del Acto I",
          goalEs: "Alcanzar el desenlace del acto.",
          sceneIds: [pack.epilogueSceneIds[0]],
          actTitleEs: "Acto I · Desenlace",
          dramaticBeatEs: "El destino en Barovia queda trazado.",
        },
      ];

  const endingsRaw = Array.isArray(q.endings) && q.endings.length > 0
    ? q.endings
    : [
        {
          id: "ending_standard",
          titleEs: "Sobrevivir al Acto I",
          summaryEs: "El grupo supera los horrores iniciales y abre camino hacia Barovia.",
          isStandard: true,
          requiredClueGroups: [],
          hintEs: "Completá el recorrido hasta la escena de epílogo.",
        },
      ];
  const hasStandard = endingsRaw.some((e) => e.isStandard);
  const endings = endingsRaw.map((e, idx) => {
    const groups = Array.isArray(e.requiredClueGroups)
      ? e.requiredClueGroups
          .map((g) => (Array.isArray(g) ? g.filter((cid) => seenClueIds.has(cid)) : []))
          .filter((g) => g.length > 0)
      : [];
    return {
      id: slugifyId(e.id, `ending_${idx + 1}`),
      titleEs: String(e.titleEs || `Final ${idx + 1}`).trim(),
      summaryEs: String(e.summaryEs || "Desenlace de la campaña.").trim(),
      isStandard: Boolean(e.isStandard || (!hasStandard && idx === 0)),
      requiredClueGroups: groups,
      hintEs: String(e.hintEs || "Investigá las pistas principales del acto.").trim(),
    };
  });

  pack.quest = {
    id: slugifyId(q.id || pack.id, "quest_main"),
    titleEs: String(q.titleEs || pack.titleEs).trim(),
    objectiveEs: String(
      q.objectiveEs || "Sobrevivir a las brumas, descubrir los secretos iniciales y decidir el destino del grupo.",
    ).trim(),
    stages,
    endings,
  };

  // Normalize intro
  const rawIntro = pack.intro && typeof pack.intro === "object" ? pack.intro : {};
  const soloP =
    Array.isArray(rawIntro.soloParagraphsEs) && rawIntro.soloParagraphsEs.length > 0
      ? rawIntro.soloParagraphsEs.map((p) => String(p).trim()).filter(Boolean)
      : [
          `${pack.worldSummaryEs}`,
          `La niebla helada se cierra a tu alrededor, {{charName}}. ¿Qué hacés?`,
        ];
  const groupP =
    Array.isArray(rawIntro.groupParagraphsEs) && rawIntro.groupParagraphsEs.length > 0
      ? rawIntro.groupParagraphsEs.map((p) => String(p).trim()).filter(Boolean)
      : [
          `${pack.worldSummaryEs}`,
          `La niebla helada envuelve a **{{partyNames}}**. La iniciativa es suya: ¿qué hacen?`,
        ];
  const rawSug =
    Array.isArray(rawIntro.suggestedActions) && rawIntro.suggestedActions.length >= 3
      ? rawIntro.suggestedActions.slice(0, 3)
      : [
          {
            skill: "Percepción",
            tone: "blue",
            label: "Observar los alrededores entre la bruma antes de avanzar",
          },
          {
            skill: "Investigación",
            tone: "violet",
            label: "Examinar rastros, puertas o señales cercanas",
          },
          {
            skill: "Sigilo",
            tone: "emerald",
            label: "Avanzar cubriéndose sin llamar la atención",
          },
        ];
  pack.intro = {
    soloParagraphsEs: soloP,
    groupParagraphsEs: groupP,
    suggestedActions: rawSug.map((a) => ({
      skill: String(a.skill || "Percepción").trim(),
      tone: ["blue", "emerald", "violet", "amber", "rose"].includes(a.tone)
        ? a.tone
        : "blue",
      label: String(a.label || "Explorar la escena").trim(),
    })),
  };

  // Normalize bestiary (AdventureCreatureSchema)
  const seenCreatures = new Set();
  pack.bestiary = (Array.isArray(pack.bestiary) ? pack.bestiary : [])
    .map((c, idx) => {
      let cid = slugifyId(c.id || c.nameEs, `criatura_${idx + 1}`);
      while (seenCreatures.has(cid)) cid = `${cid}_${seenCreatures.size + 1}`;
      seenCreatures.add(cid);
      const ab = c.abilities && typeof c.abilities === "object" ? c.abilities : {};
      const attacks =
        Array.isArray(c.attacks) && c.attacks.length > 0
          ? c.attacks.map((atk, aIdx) => ({
              id: slugifyId(atk.id || atk.nameEs, `atk_${aIdx + 1}`),
              nameEs: String(atk.nameEs || "Ataque").trim(),
              kind: atk.kind === "ranged" ? "ranged" : "melee",
              attackBonus: clampInt(atk.attackBonus, -5, 20, 4),
              damageDice: /^\d+d\d+([+-]\d+)?$/i.test(String(atk.damageDice || ""))
                ? String(atk.damageDice)
                : "1d6+2",
              damageType: String(atk.damageType || "cortante").trim(),
              rangeText: String(
                atk.rangeText ||
                  (atk.kind === "ranged" ? "distancia (30/90 pies)" : "cuerpo a cuerpo (5 pies)"),
              ).trim(),
            }))
          : [
              {
                id: "golpe",
                nameEs: "Golpe",
                kind: "melee",
                attackBonus: 4,
                damageDice: "1d6+2",
                damageType: "contundente",
                rangeText: "cuerpo a cuerpo (5 pies)",
              },
            ];
      const traitsEs = Array.isArray(c.traitsEs)
        ? c.traitsEs.map((t) => String(t).trim()).filter(Boolean)
        : c.notesEs
          ? [String(c.notesEs).trim()]
          : [];
      return {
        id: cid,
        nameEs: String(c.nameEs || `Criatura ${idx + 1}`).trim(),
        srdBaseIndex: String(c.srdBaseIndex || "custom").trim(),
        cr: Math.max(0, Number(c.cr) || 0.5),
        ac: clampInt(c.ac, 5, 30, 12),
        hp: clampInt(c.hp, 1, 500, 18),
        speedTextEs: String(c.speedTextEs || "30 pies").trim(),
        abilities: {
          str: clampInt(ab.str, 1, 30, 12),
          dex: clampInt(ab.dex, 1, 30, 12),
          con: clampInt(ab.con, 1, 30, 12),
          int: clampInt(ab.int, 1, 30, 10),
          wis: clampInt(ab.wis, 1, 30, 10),
          cha: clampInt(ab.cha, 1, 30, 10),
        },
        skills: {},
        vulnerabilities: Array.isArray(c.vulnerabilities)
          ? c.vulnerabilities.map(String).filter(Boolean)
          : [],
        immunities: Array.isArray(c.immunities)
          ? c.immunities.map(String).filter(Boolean)
          : [],
        ...(Array.isArray(c.resistances) && c.resistances.length > 0
          ? { resistances: c.resistances.map(String).filter(Boolean) }
          : {}),
        traitsEs,
        attacks,
      };
    })
    .filter(Boolean);

  // Normalize lorebook (AdventureLorebookEntrySchema)
  const seenLore = new Set();
  const loreCats = ["faction", "location", "npc", "creature", "world", "item"];
  const catMap = {
    lugar: "location",
    faccion: "faction",
    historia: "world",
    objeto: "item",
    regla_local: "world",
  };
  pack.lorebook = (Array.isArray(pack.lorebook) ? pack.lorebook : []).map((l, idx) => {
    let lid = slugifyId(l.id || l.titleEs, `lore_${idx + 1}`);
    while (seenLore.has(lid)) lid = `${lid}_${seenLore.size + 1}`;
    seenLore.add(lid);
    const mappedCat = catMap[l.category] ?? l.category;
    const rawScenes = Array.isArray(l.activeSceneIds)
      ? l.activeSceneIds
      : Array.isArray(l.sceneIds)
        ? l.sceneIds
        : [];
    const activeSceneIds = rawScenes
      .map((s) => idMap.get(s) ?? s)
      .filter((s) => Boolean(normalizedScenes[s]));
    return {
      id: lid,
      titleEs: String(l.titleEs || `Nota ${idx + 1}`).trim(),
      category: loreCats.includes(mappedCat) ? mappedCat : "location",
      keywords:
        Array.isArray(l.keywords) && l.keywords.length > 0
          ? l.keywords.map((k) => String(k).toLowerCase()).filter(Boolean)
          : [String(l.titleEs || lid).toLowerCase()],
      ...(activeSceneIds.length > 0 ? { activeSceneIds } : {}),
      priority: clampInt(l.priority, 1, 100, 60),
      contentEs:
        String(l.contentEs || "").trim() ||
        String(l.titleEs || "Detalle de trasfondo."),
    };
  });

  // Normalize npcMinds (NpcMindTemplateSchema)
  const seenNpcs = new Set();
  pack.npcMinds = (Array.isArray(pack.npcMinds) ? pack.npcMinds : []).map((n, idx) => {
    let nid = slugifyId(n.id || n.nameEs, `npc_${idx + 1}`);
    while (seenNpcs.has(nid)) nid = `${nid}_${seenNpcs.size + 1}`;
    seenNpcs.add(nid);
    const rawNpcScenes = Array.isArray(n.activeSceneIds)
      ? n.activeSceneIds
      : Array.isArray(n.sceneIds)
        ? n.sceneIds
        : [];
    const activeSceneIds = rawNpcScenes
      .map((s) => idMap.get(s) ?? s)
      .filter((s) => Boolean(normalizedScenes[s]));
    const nameTokens = String(n.nameEs || "")
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length >= 3);
    const triggerKeywords =
      Array.isArray(n.triggerKeywords) && n.triggerKeywords.length > 0
        ? n.triggerKeywords.map(String).filter(Boolean)
        : nameTokens.length > 0
          ? nameTokens
          : [nid];
    return {
      id: nid,
      nameEs: String(n.nameEs || `PNJ ${idx + 1}`).trim(),
      roleEs: String(n.roleEs || "Habitante").trim(),
      activeSceneIds:
        activeSceneIds.length > 0 ? activeSceneIds : [pack.initialSceneId],
      triggerKeywords,
      knowsEs: String(n.knowsEs || "Conoce los rumores locales de la zona.").trim(),
      doesNotKnowEs: String(
        n.doesNotKnowEs || "Ignora los planes exactos de los aventureros.",
      ).trim(),
      wantsEs: String(
        n.wantsEs || "Sobrevivir sin atraer atención innecesaria.",
      ).trim(),
      hidesEs: String(
        n.hidesEs || "Miedo y desconfianza hacia los recién llegados.",
      ).trim(),
      defaultAttitudeEs: String(n.defaultAttitudeEs || "cauteloso").trim(),
    };
  });

  return pack;
}

const COMPILER_SYSTEM_PROMPT = `Sos un arquitecto de juegos D&D 5e (SRD 5.2.1) encargado de compilar páginas reales de un módulo en PDF hacia JSON estricto \`AdventurePack\` v1 en español rioplatense/neutro.

Reglas estrictas del output JSON:
1. Devuelve ÚNICAMENTE un objeto JSON válido con estas claves exactas en nivel superior:
   - \`schemaVersion\`: 1
   - \`id\`: slug indicado por el usuario
   - \`titleEs\`, \`subtitleEs\`, \`worldSummaryEs\`, \`tonePromptEs\`
   - \`recommendedLevels\`: { "min": number, "max": number }
   - \`recommendedRuleset\`: "5e-full" | "5e-lite"
   - \`initialSceneId\`: string (clave dentro de \`scenes\`)
   - \`epilogueSceneIds\`: string[] (claves dentro de \`scenes\` SIN transiciones salientes \`allowedTransitions: []\`)
   - \`scenes\`: diccionario { [sceneId]: { id, titleEs, shortLabelEs, baseTension (5-95), summaryEs, narrativeHookEs, allowedTransitions: string[], transitionRequirements?: { [targetSceneId]: { requiredClues?: string[], requiredFlags?: string[] } }, clues: [{ id, dc (5-30), titleEs, descriptionEs, tacticalEffectEs }] } }
   - \`quest\`: { id, titleEs, objectiveEs, stages: [{ id, order (1..N), titleEs, goalEs, sceneIds: string[], actTitleEs, dramaticBeatEs }], endings: [{ id, titleEs, summaryEs, isStandard: boolean, requiredClueGroups: string[][], hintEs }] }
   - \`intro\`: { soloParagraphsEs: [string, string con {{charName}}], groupParagraphsEs: [string, string con {{partyNames}}], suggestedActions: exactamente 3 items { skill, tone: "blue"|"emerald"|"violet"|"amber", label } }
   - \`bestiary\`: array de criaturas del módulo { id, nameEs, srdBaseIndex, cr, ac, hp, speedTextEs, abilities: { str, dex, con, int, wis, cha }, skills: {}, vulnerabilities: [], immunities: [], traitsEs: string[], attacks: [{ id, nameEs, kind: "melee"|"ranged", attackBonus, damageDice ("NdM+K"), damageType, rangeText }] }
   - \`lorebook\`: array de 6-14 entradas { id, titleEs, category: "location"|"faction"|"npc"|"creature"|"world"|"item", keywords: string[], activeSceneIds?: string[], priority: 1..100, contentEs }
   - \`npcMinds\`: array de 3-8 NPCs con información compartimentada { id, nameEs, roleEs, activeSceneIds: string[], triggerKeywords: string[], knowsEs, doesNotKnowEs, wantsEs, hidesEs, defaultAttitudeEs }
2. Grafo limpio:
   - TODAS las escenas en \`scenes\` deben ser alcanzables desde \`initialSceneId\` siguiendo \`allowedTransitions\`.
   - Toda \`epilogueSceneIds\` debe tener \`allowedTransitions: []\`.
   - Los IDs de pistas (\`clues[].id\`) deben ser únicos en toda la aventura.
   - NO inventes mecánicas incompatibles ni ataques sin \`damageDice\` válido (\`1d8+3\`, \`2d6+2\`, etc.).
3. Respetá fielmente los lugares, personajes, pistas, monstruos y tono del texto del PDF provisto. Sé conciso y directo en los textos (\`summaryEs\` 2–3 oraciones, \`narrativeHookEs\` 1–2 oraciones, \`contentEs\` 1–2 oraciones; 8–10 escenas clave, 1–2 pistas por escena, 5–8 criaturas representativas, 6–8 lorebook, 4–6 \`npcMinds\`) para que el JSON completo resulte ágil, denso y menor a 22 KB.`;

async function loadRulesValidators() {
  const distPath = path.join(REPO_ROOT, "packages", "rules", "dist", "index.js");
  if (!existsSync(distPath)) {
    throw new Error(
      "Falta packages/rules/dist/index.js. Ejecutá `pnpm.cmd --filter @dungeons/rules build` primero.",
    );
  }
  const mod = await import(pathToFileURL(distPath).href);
  return {
    AdventurePackSchema: mod.AdventurePackSchema,
    validateAdventurePackGraph: mod.validateAdventurePackGraph,
  };
}

async function runInspect(pdfPath) {
  console.log(`Inspeccionando PDF: ${pdfPath}`);
  const { numPages, pages } = await extractPdfPages(pdfPath, null);
  const totalChars = pages.reduce((s, p) => s + p.chars, 0);
  const scannedCount = pages.filter((p) => p.scanned).length;
  console.log(
    `Total páginas: ${numPages} | Promedio chars/página: ${Math.round(totalChars / Math.max(1, numPages))} | Páginas escaneadas (<50 chars): ${scannedCount}`,
  );
  console.log("\nÍndice por encabezados detectados (1-based):");
  for (const p of pages) {
    if (p.headings.length > 0 || p.page <= 15) {
      const sample = p.headings.length > 0 ? p.headings.join(" · ") : "(sin encabezados grandes)";
      console.log(`  p.${String(p.page).padStart(3, " ")} (${String(p.chars).padStart(4, " ")} chars): ${sample}`);
    }
  }
}

async function distillChunkIfNeeded({ apiKey, model, chunkText, index, total, workDir, resume }) {
  const cachePath = path.join(workDir, `distill_${index}.txt`);
  if (resume && existsSync(cachePath)) {
    return readFileSync(cachePath, "utf8");
  }
  console.log(`Destilando bloque ${index}/${total} (${chunkText.length} chars)…`);
  const parsed = await callOpenRouterJson({
    apiKey,
    model,
    maxTokens: 7000,
    system:
      "Sos un asistente de diseño de juegos D&D 5e. Extraé en español un resumen estructurado JSON con: { lugaresClaves, escenasSugeridas, pistasConCD, npcsConMotivacion, monstruosConStats, loreRelevante } conservando nombres propios exactos, CDs, objetos, monstruos y estadísticas del fragmento.",
    user: chunkText,
  });
  const formatted = JSON.stringify(parsed, null, 2);
  writeFileSync(cachePath, formatted, "utf8");
  return formatted;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.pdfPath) {
    printUsage();
    process.exit(opts.help ? 0 : 1);
  }

  const pdfPath = path.resolve(opts.pdfPath);
  if (!existsSync(pdfPath)) {
    console.error(`No existe el PDF: ${pdfPath}`);
    process.exit(1);
  }

  if (opts.inspect) {
    await runInspect(pdfPath);
    return;
  }

  if (!opts.id || !opts.out) {
    console.error("Para compilar necesitás --id <slug> y --out <ruta>. Usá --help.");
    process.exit(1);
  }

  const apiKey = loadOpenRouterApiKey();
  if (!apiKey) {
    console.error(
      "Falta OPENROUTER_API_KEY en el entorno o en apps/web/.env.local.",
    );
    process.exit(1);
  }

  const { AdventurePackSchema, validateAdventurePackGraph } =
    await loadRulesValidators();

  const outPath = path.resolve(opts.out);
  const workDir = `${outPath}.work`;
  mkdirSync(path.dirname(outPath), { recursive: true });
  mkdirSync(workDir, { recursive: true });

  const extractCache = path.join(workDir, "extracted.json");
  let extracted;
  if (opts.resume && existsSync(extractCache)) {
    extracted = JSON.parse(readFileSync(extractCache, "utf8"));
  } else {
    const probe = await extractPdfPages(pdfPath, [1]);
    const mainPages = parsePageRanges(opts.pages, probe.numPages);
    const extraPages = opts.bestiaryPages
      ? parsePageRanges(opts.bestiaryPages, probe.numPages)
      : [];
    const combinedPages = Array.from(new Set([...mainPages, ...extraPages])).sort(
      (a, b) => a - b,
    );
    console.log(
      `Extrayendo ${combinedPages.length} páginas seleccionadas de ${probe.numPages} totales…`,
    );
    extracted = await extractPdfPages(pdfPath, combinedPages);
    writeFileSync(extractCache, JSON.stringify(extracted, null, 2), "utf8");
  }

  const scannedPages = extracted.pages.filter((p) => p.scanned);
  if (scannedPages.length > 0) {
    console.warn(
      `Aviso: ${scannedPages.length}/${extracted.pages.length} páginas tienen <50 chars (${scannedPages.map((p) => p.page).join(", ")}).`,
    );
    if (opts.ocr === "off" && scannedPages.length === extracted.pages.length) {
      throw new Error("PDF completamente escaneado y --ocr off activado.");
    }
  }

  const combinedText = extracted.pages
    .map((p) => `--- PÁGINA ${p.page} ---\n${p.text}`)
    .join("\n\n");

  let sourceForSynthesis = combinedText;
  if (combinedText.length > 105000) {
    const chunks = [];
    let current = "";
    for (const pageObj of extracted.pages) {
      const block = `--- PÁGINA ${pageObj.page} ---\n${pageObj.text}\n\n`;
      if (current.length + block.length > 36000 && current.length > 0) {
        chunks.push(current);
        current = "";
      }
      current += block;
    }
    if (current.trim()) chunks.push(current);

    const distilled = [];
    for (let i = 0; i < chunks.length; i += 1) {
      distilled.push(
        await distillChunkIfNeeded({
          apiKey,
          model: opts.model,
          chunkText: chunks[i],
          index: i + 1,
          total: chunks.length,
          workDir,
          resume: opts.resume,
        }),
      );
    }
    sourceForSynthesis = distilled
      .map((d, idx) => `### BLOQUE DESTILADO ${idx + 1}\n${d}`)
      .join("\n\n");
  }

  const draftCache = path.join(workDir, "draft_pack.json");
  let rawDraft;
  if (opts.resume && existsSync(draftCache)) {
    rawDraft = JSON.parse(readFileSync(draftCache, "utf8"));
  } else {
    console.log(
      `Compilando AdventurePack "${opts.id}" con modelo ${opts.model} (${sourceForSynthesis.length} chars de contexto)…`,
    );
    rawDraft = await callOpenRouterJson({
      apiKey,
      model: opts.model,
      maxTokens: 32000,
      system: COMPILER_SYSTEM_PROMPT,
      user: `Compilá este contenido en un AdventurePack v1 autocontenido, con ritmo ágil estilo Acto I / one-shot (${opts.maxScenes} escenas conectadas aprox., entre ellas 1–2 escenas finales epílogo).
ID requerido: "${opts.id}"
Título requerido: "${opts.title || opts.id}"

MATERIAL DEL PDF:
${sourceForSynthesis}`,
    });
    writeFileSync(draftCache, JSON.stringify(rawDraft, null, 2), "utf8");
  }

  let candidate = repairAdventurePackShape(rawDraft, {
    id: opts.id,
    title: opts.title,
  });

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const zodResult = AdventurePackSchema.safeParse(candidate);
    const graphResult = zodResult.success
      ? validateAdventurePackGraph(zodResult.data)
      : { valid: false, errors: ["Schema previo fallido"] };

    if (zodResult.success && graphResult.valid) {
      writeFileSync(outPath, `${JSON.stringify(zodResult.data, null, 2)}\n`, "utf8");
      const sceneCount = Object.keys(zodResult.data.scenes).length;
      const clueCount = Object.values(zodResult.data.scenes).reduce(
        (sum, s) => sum + s.clues.length,
        0,
      );
      console.log(
        `OK: Pack compilado y validado en ${outPath} (${sceneCount} escenas, ${clueCount} pistas, ${zodResult.data.bestiary.length} criaturas, ${zodResult.data.lorebook.length} lorebook, ${zodResult.data.npcMinds.length} NPCs).`,
      );
      return;
    }

    const errors = [
      ...(zodResult.success
        ? []
        : zodResult.error.issues.map(
            (iss) => `SCHEMA ${iss.path.join(".")}: ${iss.message}`,
          )),
      ...(graphResult.valid ? [] : graphResult.errors.map((e) => `GRAPH: ${e}`)),
    ];
    console.warn(`Intento de reparación ${attempt}/2 por ${errors.length} errores…`);
    const repaired = await callOpenRouterJson({
      apiKey,
      model: opts.model,
      maxTokens: 16000,
      system: COMPILER_SYSTEM_PROMPT,
      user: `Corregí los siguientes errores de validación en este JSON AdventurePack v1 sin perder escenas, pistas ni bestiario:
ERRORES:
${errors.join("\n")}

JSON ACTUAL:
${JSON.stringify(candidate)}`,
    });
    candidate = repairAdventurePackShape(repaired, {
      id: opts.id,
      title: opts.title,
    });
  }

  const finalZod = AdventurePackSchema.safeParse(candidate);
  const finalGraph = finalZod.success
    ? validateAdventurePackGraph(finalZod.data)
    : { valid: false, errors: [] };
  console.error("Error de validación tras reintentos:");
  if (!finalZod.success) {
    for (const iss of finalZod.error.issues.slice(0, 12)) {
      console.error(`  - ${iss.path.join(".")}: ${iss.message}`);
    }
  }
  if (!finalGraph.valid) {
    for (const err of finalGraph.errors) {
      console.error(`  - ${err}`);
    }
  }
  process.exit(1);
}

main().catch((err) => {
  console.error("Fallo del compilador:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
