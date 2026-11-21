export interface EsTranslation {
  nameEs: string;
  descriptionEs?: string;
}

export const CONDITION_TRANSLATIONS_ES: Record<string, Required<EsTranslation>> = {
  blinded: {
    nameEs: 'Cegado',
    descriptionEs:
      'No podés ver y fallás automáticamente cualquier prueba que dependa de la vista. Tus ataques tienen desventaja y los ataques contra vos tienen ventaja.',
  },
  charmed: {
    nameEs: 'Hechizado',
    descriptionEs:
      'No podés atacar al encantador ni elegirlo como objetivo de efectos dañinos; el encantador tiene ventaja en pruebas sociales contra vos.',
  },
  deafened: {
    nameEs: 'Ensordecido',
    descriptionEs:
      'No podés oír y fallás automáticamente cualquier prueba de característica que requiera audición.',
  },
  exhaustion: {
    nameEs: 'Agotamiento',
    descriptionEs:
      'Regla SRD 5.2.1: acumulativo hasta nivel 6 (muerte a nivel 6). Cada nivel impone -2 a todas las pruebas de d20 y reduce tu velocidad en 5 pies. Un Descanso Largo reduce 1 nivel.',
  },
  frightened: {
    nameEs: 'Asustado',
    descriptionEs:
      'Tenés desventaja en pruebas de característica y ataques mientras la fuente de miedo esté en tu línea de visión, y no podés acercarte voluntariamente a ella.',
  },
  grappled: {
    nameEs: 'Agarrado',
    descriptionEs:
      'Tu velocidad pasa a 0 y no puede aumentar; terminás el agarre si el captor queda incapacitado o salís de su alcance.',
  },
  incapacitated: {
    nameEs: 'Incapacitado',
    descriptionEs:
      'No podés realizar acciones, acciones adicionales ni reacciones, perdés la concentración y no podés hablar.',
  },
  invisible: {
    nameEs: 'Invisible',
    descriptionEs:
      'Tenés ventaja en iniciativa, tus ataques tienen ventaja y los ataques contra vos tienen desventaja; no podés ser visto sin sentidos especiales.',
  },
  paralyzed: {
    nameEs: 'Paralizado',
    descriptionEs:
      'Quedás incapacitado, no podés moverte ni hablar, fallás automáticamente salvaciones de Fuerza y Destreza, los ataques contra vos tienen ventaja y los cuerpo a cuerpo a 5 pies son críticos.',
  },
  petrified: {
    nameEs: 'Petrificado',
    descriptionEs:
      'Te transformás en sustancia sólida inanimada; quedás incapacitado, tenés resistencia a todo daño e inmunidad a veneno y enfermedades.',
  },
  poisoned: {
    nameEs: 'Envenenado',
    descriptionEs:
      'Tenés desventaja en las tiradas de ataque y en las pruebas de característica.',
  },
  prone: {
    nameEs: 'Derribado',
    descriptionEs:
      'Solo podés arrastrarte o gastar la mitad de tu velocidad para levantarte. Tus ataques tienen desventaja; los ataques cuerpo a cuerpo contra vos a 5 pies tienen ventaja.',
  },
  restrained: {
    nameEs: 'Apresado',
    descriptionEs:
      'Tu velocidad pasa a 0, tus ataques y salvaciones de Destreza tienen desventaja, y los ataques contra vos tienen ventaja.',
  },
  stunned: {
    nameEs: 'Aturdido',
    descriptionEs:
      'Quedás incapacitado, fallás automáticamente salvaciones de Fuerza y Destreza, y las tiradas de ataque contra vos tienen ventaja.',
  },
  unconscious: {
    nameEs: 'Inconsciente',
    descriptionEs:
      'Quedás incapacitado y derribado, soltás lo que sostenés, fallás salvaciones de Fuerza y Destreza, y los golpes cuerpo a cuerpo a 5 pies son críticos.',
  },
};

export const SKILL_TRANSLATIONS_ES: Record<string, Required<EsTranslation>> = {
  acrobatics: {
    nameEs: 'Acrobacias',
    descriptionEs: 'Mantener el equilibrio, caer con control o ejecutar maniobras ágiles.',
  },
  'animal-handling': {
    nameEs: 'Trato con Animales',
    descriptionEs: 'Calmar bestias, guiar monturas o intuir las intenciones de un animal.',
  },
  arcana: {
    nameEs: 'Conocimiento Arcano',
    descriptionEs: 'Recordar saber sobre conjuros, planos, objetos mágicos y tradiciones arcanas.',
  },
  athletics: {
    nameEs: 'Atletismo',
    descriptionEs: 'Trepar, saltar, nadar, forcejear y realizar proezas físicas.',
  },
  deception: {
    nameEs: 'Engaño',
    descriptionEs: 'Ocultar la verdad con palabras, medias verdades o disfraces convincentes.',
  },
  history: {
    nameEs: 'Historia',
    descriptionEs: 'Recordar hechos pasados, linajes, guerras antiguas y reinos caídos.',
  },
  insight: {
    nameEs: 'Perspicacia',
    descriptionEs: 'Detectar mentiras, motivaciones ocultas y lenguaje corporal.',
  },
  intimidation: {
    nameEs: 'Intimidación',
    descriptionEs: 'Presionar o amenazar para forzar cooperación o infundir temor.',
  },
  investigation: {
    nameEs: 'Investigación',
    descriptionEs: 'Buscar pistas, deducir conexiones y analizar indicios en una escena.',
  },
  medicine: {
    nameEs: 'Medicina',
    descriptionEs: 'Estabilizar heridos, diagnosticar dolencias o reconocer causas de muerte.',
  },
  nature: {
    nameEs: 'Naturaleza',
    descriptionEs: 'Reconocer terrenos, plantas, climas y criaturas naturales o monstruos.',
  },
  perception: {
    nameEs: 'Percepción',
    descriptionEs: 'Detectar amenazas ocultas, ruidos tenues o detalles del entorno.',
  },
  performance: {
    nameEs: 'Interpretación',
    descriptionEs: 'Cautivar a una audiencia mediante música, relato o actuación.',
  },
  persuasion: {
    nameEs: 'Persuasión',
    descriptionEs: 'Convencer mediante tacto, diplomacia, argumentos o buena fe.',
  },
  religion: {
    nameEs: 'Religión',
    descriptionEs: 'Conocer deidades, ritos, sectas y símbolos sagrados.',
  },
  'sleight-of-hand': {
    nameEs: 'Juego de Manos',
    descriptionEs: 'Hurtar objetos, ocultar cosas pequeñas o manipular mecanismos con destreza.',
  },
  stealth: {
    nameEs: 'Sigilo',
    descriptionEs: 'Moverse en silencio y aprovechar sombras o cobertura para no ser visto.',
  },
  survival: {
    nameEs: 'Supervivencia',
    descriptionEs: 'Rastrear huellas, orientarse en tierras salvajes y evitar peligros naturales.',
  },
};

export const EQUIPMENT_TRANSLATIONS_ES: Record<string, EsTranslation> = {
  shortbow: {
    nameEs: 'Arco corto',
    descriptionEs: 'Arma a distancia marcial/simple ligera (1d6 perforante, alcance 80/320 pies).',
  },
  shortsword: {
    nameEs: 'Espada corta',
    descriptionEs: 'Arma cuerpo a cuerpo ligera y sutil (1d6 perforante).',
  },
  longbow: {
    nameEs: 'Arco largo',
    descriptionEs: 'Arma a distancia pesada a dos manos (1d8 perforante, alcance 150/600 pies).',
  },
  longsword: {
    nameEs: 'Espada larga',
    descriptionEs: 'Arma versátil (1d8 cortante a una mano, 1d10 a dos manos).',
  },
  dagger: {
    nameEs: 'Daga',
    descriptionEs: 'Arma sutil, ligera y arrojadiza (1d4 perforante, alcance 20/60 pies).',
  },
  'leather-armor': {
    nameEs: 'Armadura de cuero',
    descriptionEs: 'Armadura ligera: CA 11 + modificador de Destreza.',
  },
  'studded-leather-armor': {
    nameEs: 'Cuero tachonado',
    descriptionEs: 'Armadura ligera: CA 12 + modificador de Destreza.',
  },
  'chain-shirt': {
    nameEs: 'Camisote de malla',
    descriptionEs: 'Armadura media: CA 13 + modificador de Destreza (máximo +2).',
  },
  shield: {
    nameEs: 'Escudo',
    descriptionEs: 'Otorga un bonificador de +2 a la CA mientras se empuña.',
  },
  rations: {
    nameEs: 'Raciones de viaje',
    descriptionEs: 'Alimento seco suficiente para sustentar a una persona durante un día.',
  },
  rope: {
    nameEs: 'Cuerda (50 pies)',
    descriptionEs: 'Cuerda resistente de cáñamo útil para escalar, amarrar o asegurar cargas.',
  },
  torch: {
    nameEs: 'Antorcha',
    descriptionEs: 'Arde durante 1 hora iluminando con luz brillante en 20 pies y tenue en otros 20.',
  },
  'healers-kit': {
    nameEs: 'Botiquín de sanador',
    descriptionEs: 'Contiene 10 usos; permite estabilizar a una criatura moribunda sin tirada de Medicina.',
  },
  'thieves-tools': {
    nameEs: 'Herramientas de ladrón',
    descriptionEs: 'Ganzúas y pinzas para forzar cerraduras y desactivar trampas.',
  },
  'potion-of-healing': {
    nameEs: 'Poción de curación',
    descriptionEs: 'Al beberla como Acción Adicional (SRD 5.2.1), recuperás 2d4 + 2 Puntos de Golpe.',
  },
  arrows: {
    nameEs: 'Flechas',
    descriptionEs: 'Munición estándar para arcos cortos y largos.',
  },
};

export const SPELL_TRANSLATIONS_ES: Record<string, EsTranslation> = {
  'fire-bolt': {
    nameEs: 'Descarga de fuego',
    descriptionEs: 'Truco a distancia (120 pies): ataque mágico que inflige 1d10 de daño por fuego.',
  },
  'mage-hand': {
    nameEs: 'Mano de mago',
    descriptionEs: 'Mano espectral flotante que manipula objetos ligeros hasta a 30 pies.',
  },
  light: {
    nameEs: 'Luz',
    descriptionEs: 'Un objeto tocado emite luz brillante en 20 pies y luz tenue en otros 20.',
  },
  'cure-wounds': {
    nameEs: 'Curar heridas',
    descriptionEs: 'Nivel 1 (Toque): recupera 2d8 + modificador de lanzamiento en SRD 5.2.1.',
  },
  'healing-word': {
    nameEs: 'Palabra de curación',
    descriptionEs: 'Nivel 1 (Acción Adicional, 60 pies): recupera 2d4 + modificador en SRD 5.2.1.',
  },
  shield: {
    nameEs: 'Escudo arcano',
    descriptionEs: 'Reacción de nivel 1: +5 a la CA hasta el inicio de tu siguiente turno.',
  },
  'magic-missile': {
    nameEs: 'Proyectil mágico',
    descriptionEs: 'Nivel 1: tres dardos de fuerza infalibles que infligen 1d4+1 cada uno.',
  },
  'burning-hands': {
    nameEs: 'Manos ardientes',
    descriptionEs: 'Nivel 1 (Cono de 15 pies): 3d6 de daño por fuego (salvación de Destreza mitad).',
  },
  entangle: {
    nameEs: 'Enmarañar',
    descriptionEs: 'Nivel 1 (Concentración): maleza que apresa a criaturas en un cuadrado de 20 pies.',
  },
  'hunters-mark': {
    nameEs: 'Marca del cazador',
    descriptionEs: 'Nivel 1 (Acción Adicional, Concentración): +1d6 de daño adicional con armas al objetivo.',
  },
  'misty-step': {
    nameEs: 'Paso brumoso',
    descriptionEs: 'Nivel 2 (Acción Adicional): teletransporte instantáneo de hasta 30 pies a un punto visible.',
  },
  fireball: {
    nameEs: 'Bola de fuego',
    descriptionEs: 'Nivel 3 (Esfera de 20 pies): 8d6 de daño por fuego (salvación de Destreza mitad).',
  },
};

export const MONSTER_TRANSLATIONS_ES: Record<string, EsTranslation> = {
  scout: { nameEs: 'Explorador' },
  ghoul: { nameEs: 'Necrófago' },
  'bandit-captain': { nameEs: 'Capitán bandido' },
  bandit: { nameEs: 'Bandido' },
  'goblin-warrior': { nameEs: 'Guerrero trasgo' },
  wolf: { nameEs: 'Lobo' },
  skeleton: { nameEs: 'Esqueleto' },
  zombie: { nameEs: 'Zombi' },
};
