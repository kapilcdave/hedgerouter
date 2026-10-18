// Turns the normalized request ledger into the numbers a $/token hedge is sized on: for each model
// and direction, how many tokens a day the company burns and what it pays per million of them.
//
// The price is the gateway's own realized price (spend / tokens), not a list price. For a company
// locked into a rate, that realized rate is the contract it can be left holding when the provider
// cuts list price, so it is the right anchor for choosing strikes. It is only as good as the
// gateway's cost field: a source that reports a total but not the input/output split yields no
// per-direction price (`null`), never a guess, and the operator supplies one with `--price`.

const DAY_MS = 86_400_000;

export const DIRECTIONS = ['input', 'output'];

// `model:direction=price` pairs, comma separated, e.g. `gpt-5.5:output=25,gpt-5.5:input=5`.
export function parsePriceOverrides(value) {
  const overrides = new Map();
  if (value == null || value === true || value === '') return overrides;
  for (const part of String(value).split(',')) {
    const match = /^(.+):(input|output)=(\d+(?:\.\d+)?)$/.exec(part.trim());
    if (!match) throw new Error(`--price entries look like model:input=5 or model:output=25, received "${part}"`);
    const price = Number(match[3]);
    if (!(price > 0)) throw new Error(`--price must be positive, received "${part}"`);
    overrides.set(`${match[1]}:${match[2]}`, price);
  }
  return overrides;
}

function directionSummary(rows, direction, spanDays, override) {
  const tokenField = `${direction}_tokens`;
  const costField = `${direction}_cost_usd`;
  const tokens = rows.reduce((sum, event) => sum + Number(event[tokenField] || 0), 0);
  // Price is computed only over events that carry the split, so a source that reports it for some
  // requests and not others does not dilute the price with unpriced tokens.
  const priced = rows.filter((event) => event[costField] != null);
  const pricedTokens = priced.reduce((sum, event) => sum + Number(event[tokenField] || 0), 0);
  const pricedSpend = priced.reduce((sum, event) => sum + Number(event[costField]), 0);
  const gatewayPrice = pricedTokens > 0 && pricedSpend > 0 ? pricedSpend / (pricedTokens / 1e6) : null;
  const price = override ?? gatewayPrice;
  return {
    mtok: tokens / 1e6,
    mtok_per_day: tokens / 1e6 / spanDays,
    avg_price_per_mtok: price == null ? null : Math.round(price * 1e6) / 1e6,
    price_source: override != null ? 'override' : gatewayPrice != null ? 'gateway' : null,
    price_coverage: tokens > 0 ? pricedTokens / tokens : 0,
    spend_usd: pricedSpend
  };
}

export function computeExposure(events, { days = 30, now = new Date().toISOString(), overrides = new Map() } = {}) {
  const end = Date.parse(now);
  const start = end - days * DAY_MS;
  const requests = events.filter((event) => {
    if (event.event_type !== 'request' || !event.model) return false;
    const at = Date.parse(event.timestamp);
    return at >= start && at <= end;
  });
  if (!requests.length) {
    return { window_days: days, span_days: 0, requests: 0, models: [], warnings: ['no request events in the window'] };
  }
  const times = requests.map((event) => Date.parse(event.timestamp));
  // The rate is tokens over the span actually observed, not over the requested window: a gateway
  // connected three days ago must not have its run-rate divided by thirty.
  const spanDays = Math.max(1, (Math.max(...times) - Math.min(...times)) / DAY_MS);
  const groups = new Map();
  for (const event of requests) {
    if (!groups.has(event.model)) groups.set(event.model, []);
    groups.get(event.model).push(event);
  }
  const models = [...groups.entries()].map(([model, rows]) => {
    const input = directionSummary(rows, 'input', spanDays, overrides.get(`${model}:input`));
    const output = directionSummary(rows, 'output', spanDays, overrides.get(`${model}:output`));
    const inputTokens = rows.reduce((sum, event) => sum + Number(event.input_tokens || 0), 0);
    const cachedTokens = rows.reduce((sum, event) => sum + Number(event.cached_input_tokens || 0), 0);
    return {
      model,
      requests: rows.length,
      input,
      output,
      cache_ratio: inputTokens ? cachedTokens / inputTokens : 0,
      spend_usd: rows.reduce((sum, event) => sum + Number(event.actual_cost_usd || 0), 0)
    };
  }).sort((a, b) => b.spend_usd - a.spend_usd || a.model.localeCompare(b.model));

  const warnings = [];
  if (spanDays < 7) warnings.push(`only ${spanDays.toFixed(1)} days observed; the run-rate extrapolated to a year is unreliable`);
  for (const entry of models) {
    for (const direction of DIRECTIONS) {
      const side = entry[direction];
      if (side.mtok > 0 && side.avg_price_per_mtok == null) {
        warnings.push(`${entry.model} ${direction}: gateway reports no ${direction} cost split; pass --price ${entry.model}:${direction}=<$/MTok>`);
      }
    }
    if (entry.cache_ratio > 0.1) {
      warnings.push(`${entry.model}: ${(entry.cache_ratio * 100).toFixed(0)}% of input is cached, so the realized input price is below the list rate it settles against`);
    }
  }
  return { window_days: days, span_days: spanDays, requests: requests.length, models, warnings };
}
