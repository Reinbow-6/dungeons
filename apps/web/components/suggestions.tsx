"use client";

import {
  BookOpenIcon,
  CompassIcon,
  EyeIcon,
  MessageSquareIcon,
} from "lucide-react";

const suggestions = [
  {
    icon: CompassIcon,
    label: "Comenzar Aguas Quietas",
    subtitle: "Abrí la escena inicial junto al río brumoso.",
    prompt:
      "Empecemos la aventura Aguas Quietas. Describime la orilla del río brumoso y pedime las tiradas que correspondan.",
  },
  {
    icon: EyeIcon,
    label: "Vigilar la maleza",
    subtitle: "Inspeccioná la orilla buscando rastros o emboscadas.",
    prompt:
      "Escudriño la orilla y los juncos antes de moverme, atento a cualquier movimiento oculto.",
  },
  {
    icon: MessageSquareIcon,
    label: "Parlamentar en calma",
    subtitle: "Intentá diálogo pacífico con los vigías del embarcadero.",
    prompt:
      "Mantengo las manos visibles y pregunto en voz firme quién vigila el embarcadero del otro lado del pantano.",
  },
  {
    icon: BookOpenIcon,
    label: "Consultar reglas SRD",
    subtitle: "Consultá efectos reales de condiciones o reglas 5.2.1.",
    prompt:
      "¿Qué efecto tiene la condición Agotamiento según el SRD 5.2.1 actual?",
  },
] as const;

export function Suggestions({
  onSelect,
}: {
  onSelect: (prompt: string) => void;
}) {
  return (
    <div className="grid w-full max-w-xl grid-cols-1 gap-2.5 sm:grid-cols-2">
      {suggestions.map((suggestion) => {
        const Icon = suggestion.icon;
        return (
          <button
            key={suggestion.label}
            type="button"
            onClick={() => onSelect(suggestion.prompt)}
            className="group flex flex-col gap-1 rounded-xl border border-border/80 bg-card/60 p-3 text-left transition-all hover:border-indigo-500/40 hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="flex items-center gap-2 text-xs font-medium text-foreground">
              <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background/80 text-muted-foreground transition-colors group-hover:border-indigo-500/30 group-hover:text-indigo-400">
                <Icon className="size-3.5" />
              </span>
              <span>{suggestion.label}</span>
            </div>
            <p className="pl-8 text-[11px] leading-snug text-muted-foreground">
              {suggestion.subtitle}
            </p>
          </button>
        );
      })}
    </div>
  );
}
