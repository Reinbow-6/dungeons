import type { GameEvent } from "@dungeons/rules";

import type { ToastInput } from "@/components/ui/toaster";

function readString(
  obj: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === "string" && val.trim().length > 0) {
      return val.trim();
    }
  }
  return undefined;
}

function readNumber(
  obj: Record<string, unknown>,
  ...keys: string[]
): number | undefined {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === "number" && Number.isFinite(val)) {
      return val;
    }
  }
  return undefined;
}

function readBoolean(
  obj: Record<string, unknown>,
  ...keys: string[]
): boolean | undefined {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === "boolean") {
      return val;
    }
  }
  return undefined;
}

/**
 * Formats a deterministic engine GameEvent into a concise, atmospheric toast.
 */
export function formatGameEventToast(event: GameEvent): ToastInput {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const meta = `#${event.seq}`;

  switch (event.type) {
    case "CHECK_RESOLVED": {
      const skill = readString(payload, "skill") ?? "Prueba";
      const total = readNumber(payload, "total", "declaredTotal");
      const dc = readNumber(payload, "dc");
      const success = readBoolean(payload, "success");
      const outcome =
        success === undefined ? "Resuelta" : success ? "Éxito" : "Fallo";
      const detail =
        total !== undefined && dc !== undefined
          ? `${skill} · Total ${total} vs CD ${dc}`
          : skill;
      return {
        title: `Tirada: ${outcome}`,
        description: detail,
        tone: success === false ? "rose" : "emerald",
        meta,
      };
    }

    case "SAVE_RESOLVED": {
      const ability = (
        readString(payload, "ability") ?? "salvación"
      ).toUpperCase();
      const total = readNumber(payload, "total");
      const dc = readNumber(payload, "dc");
      const success = readBoolean(payload, "success");
      return {
        title: `Salvación (${ability}): ${success ? "Superada" : "Fallida"}`,
        description:
          total !== undefined && dc !== undefined
            ? `Total ${total} vs CD ${dc}`
            : undefined,
        tone: success ? "emerald" : "rose",
        meta,
      };
    }

    case "CLUES_UNLOCKED": {
      const clues = Array.isArray(payload.unlockedClues)
        ? payload.unlockedClues
        : Array.isArray(payload.clues)
          ? payload.clues
          : [];
      const count = clues.length;
      return {
        title:
          count > 1
            ? `${count} pistas descubiertas`
            : "Nueva pista descubierta",
        description:
          readString(payload, "sceneId") ??
          "El diario de escena fue actualizado.",
        tone: "amber",
        meta,
      };
    }

    case "SCENE_TRANSITION": {
      const toScene =
        readString(payload, "toTitleEs", "titleEs", "toSceneId", "sceneId") ??
        "Nueva escena";
      return {
        title: "Cambio de escena",
        description: toScene,
        tone: "amber",
        meta,
      };
    }

    case "DAMAGE_APPLIED": {
      const amount = readNumber(payload, "damage", "amount");
      const hpChange = event.stateDelta?.hpChanges?.[0];
      const hpSummary = hpChange
        ? `PG ${hpChange.before} → ${hpChange.after}`
        : undefined;
      return {
        title:
          amount !== undefined ? `Daño aplicado (-${amount} PG)` : "Daño recibido",
        description: hpSummary,
        tone: "rose",
        meta,
      };
    }

    case "HEALING_APPLIED": {
      const amount = readNumber(payload, "hpHealed", "healing", "amount");
      const hpChange = event.stateDelta?.hpChanges?.[0];
      const hpSummary = hpChange
        ? `PG ${hpChange.before} → ${hpChange.after}`
        : undefined;
      return {
        title:
          amount !== undefined
            ? `Curación (+${amount} PG)`
            : "Puntos de golpe restaurados",
        description: hpSummary,
        tone: "emerald",
        meta,
      };
    }

    case "CONDITION_CHANGED": {
      const added = event.stateDelta?.conditionsAdded?.[0]?.condition;
      const removed = event.stateDelta?.conditionsRemoved?.[0]?.condition;
      return {
        title: added
          ? `Condición aplicada: ${added}`
          : removed
            ? `Condición removida: ${removed}`
            : "Condición actualizada",
        description: event.actor,
        tone: added ? "violet" : "emerald",
        meta,
      };
    }

    case "INVENTORY_CHANGED": {
      const itemName =
        readString(payload, "name", "itemName", "itemId") ?? "Objeto";
      const op = readString(payload, "action", "operation");
      return {
        title: "Inventario actualizado",
        description: op ? `${op}: ${itemName}` : itemName,
        tone: "amber",
        meta,
      };
    }

    case "COMBAT_STARTED":
      return {
        title: "¡Combate iniciado!",
        description: "Orden de iniciativa registrada en el HUD.",
        tone: "rose",
        meta,
      };

    case "COMBAT_ATTACK": {
      const hit = readBoolean(payload, "hit");
      const crit = readBoolean(payload, "isCritical");
      const dmg = readNumber(payload, "damageApplied", "damage");
      return {
        title: crit
          ? `¡Golpe crítico! (${dmg ?? 0} daño)`
          : hit
            ? `Impacto (${dmg ?? 0} daño)`
            : "Ataque fallido",
        description: readString(payload, "attackName", "targetId"),
        tone: crit ? "amber" : hit ? "rose" : "neutral",
        meta,
      };
    }

    case "COMBAT_TURN_ADVANCED":
      return {
        title: "Siguiente turno de combate",
        description: readString(payload, "activeCombatantName"),
        tone: "neutral",
        meta,
      };

    case "COMBAT_ENDED":
      return {
        title: "Combate finalizado",
        description: readString(payload, "outcomeEs", "reason"),
        tone: "emerald",
        meta,
      };

    case "SPELL_CAST": {
      const spell =
        readString(payload, "spellNameEs", "spellName", "spellId") ?? "Conjuro";
      const slot = readNumber(payload, "slotLevel");
      return {
        title: `Conjuro: ${spell}`,
        description: slot && slot > 0 ? `Espacio nivel ${slot} gastado` : "Truco lanzado",
        tone: "violet",
        meta,
      };
    }

    case "REST_TAKEN": {
      const kind = readString(payload, "restType", "kind");
      return {
        title:
          kind === "long"
            ? "Descanso largo completado"
            : "Descanso corto completado",
        description: "PG y recursos actualizados en la ficha.",
        tone: "emerald",
        meta,
      };
    }

    case "DEATH_SAVE_RESOLVED": {
      const nat = readNumber(payload, "naturalRoll");
      const success = readBoolean(payload, "success");
      return {
        title:
          nat === 20
            ? "¡Salvación de muerte: NAT 20!"
            : `Salvación de muerte: ${success ? "Éxito" : "Fallo"}`,
        description: nat !== undefined ? `Dado natural: ${nat}` : undefined,
        tone: nat === 20 || success ? "emerald" : "rose",
        meta,
      };
    }

    case "ROLLBACK": {
      const targetSeq = readNumber(payload, "targetSeq");
      return {
        title: "Línea temporal restaurada",
        description:
          targetSeq !== undefined ? `Estado vuelto a #${targetSeq}` : undefined,
        tone: "amber",
        meta,
      };
    }
  }
}
