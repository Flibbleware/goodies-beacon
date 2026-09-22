import { describe, expect, it } from 'vitest';
import { sortWishes } from './sort.js';

const wish = (id: string, label: string, createdAt: string) => ({ id, label, createdAt });

const labels = (list: { label: string }[]) => list.map((entry) => entry.label);

describe('sortWishes', () => {
  const wishes = [
    wish('1', 'tamagotchi', '2026-09-01T10:00:00.000Z'),
    wish('2', 'Blade Runner', '2026-09-03T10:00:00.000Z'),
    wish('3', 'Anthology Vol. 10', '2026-09-02T10:00:00.000Z'),
    wish('4', 'Anthology Vol. 2', '2026-09-04T10:00:00.000Z'),
  ];

  it('sorts A–Z ignoring case, with numbers compared as numbers', () => {
    expect(labels(sortWishes(wishes, 'az'))).toEqual([
      'Anthology Vol. 2',
      'Anthology Vol. 10',
      'Blade Runner',
      'tamagotchi',
    ]);
  });

  it('sorts newest first by when a wish was added', () => {
    expect(labels(sortWishes(wishes, 'newest'))).toEqual([
      'Anthology Vol. 2',
      'Blade Runner',
      'Anthology Vol. 10',
      'tamagotchi',
    ]);
  });

  it('puts the newer of two identical labels first, and leaves its input alone', () => {
    const twins = [wish('a', 'Tamagotchi', '2026-09-01'), wish('b', 'tamagotchi', '2026-09-02')];

    expect(sortWishes(twins, 'az').map((entry) => entry.id)).toEqual(['b', 'a']);
    expect(twins.map((entry) => entry.id)).toEqual(['a', 'b']);
  });
});
