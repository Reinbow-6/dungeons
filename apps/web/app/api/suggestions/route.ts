import { getCheckModifier, type Skill } from "@dungeons/rules";
import { generateText } from "ai";
import { z } from "zod";

import { resolveLanguageModel } from "@/lib/ai/provider";
import { resolveGuestSessionFromRequest } from "@/lib/auth/guest-session";
import { getDefaultGameStore } from "@/lib/game/store";
import { serverErrorResponse } from "@/lib/http/errors";
import { GUEST_DEFAULT_MODEL } from "@/lib/models";

export const runtime = "nodejs";

const RequestSchema = z.object({
  campaignId: z.string().min(1),
  category: z.enum(["general", "social", "fight", "travel"]).default("general"),
  lastDmText: z.string().max(1500).optional(),
});

const SKILL_LABELS_ES: Record<Skill, string> = {
  acrobatics: "Acrobacias",
  animal_handling: "Trato con Animales",
  arcana: "Arcano",
  athletics: "Atletismo",
  deception: "Engaño",
  history: "Historia",
  insight: "Perspicacia",
  intimidation: "Intimidación",
  investigation: "Investigación",
  medicine: "Medicina",
  nature: "Naturaleza",
  perception: "Percepción",
  performance: "Interpretación",
  persuasion: "Persuasión",
  religion: "Religión",
  sleight_of_hand: "Juego de Manos",
  stealth: "Sigilo",
  survival: "Supervivencia",
};

const CATEGORY_SKILLS: Record<
  "general" | "social" | "fight" | "travel",
  readonly Skill[]
> = {
  general: [
    "perception",
    "insight",
    "persuasion",
    "investigation",
    "medicine",
    "stealth",
    "survival",
    "arcana",
    "athletics",
  ],
  social: ["persuasion", "insight", "deception", "intimidation", "performance"],
  fight: ["athletics", "acrobatics", "intimidation", "stealth", "perception"],
  travel: ["perception", "investigation", "survival", "stealth", "nature"],
};

export interface SparkleSuggestionItem {
  skill: string;
  modifier: number;
  label: string;
}

function buildFallbackSuggestions(
  category: "general" | "social" | "fight" | "travel",
  topSkills: Array<{ skill: Skill; label: string; modifier: number }>,
): SparkleSuggestionItem[] {
  const templates: Record<Skill, string> = {
    medicine: "Examinar heridas, signos de agotamiento o rastros de veneno cercanos.",
    insight: "Leer las intenciones reales y el lenguaje corporal de quienes tenés delante.",
    persuasion: "Buscar un punto en común y negociar sin escalar la violencia.",
    perception: "Escudriñar los alrededores en busca de movimientos o emboscadas.",
    investigation: "Inspeccionar el terreno y los detalles físicos en busca de pistas.",
    stealth: "Moverte en silencio aprovechando la cobertura y la niebla.",
    survival: "Seguir rastros recientes y evaluar los peligros del entorno.",
    arcana: "Detectar residuos mágicos o auras arcanas en la escena.",
    athletics: "Tomar posición ventajosa o forzar un obstáculo físico.",
    acrobatics: "Maniobrar con agilidad para esquivar o ganar terreno.",
    intimidation: "Imponer presencia y exigir respuestas directas.",
    deception: "Desviar la atención con una coartada verosímil.",
    performance: "Captar la atención del grupo con un gesto calculado.",
    history: "Recordar precedentes históricos o emblemas de la región.",
    nature: "Identificar flora, fauna o cambios climáticos en la ciénaga.",
    religion: "Reconocer símbolos sagrados o ritos de la zona.",
    animal_handling: "Calmar o guiar a las bestias cercanas.",
    sleight_of_hand: "Manipular o sustraer un objeto pequeño sin ser visto.",
  };

  return topSkills.slice(0, 3).map((item) => ({
    skill: item.label,
    modifier: item.modifier,
    label:
      templates[item.skill] ??
      (category === "fight"
        ? "Ejecutar una maniobra táctica aprovechando tu mejor aptitud."
        : "Actuar con cautela usando tu mejor aptitud."),
  }));
}

export async function POST(req: Request) {
  let guest;
  try {
    guest = resolveGuestSessionFromRequest(req);
  } catch (err) {
    return serverErrorResponse({
      route: "/api/suggestions",
      err,
      publicMessageEs: "Error interno al verificar la sesión.",
      status: 500,
      errorCode: "SESSION_ERROR",
    });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { ok: false, error: "JSON inválido." },
      { status: 400 },
    );
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: "Parámetros inválidos." },
      { status: 400 },
    );
  }

  const store = getDefaultGameStore();
  const loaded = await store.loadCampaign(parsed.data.campaignId, guest.guestId);
  if (!loaded) {
    return Response.json(
      { ok: false, error: "Campaña no encontrada." },
      { status: 404 },
    );
  }

  const activeChar = Object.values(loaded.state.characters)[0];
  if (!activeChar) {
    return Response.json(
      { ok: false, error: "Personaje no encontrado." },
      { status: 404 },
    );
  }

  const pool = CATEGORY_SKILLS[parsed.data.category];
  const rankedSkills = pool
    .map((skill) => ({
      skill,
      label: SKILL_LABELS_ES[skill],
      modifier: getCheckModifier(activeChar, skill, loaded.state.ruleset)
        .totalMod,
    }))
    .sort((a, b) => b.modifier - a.modifier);

  const top3 = rankedSkills.slice(0, 3);
  const fallback = buildFallbackSuggestions(parsed.data.category, top3);

  try {
    const resolved = resolveLanguageModel(GUEST_DEFAULT_MODEL, process.env, {
      reasoningEffort: "none",
    });

    const sceneTitle =
      loaded.state.scenes[loaded.state.sceneId]?.titleEs ??
      loaded.state.sceneId;
    const skillsPrompt = top3
      .map(
        (s) =>
          `${s.label} (${s.modifier >= 0 ? `+${s.modifier}` : s.modifier})`,
      )
      .join(", ");

    const { text } = await generateText({
      model: resolved.model,
      maxOutputTokens: 280,
      system:
        "Sos un asistente táctico de D&D 5e en español rioplatense. Devolvé ÚNICAMENTE un JSON válido con un array de exactamente 3 strings cortos (máximo 14 palabras cada uno), uno por cada habilidad indicada en orden, sin markdown ni texto extra.",
      prompt: [
        `Escena: ${sceneTitle}. Combate activo: ${loaded.state.combat?.active ? "sí" : "no"}.`,
        `Categoría: ${parsed.data.category}.`,
        `Mejores habilidades del PJ (${activeChar.name}): ${skillsPrompt}.`,
        parsed.data.lastDmText
          ? `Último relato del DM: ${parsed.data.lastDmText.slice(-500)}`
          : "",
        `Generá exactamente 3 acciones concretas en infinitivo o primera persona (sin repetir la palabra de la habilidad), una para cada habilidad en ese orden: ["acción 1", "acción 2", "acción 3"].`,
      ]
        .filter(Boolean)
        .join("\n"),
    });

    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      const arr = JSON.parse(match[0]) as unknown;
      if (
        Array.isArray(arr) &&
        arr.length >= 3 &&
        arr.slice(0, 3).every((item) => typeof item === "string" && item.trim())
      ) {
        const suggestions: SparkleSuggestionItem[] = top3.map((item, idx) => ({
          skill: item.label,
          modifier: item.modifier,
          label: String(arr[idx]).trim(),
        }));
        return Response.json({ ok: true, suggestions, source: "llm" });
      }
    }
  } catch {
    // Fallback determinista instantáneo si el router Free no responde
  }

  return Response.json({ ok: true, suggestions: fallback, source: "fallback" });
}
