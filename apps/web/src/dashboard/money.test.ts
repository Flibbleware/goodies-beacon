import { describe, expect, it } from 'vitest';
import { moneyIn, totalOf } from './money.js';

const figure = (calls: number, usd: number, known = true) => ({ calls, usd, known });

describe('moneyIn', () => {
  const pounds = moneyIn(1.25);

  it('converts a total into pounds at the rate', () => {
    expect(pounds.total(figure(10, 0.5))).toBe('£0.40');
  });

  it('shows no calls as a dash, and a spend under a penny as a penny', () => {
    expect(pounds.total(figure(0, 0))).toBe('—');
    expect(pounds.total(figure(3, 0.0003))).toBe('£0.01');
  });

  it('gives the cost per call in pence, fractions included', () => {
    expect(pounds.perCall(figure(100, 0.5375))).toBe('0.43p');
    expect(pounds.perCall(figure(1000, 0.05))).toBe('0.004p');
  });

  it('marks a figure that includes an unpriced call as a floor', () => {
    expect(pounds.total(figure(2, 0.5, false))).toBe('≥£0.40');
    expect(pounds.perCall(figure(2, 0.5, false))).toBe('≥20p');
  });

  it('stays in dollars when no rate is stored', () => {
    const dollars = moneyIn(null);

    expect(dollars.total(figure(10, 0.5))).toBe('$0.50');
    expect(dollars.perCall(figure(10, 0.05))).toBe('0.5¢');
  });
});

describe('totalOf', () => {
  it('adds the calls and the dollars, and is known only if every part is', () => {
    expect(totalOf([figure(1, 0.25), figure(2, 0.5, false)])).toEqual(figure(3, 0.75, false));
    expect(totalOf([])).toEqual(figure(0, 0));
  });
});
