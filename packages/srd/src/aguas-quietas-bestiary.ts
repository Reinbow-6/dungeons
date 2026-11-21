import type { AguasQuietasCreatureStatBlock } from './schemas.js';

/**
 * Bloques de estadísticas propios en 5e lite para "Aguas Quietas",
 * derivados estructuralmente de criaturas del SRD 5.2.1 (CC-BY-4.0).
 */
export const AGUAS_QUIETAS_BESTIARY: AguasQuietasCreatureStatBlock[] = [
  {
    id: 'explorador_espesura',
    nameEs: 'Explorador de la Espesura',
    srdBaseIndex: 'scout',
    cr: 0.5,
    ac: 13,
    hp: 16,
    speedTextEs: '30 pies',
    abilities: {
      str: 11,
      dex: 14,
      con: 12,
      int: 11,
      wis: 13,
      cha: 11,
    },
    skills: {
      perception: 5,
      stealth: 5,
      survival: 5,
    },
    vulnerabilities: [],
    immunities: [],
    traitsEs: [
      'Ojos de la Ciénaga: ventaja en Sigilo al ocultarse entre maleza o niebla ribereña.',
      'Retirada Táctica: si se ve superado en la orilla, prioriza replegarse en 3 rondas para dar la alarma.',
    ],
    attacks: [
      {
        nameEs: 'Arco largo',
        kind: 'ranged',
        attackBonus: 4,
        damageDice: '1d8+2',
        damageType: 'piercing',
        rangeText: '150/600 pies',
      },
      {
        nameEs: 'Espada corta',
        kind: 'melee',
        attackBonus: 4,
        damageDice: '1d6+2',
        damageType: 'piercing',
        rangeText: '5 pies',
      },
    ],
    rulesetVersion: '5.2.1',
  },
  {
    id: 'necrofago_de_rio',
    nameEs: 'Necrófago de río',
    srdBaseIndex: 'ghoul',
    cr: 0.5,
    ac: 12,
    hp: 18,
    speedTextEs: '30 pies, nadar 30 pies',
    abilities: {
      str: 13,
      dex: 14,
      con: 10,
      int: 7,
      wis: 10,
      cha: 6,
    },
    skills: {
      stealth: 4,
    },
    vulnerabilities: ['fire'],
    immunities: ['poison'],
    traitsEs: [
      'Anfibio: puede respirar aire y permanecer sumergido bajo el río sin penalizaciones.',
      'Instinto Depredador: persigue presas hacia la orilla durante 1 ronda antes de volver a lo profundo.',
    ],
    attacks: [
      {
        nameEs: 'Garras fangosas',
        kind: 'melee',
        attackBonus: 4,
        damageDice: '1d6+2',
        damageType: 'slashing',
        rangeText: '5 pies',
      },
    ],
    rulesetVersion: '5.2.1',
  },
  {
    id: 'comandante_mireia',
    nameEs: 'Comandante Mireia',
    srdBaseIndex: 'bandit-captain',
    cr: 2,
    ac: 15,
    hp: 38,
    speedTextEs: '30 pies',
    abilities: {
      str: 14,
      dex: 16,
      con: 14,
      int: 13,
      wis: 14,
      cha: 14,
    },
    skills: {
      insight: 4,
      perception: 4,
      stealth: 5,
    },
    vulnerabilities: [],
    immunities: [],
    traitsEs: [
      'Liderazgo Desgastado: mientras Mireia siga en pie, los Exploradores de la Espesura no huyen del campamento.',
      'Supervivencia sobre Odio: prefiere evitar bajas inútiles si comprueba que los viajeros no son espías del sur.',
    ],
    attacks: [
      {
        nameEs: 'Espada larga curva',
        kind: 'melee',
        attackBonus: 5,
        damageDice: '1d8+3',
        damageType: 'slashing',
        rangeText: '5 pies',
      },
      {
        nameEs: 'Arco largo',
        kind: 'ranged',
        attackBonus: 5,
        damageDice: '1d8+3',
        damageType: 'piercing',
        rangeText: '150/600 pies',
      },
    ],
    rulesetVersion: '5.2.1',
  },
];
