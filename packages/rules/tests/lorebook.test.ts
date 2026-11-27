import { describe, expect, it } from 'vitest';
import {
  AGUAS_QUIETAS_LOREBOOK,
  createAguasQuietasInitialState,
  selectLorebookEntries,
  type LorebookEntry,
} from '../src/index.js';

describe('Lorebook on-demand selection', () => {
  it('activates entries matching the active scene and keywords within scanDepth', () => {
    const state = createAguasQuietasInitialState();
    state.sceneId = 'escena_01_orilla';

    const result = selectLorebookEntries(
      AGUAS_QUIETAS_LOREBOOK,
      state,
      [
        'Mensaje antiguo 1 sobre patrullas del norte',
        'Mensaje antiguo 2',
        'Mensaje antiguo 3',
        'Mensaje antiguo 4',
        'Veo el humo del embarcadero desde la orilla',
      ],
      { scanDepth: 2 },
    );

    const ids = result.entries.map((item) => item.entry.id);
    // Active scene entry
    expect(ids).toContain('lore_rio_brumoso');
    // Keyword in latest 2 messages ("embarcadero")
    expect(ids).toContain('lore_guarnicion_embarcadero');
    // Older message outside scanDepth ("patrullas" / "norte") must NOT trigger
    expect(ids).not.toContain('lore_patrullas_norte');
    expect(result.scannedMessages).toBe(2);
  });

  it('requires both primary and secondary keywords when secondaryKeywords is defined', () => {
    const state = createAguasQuietasInitialState();
    const customCatalog: LorebookEntry[] = [
      {
        id: 'lore_combo',
        titleEs: 'Pacto secreto',
        category: 'world',
        keywords: ['barcaza'],
        secondaryKeywords: ['cadena', 'hierro'],
        priority: 80,
        contentEs: 'Detalle del mecanismo de la barcaza.',
      },
    ];

    const onlyPrimary = selectLorebookEntries(customCatalog, state, [
      'Buscamos la barcaza en el muelle.',
    ]);
    expect(onlyPrimary.entries).toHaveLength(0);

    const bothMatched = selectLorebookEntries(customCatalog, state, [
      'Tiramos de la cadena de la barcaza.',
    ]);
    expect(bothMatched.entries).toHaveLength(1);
    expect(bothMatched.entries[0]!.entry.id).toBe('lore_combo');
  });

  it('enforces requiresAnyClue anti-spoiler guard until the clue is unlocked', () => {
    const state = createAguasQuietasInitialState();
    state.sceneId = 'escena_06_comandante';

    const lockedResult = selectLorebookEntries(AGUAS_QUIETAS_LOREBOOK, state, [
      'Hablo con Mireia sobre sus órdenes y la deserción.',
    ]);
    expect(lockedResult.entries.map((e) => e.entry.id)).not.toContain(
      'lore_desercion_mireia',
    );

    state.unlockedClues = {
      escena_06_comandante: ['pista_mireia_14'],
    };
    const unlockedResult = selectLorebookEntries(
      AGUAS_QUIETAS_LOREBOOK,
      state,
      ['Hablo con Mireia sobre sus órdenes.'],
    );
    expect(unlockedResult.entries.map((e) => e.entry.id)).toContain(
      'lore_desercion_mireia',
    );
  });

  it('supports single-step recursion from activated entries', () => {
    const state = createAguasQuietasInitialState();
    const catalog: LorebookEntry[] = [
      {
        id: 'entry_a',
        titleEs: 'Muelle Viejo',
        category: 'location',
        keywords: ['muelle'],
        priority: 90,
        contentEs: 'Un embarcadero donde aguarda el barquero.',
      },
      {
        id: 'entry_b',
        titleEs: 'El Barquero',
        category: 'npc',
        keywords: ['barquero'],
        priority: 50,
        contentEs: 'Solo acepta monedas antiguas.',
      },
    ];

    const noRecursion = selectLorebookEntries(catalog, state, ['Voy al muelle'], {
      recursionDepth: 0,
    });
    expect(noRecursion.entries.map((e) => e.entry.id)).toEqual(['entry_a']);

    const withRecursion = selectLorebookEntries(
      catalog,
      state,
      ['Voy al muelle'],
      { recursionDepth: 1 },
    );
    expect(withRecursion.entries.map((e) => e.entry.id)).toEqual([
      'entry_a',
      'entry_b',
    ]);
    expect(withRecursion.entries[1]!.reason).toBe('recursive');
  });

  it('enforces tokenBudget and maxEntries prioritizing constant and higher priority entries', () => {
    const state = createAguasQuietasInitialState();
    const longContent = 'Detalle extenso del trasfondo. '.repeat(12);
    const catalog: LorebookEntry[] = [
      {
        id: 'low_prio',
        titleEs: 'Entrada baja',
        category: 'world',
        keywords: ['rio'],
        priority: 20,
        contentEs: longContent,
      },
      {
        id: 'high_prio',
        titleEs: 'Entrada alta',
        category: 'world',
        keywords: ['rio'],
        priority: 95,
        contentEs: longContent,
      },
      {
        id: 'const_entry',
        titleEs: 'Constante',
        category: 'world',
        keywords: [],
        constant: true,
        priority: 10,
        contentEs: 'Regla fija de frontera.',
      },
    ];

    const res = selectLorebookEntries(catalog, state, ['Miro el rio'], {
      tokenBudget: 130,
      maxEntries: 2,
    });

    const ids = res.entries.map((e) => e.entry.id);
    expect(ids).toEqual(['const_entry', 'high_prio']);
    expect(res.usedTokens).toBeLessThanOrEqual(130);
    expect(res.droppedCount).toBe(1);
  });
});
