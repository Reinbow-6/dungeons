"use client";

import { Button } from "@/components/ui/button";

const suggestions = [
  {
    label: "Comenzar Aguas Quietas",
    prompt:
      "Empecemos la aventura Aguas Quietas. Describime la orilla del río brumoso y pedime las tiradas que correspondan.",
  },
  {
    label: "Vigilar la maleza",
    prompt:
      "Escudriño la orilla y los juncos antes de moverme, atento a cualquier movimiento oculto.",
  },
  {
    label: "Parlamentar en calma",
    prompt:
      "Mantengo las manos visibles y pregunto en voz firme quién vigila el embarcadero del otro lado del pantano.",
  },
  {
    label: "Consultar reglas",
    prompt:
      "¿Qué efecto tiene la condición Agotamiento según el SRD 5.2.1 actual?",
  },
];

export function Suggestions({
  onSelect,
}: {
  onSelect: (prompt: string) => void;
}) {
  return (
    <div className="flex flex-wrap justify-center gap-2">
      {suggestions.map((suggestion) => (
        <Button
          key={suggestion.label}
          variant="outline"
          size="sm"
          onClick={() => onSelect(suggestion.prompt)}
        >
          {suggestion.label}
        </Button>
      ))}
    </div>
  );
}
