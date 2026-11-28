import {
  AGUAS_QUIETAS_PACK,
  AdventurePackSchema,
  createRng,
  validateAdventurePackGraph,
  type AdventurePack,
} from "@dungeons/rules";
import type { ToolExecutionOptions } from "ai";
import { describe, expect, it } from "vitest";

import { buildDmPromptLayers, createDmTools } from "@/agent/agent";
import { DELETE, GET, POST } from "@/app/api/game/packs/route";
import { InMemoryGameStore } from "@/lib/game/store";

const EXEC_OPTS: ToolExecutionOptions<never> = {
  toolCallId: "pack-test-call",
  messages: [],
  context: undefined as never,
};

function makeCustomPack(id = "brumas-de-prueba"): AdventurePack {
  return {
    schemaVersion: 1,
    id,
    titleEs: "Brumas de Prueba",
    subtitleEs: "Aventura personalizada",
    worldSummaryEs: "Un valle rodeado de niebla perpetua y campanas rotas.",
    tonePromptEs: "Horror gótico con decisiones trágicas y amenaza tangible.",
    recommendedLevels: { min: 1, max: 3 },
    recommendedRuleset: "5e-full",
    initialSceneId: "escena_umbral",
    epilogueSceneIds: ["escena_final"],
    scenes: {
      escena_umbral: {
        id: "escena_umbral",
        titleEs: "Puerta de Hierro",
        shortLabelEs: "Puerta",
        baseTension: 25,
        summaryEs: "Rejas oxidadas bloquean el sendero entre árboles muertos.",
        narrativeHookEs: "La aldaba vibra sola ante tu presencia.",
        allowedTransitions: ["escena_final"],
        clues: [
          {
            id: "pista_blason",
            dc: 11,
            titleEs: "Blasón grabado",
            descriptionEs: "El escudo pertenece a una casa caída.",
            tacticalEffectEs: "Permite identificar al guardián del umbral.",
          },
        ],
      },
      escena_final: {
        id: "escena_final",
        titleEs: "Capilla del Alba",
        shortLabelEs: "Capilla",
        baseTension: 70,
        summaryEs: "Un altar agrietado resguarda la salida del valle.",
        allowedTransitions: [],
        clues: [],
      },
    },
    quest: {
      id: "quest_brumas",
      titleEs: "Cruzar el Umbral",
      objectiveEs: "Atravesar las rejas y encender el farol de la capilla.",
      stages: [
        {
          id: "st_1",
          order: 1,
          titleEs: "Abrir la reja",
          goalEs: "Superar el umbral.",
          sceneIds: ["escena_umbral"],
          actTitleEs: "Acto I",
          dramaticBeatEs: "El primer paso en la niebla.",
        },
        {
          id: "st_2",
          order: 2,
          titleEs: "Capilla del Alba",
          goalEs: "Alcanzar el altar.",
          sceneIds: ["escena_final"],
          actTitleEs: "Clímax",
          dramaticBeatEs: "Desenlace.",
        },
      ],
      endings: [
        {
          id: "end_std",
          titleEs: "Amanecer Pálido",
          summaryEs: "La niebla retrocede por una noche.",
          isStandard: true,
          requiredClueGroups: [],
          hintEs: "Llegá a la capilla final.",
        },
      ],
    },
    intro: {
      soloParagraphsEs: [
        "El valle despierta bajo ceniza gris.",
        "Frente a la reja helada, {{charName}}, escuchás un doblar lejano. ¿Qué hacés?",
      ],
      groupParagraphsEs: [
        "El valle despierta bajo ceniza gris.",
        "Frente a la reja helada esperan **{{partyNames}}**. ¿Qué hacen?",
      ],
      suggestedActions: [
        {
          skill: "Percepción",
          tone: "blue",
          label: "Inspeccionar el blasón oxidado de la puerta",
        },
        {
          skill: "Sigilo",
          tone: "emerald",
          label: "Rodear las rejas buscando una brecha entre los pinos",
        },
        {
          skill: "Persuasión",
          tone: "violet",
          label: "Llamar hacia la garita por si queda algún vigía",
        },
      ],
    },
    bestiary: [
      {
        id: "espantapajaros_maldito",
        nameEs: "Espantapájaros Maldito",
        srdBaseIndex: "custom",
        cr: 1,
        ac: 11,
        hp: 27,
        speedTextEs: "30 pies",
        abilities: { str: 11, dex: 13, con: 11, int: 10, wis: 10, cha: 13 },
        skills: {},
        vulnerabilities: ["fuego"],
        immunities: ["veneno"],
        traitsEs: ["Vulnerable al fuego."],
        attacks: [
          {
            id: "garra_paja",
            nameEs: "Garra de paja y hierro",
            kind: "melee",
            attackBonus: 4,
            damageDice: "1d6+2",
            damageType: "cortante",
            rangeText: "cuerpo a cuerpo (5 pies)",
          },
        ],
      },
    ],
    lorebook: [
      {
        id: "lore_valle",
        titleEs: "Niebla de la Capilla",
        category: "location",
        keywords: ["niebla", "capilla", "reja"],
        activeSceneIds: ["escena_umbral"],
        priority: 8,
        contentEs: "Quien inhala la bruma sin antorcha sufre pesadillas vívidas.",
      },
    ],
    npcMinds: [
      {
        id: "npc_enterrador",
        nameEs: "Vasil el Enterrador",
        roleEs: "Sepulturero del umbral",
        activeSceneIds: ["escena_umbral"],
        triggerKeywords: ["vasil", "enterrador", "pala"],
        knowsEs: "Sabe que las campanas suenan solas cuando alguien miente.",
        doesNotKnowEs: "Ignora quién forjó el sello del altar.",
        wantsEs: "Que cierren la reja antes del anochecer.",
        hidesEs: "Enterró a su hermano sin rito sagrado.",
        defaultAttitudeEs: "hosco pero cooperativo si muestran respeto",
      },
    ],
  };
}

describe("AdventurePack schema, store, API and DM wiring", () => {
  it("validates custom AdventurePack and stores/seeds intro in InMemoryGameStore", async () => {
    const custom = makeCustomPack();
    expect(AdventurePackSchema.safeParse(custom).success).toBe(true);
    expect(validateAdventurePackGraph(custom).valid).toBe(true);

    const store = new InMemoryGameStore();
    const guestId = "11111111-1111-4111-8111-111111111111";

    const summary = await store.upsertAdventurePack(guestId, custom);
    expect(summary.id).toBe("brumas-de-prueba");
    expect(summary.sceneCount).toBe(2);

    const list = await store.listAdventurePacks(guestId);
    expect(list.some((p) => p.id === AGUAS_QUIETAS_PACK.id && p.builtin)).toBe(
      true,
    );
    expect(list.some((p) => p.id === "brumas-de-prueba" && !p.builtin)).toBe(
      true,
    );

    const created = await store.createCampaign({
      guestId,
      adventureId: "brumas-de-prueba",
      presetId: "pc_kael",
    });
    expect(created.adventureId).toBe("brumas-de-prueba");
    expect(created.state.sceneId).toBe("escena_umbral");
    expect(created.adventurePack?.id).toBe("brumas-de-prueba");

    const seeded = await store.seedOpeningIntro(created.campaignId, guestId);
    expect(seeded?.messages.length).toBe(1);
    const joinedParts = JSON.stringify(seeded?.messages[0]?.parts ?? []);
    expect(joinedParts).toContain("Kael");
    expect(joinedParts).toContain("Inspeccionar el blasón oxidado");
  });

  it("enforces schema, graph, and builtin slug protections in /api/game/packs", async () => {
    const validCustom = makeCustomPack("pack-api-test");

    const postValid = await POST(
      new Request("http://localhost/api/game/packs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validCustom),
      }),
    );
    expect(postValid.status).toBe(200);
    const cookie = postValid.headers.get("Set-Cookie") ?? "";
    const validJson = (await postValid.json()) as {
      ok: boolean;
      pack?: { id: string };
    };
    expect(validJson.ok).toBe(true);
    expect(validJson.pack?.id).toBe("pack-api-test");

    const getRes = await GET(
      new Request("http://localhost/api/game/packs", {
        headers: cookie ? { Cookie: cookie } : undefined,
      }),
    );
    expect(getRes.status).toBe(200);
    const listJson = (await getRes.json()) as {
      ok: boolean;
      items: Array<{ id: string }>;
    };
    expect(listJson.items.some((p) => p.id === "pack-api-test")).toBe(true);

    const postBuiltin = await POST(
      new Request("http://localhost/api/game/packs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeCustomPack("aguas-quietas")),
      }),
    );
    expect(postBuiltin.status).toBe(400);

    const brokenGraph = makeCustomPack("pack-roto");
    brokenGraph.scenes.escena_umbral.allowedTransitions = ["no_existe"];
    const postBroken = await POST(
      new Request("http://localhost/api/game/packs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(brokenGraph),
      }),
    );
    expect(postBroken.status).toBe(400);

    const deleteBuiltin = await DELETE(
      new Request("http://localhost/api/game/packs?slug=aguas-quietas"),
    );
    expect(deleteBuiltin.status).toBe(400);

    const deleteCustom = await DELETE(
      new Request("http://localhost/api/game/packs?slug=pack-api-test", {
        method: "DELETE",
        headers: cookie ? { Cookie: cookie } : undefined,
      }),
    );
    expect(deleteCustom.status).toBe(200);
  });

  it("injects custom AdventurePack into DM prompt layers and combat/lookup tools", async () => {
    const custom = makeCustomPack("brumas-dm");
    const store = new InMemoryGameStore();
    const guestId = "22222222-2222-4222-8222-222222222222";
    await store.upsertAdventurePack(guestId, custom);
    const loaded = await store.createCampaign({
      guestId,
      adventureId: "brumas-dm",
      presetId: "pc_kael",
    });

    const layers = buildDmPromptLayers(
      loaded.state,
      loaded.events,
      {
        worldSummary: loaded.worldSummary,
        latestUserText: "Hablo con Vasil cerca de la reja entre la niebla",
      },
      custom,
    );
    expect(layers.staticSystemPrompt).toContain("Brumas de Prueba");
    expect(layers.staticSystemPrompt).toContain("espantapajaros_maldito");
    expect(layers.dynamicTurnContext).toContain("Cruzar el Umbral");
    expect(layers.dynamicTurnContext).toContain("Vasil el Enterrador");
    expect(layers.dynamicTurnContext).toContain("Niebla de la Capilla");

    let currentState = loaded.state;
    const tools = createDmTools({
      campaignId: loaded.campaignId,
      sessionId: loaded.sessionId,
      guestId,
      adventurePack: custom,
      getState: () => currentState,
      getInitialState: () => loaded.initialState,
      getEvents: () => [],
      commitEvent: async (_ev, next) => {
        currentState = next;
      },
      commitRollback: async () => ({
        ok: false,
        code: "INVALID_TARGET_SEQ",
        messageEs: "Rollback no disponible en este mock.",
      }),
      rng: createRng("pack-test-seed"),
      createId: () => "evt-id",
      now: () => new Date().toISOString(),
    });

    const lookupOut = (await tools.lookup_rules.execute!(
      { query: "espantapajaros", category: "monster" },
      EXEC_OPTS,
    )) as { ok: boolean; results: Array<{ index: string; nameEs: string }> };
    expect(lookupOut.ok).toBe(true);
    expect(
      lookupOut.results.some((r) => r.index === "espantapajaros_maldito"),
    ).toBe(true);

    const combatOut = (await tools.combat_start.execute!(
      {
        sceneId: "escena_umbral",
        enemies: [{ creatureId: "espantapajaros_maldito", count: 1 }],
      },
      EXEC_OPTS,
    )) as { ok: boolean; messageEs?: string };
    expect(combatOut.ok).toBe(true);
  });
});
