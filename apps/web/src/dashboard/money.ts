import type { SpendFigure } from '@goodies-beacon/core/schemas';

/**
 * Pounds at the newest stored rate, or the ledger's own dollars without one.
 *
 * A total under a penny shows as a penny, as the search plans' pre-filter column does, so a cheap
 * day does not read as free; the cost per call is where the fractions of a penny belong. A figure
 * that includes an unpriced model is prefixed "≥", because it is a floor rather than a measurement.
 */
export function moneyIn(usdPerGbp: number | null) {
  const [symbol, minor, rate] = usdPerGbp === null ? ['$', '¢', 1] : ['£', 'p', usdPerGbp];
  const floor = (figure: SpendFigure) => (figure.known ? '' : '≥');

  return {
    total(figure: SpendFigure): string {
      if (figure.calls === 0) return '—';
      return `${floor(figure)}${symbol}${Math.max(figure.usd / rate, 0.01).toFixed(2)}`;
    },
    perCall(figure: SpendFigure): string {
      const each = (figure.usd / rate / figure.calls) * 100;
      return `${floor(figure)}${Number(each.toPrecision(2))}${minor}`;
    },
  };
}

export function totalOf(figures: SpendFigure[]): SpendFigure {
  return figures.reduce(
    (sum, figure) => ({
      calls: sum.calls + figure.calls,
      usd: sum.usd + figure.usd,
      known: sum.known && figure.known,
    }),
    { calls: 0, usd: 0, known: true },
  );
}
