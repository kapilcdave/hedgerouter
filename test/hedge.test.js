import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { discoverTokenMarkets, instrumentFromMarket, matchExposure, modelMatches, parseListPriceRule, withRetry } from '../src/discover.js';
import { ARM_ENV, ARM_PHRASE, KEY_ID_ENV, PRIVATE_KEY_ENV, executeSignals, executionPaths } from '../src/execute.js';
import { computeExposure, parsePriceOverrides } from '../src/exposure.js';
import { holdingsFrom, limitPrice, netAgainstHoldings, planHedge, planToSignals } from '../src/hedge.js';

const NOW = '2026-10-17T00:00:00.000Z';
const DAY = 86_400_000;

function event(overrides = {}) {
  return {
    event_type: 'request', timestamp: NOW, model: 'gpt-5.5',
    input_tokens: 1_000_000, cached_input_tokens: 0, output_tokens: 500_000,
    input_cost_usd: 5, output_cost_usd: 12.5, actual_cost_usd: 17.5, ...overrides
  };
}

function history(days, perDay = event()) {
  const rows = [];
  for (let day = 0; day <= days; day += 1) {
    rows.push({ ...perDay, timestamp: new Date(Date.parse(NOW) - day * DAY).toISOString() });
  }
  return rows;
}

test('realized price per direction is spend over tokens, from events that carry the split', () => {
  const exposure = computeExposure(history(10), { now: NOW });
  const [gpt] = exposure.models;
  assert.equal(gpt.input.avg_price_per_mtok, 5);
  assert.equal(gpt.output.avg_price_per_mtok, 25);
  assert.equal(gpt.input.price_source, 'gateway');
  // 11 daily events over a 10 day span.
  assert.ok(Math.abs(gpt.output.mtok_per_day - 0.55) < 1e-9);
});

test('a total-only gateway yields no direction price instead of an invented one', () => {
  const rows = history(10, event({ input_cost_usd: undefined, output_cost_usd: undefined }));
  const exposure = computeExposure(rows, { now: NOW });
  assert.equal(exposure.models[0].output.avg_price_per_mtok, null);
  assert.match(exposure.warnings.join('\n'), /gpt-5\.5 output: gateway reports no output cost split/);
});

test('an operator override wins and is labelled as one', () => {
  const overrides = parsePriceOverrides('gpt-5.5:output=30');
  const exposure = computeExposure(history(10), { now: NOW, overrides });
  assert.equal(exposure.models[0].output.avg_price_per_mtok, 30);
  assert.equal(exposure.models[0].output.price_source, 'override');
  assert.throws(() => parsePriceOverrides('gpt-5.5=30'), /model:input=5/);
});

test('the run-rate uses the days observed, not the days requested', () => {
  const exposure = computeExposure(history(2), { now: NOW, days: 30 });
  assert.ok(Math.abs(exposure.span_days - 2) < 1e-9);
  assert.match(exposure.warnings.join('\n'), /only 2\.0 days observed/);
});

test('list-price rules parse into direction, model and strike', () => {
  const rule = parseListPriceRule('If the Output Token Price of OpenAI GPT 5.5 on https://openai.com/api/pricing/ is at or below $25 in 2026, then the market resolves to Yes.');
  assert.deepEqual(rule, { direction: 'output', modelName: 'OpenAI GPT 5.5', url: 'https://openai.com/api/pricing/', strike: 25 });
  const paid = parseListPriceRule('If the Input Token Price (Paid Tier) of Google Gemini 3.5 Flash on https://ai.google.dev/gemini-api/docs/pricing#standard is at or below $1.25 in 2026');
  assert.equal(paid.modelName, 'Google Gemini 3.5 Flash');
  assert.equal(paid.strike, 1.25);
  assert.equal(parseListPriceRule('Will the H100 price exceed $3?'), null);
});

test('a gateway model matches its own contract and a dated snapshot, never a variant', () => {
  assert.ok(modelMatches('OpenAI GPT 5.5', 'gpt-5.5'));
  assert.ok(modelMatches('OpenAI GPT 5.5', 'openai/gpt-5.5-2026-06-01'));
  assert.ok(modelMatches('Claude Opus 4.8', 'claude-opus-4-8'));
  assert.ok(modelMatches('Google Gemini 3.5 Flash', 'gemini-3.5-flash'));
  assert.ok(!modelMatches('OpenAI GPT 5.5', 'gpt-5.5-mini'));
  assert.ok(!modelMatches('Google Gemini 3.5 Flash', 'gemini-3.5-flash-lite'));
  assert.ok(!modelMatches('Claude Opus 4.8', 'claude-opus-4-7'));
});

function market(strike, overrides = {}) {
  return {
    ticker: `KXGBT55OY-27-NA-${strike}`, event_ticker: 'KXGBT55OY-27', strike_type: 'less_or_equal', cap_strike: strike,
    close_time: '2027-04-01T15:00:00Z', expected_expiration_time: '2027-01-01T15:00:00Z',
    rules_primary: `If the Output Token Price of OpenAI GPT 5.5 on https://openai.com/api/pricing/ is at or below $${strike} in 2026, then the market resolves to Yes.`,
    yes_bid_dollars: '0.1200', yes_ask_dollars: '0.1600', no_bid_dollars: '0.8400', no_ask_dollars: '0.8800',
    open_interest_fp: '10000.00', ...overrides
  };
}

test('a market whose rule strike disagrees with its cap_strike is not an instrument', async () => {
  const bad = market(25, { cap_strike: 20 });
  assert.equal(instrumentFromMarket(bad).consistent, false);
  const fetchImpl = async (url) => ({
    ok: true, status: 200,
    json: async () => (String(url).includes('/markets')
      ? { markets: [market(20), bad, { ...market(15), rules_primary: 'Will a thing happen?' }], cursor: '' }
      : { series: [] })
  });
  const found = await discoverTokenMarkets({ series: ['KXGBT55OY'], fetchImpl, retry: false });
  assert.deepEqual(found.instruments.map((item) => item.strike), [20]);
  assert.equal(found.rejected.length, 2);
});

test('429s are retried with backoff and then surfaced', async () => {
  let calls = 0;
  const sleeps = [];
  const wrapped = withRetry(async () => ({ status: ++calls < 3 ? 429 : 200 }), { sleep: async (ms) => sleeps.push(ms), delayMs: 10 });
  assert.equal((await wrapped('x')).status, 200);
  assert.deepEqual(sleeps, [10, 20]);
  const stuck = withRetry(async () => ({ status: 429 }), { attempts: 2, sleep: async () => {} });
  assert.equal((await stuck('x')).status, 429);
});

test('limit prices join one tick inside the bid and never touch the ask', () => {
  assert.deepEqual(limitPrice(0.11, 0.14), { price: 0.12 });
  assert.deepEqual(limitPrice(0.11, 0.12), { price: 0.11 });
  assert.deepEqual(limitPrice(0.11, 0.13), { price: 0.12 });
  assert.deepEqual(limitPrice(null, 0.14), { skip: 'one-sided-book' });
  assert.deepEqual(limitPrice(0.2, 0.2), { skip: 'crossed-book' });
});

function ladder(strikes, overrides = {}) {
  return strikes.map((strike) => ({
    ticker: `T-${strike}`, strike, strike_direction: 'less_or_equal', direction: 'output', model_name: 'OpenAI GPT 5.5',
    close_time: '2027-04-01T15:00:00Z', expected_expiration_time: '2027-01-01T15:00:00Z',
    yes_bid: 0.1, yes_ask: 0.14, no_bid: 0.86, no_ask: 0.9, open_interest: 1_000_000, ...overrides
  }));
}

function matches(strikes, { price = 25, perDay = 1000 / 365, overrides } = {}) {
  return {
    pairs: [{
      model: 'gpt-5.5', direction: 'output',
      exposure: { mtok_per_day: perDay, avg_price_per_mtok: price },
      ladder: ladder(strikes, overrides)
    }],
    unhedgeable: []
  };
}

test('a locked rate is hedged rung by rung so cumulative payout equals the loss at each strike', () => {
  // 1,000 MTok over a 365 day horizon, locked at $25: the worked example in docs/list-price-token-markets.md.
  const plan = planHedge({ matches: matches([25, 20, 15, 10]), horizonDays: 365, now: NOW });
  assert.deepEqual(plan.legs.map((leg) => [leg.strike, leg.contracts]), [[20, 5000], [15, 5000], [10, 5000]]);
  assert.ok(plan.legs.every((leg) => leg.side === 'yes'));
  // YES pays at or below the strike, so the cumulative payout if price ends at 10 is 15,000 = (25-10) x 1,000.
  assert.equal(plan.totals.max_payout_usd, 15_000);
});

test('a floating-price payer buys NO on rungs above the average, priced off the NO book', () => {
  const plan = planHedge({ matches: matches([20, 30, 40], { price: 25 }), posture: 'floating', horizonDays: 365, now: NOW });
  assert.deepEqual(plan.legs.map((leg) => [leg.strike, leg.side, leg.contracts]), [[30, 'no', 5000], [40, 'no', 10_000]]);
  assert.equal(plan.legs[0].best_bid, 0.86);
  assert.equal(plan.legs[0].limit_price, 0.87);
});

test('the hedge ratio, the capacity share and the premium budget each bind and say so', () => {
  const half = planHedge({ matches: matches([20]), horizonDays: 365, ratio: 0.5, now: NOW });
  assert.equal(half.legs[0].contracts, 2500);

  const crowded = planHedge({ matches: matches([20], { overrides: { open_interest: 8000 } }), horizonDays: 365, now: NOW });
  assert.equal(crowded.legs[0].contracts, 2000);
  assert.equal(crowded.legs[0].limited_by, 'capacity');
  assert.equal(crowded.legs[0].wanted_contracts, 5000);

  const poor = planHedge({ matches: matches([20]), horizonDays: 365, premiumBudget: 100, now: NOW });
  assert.equal(poor.legs[0].contracts, 909);
  assert.equal(poor.legs[0].limited_by, 'budget');
  assert.ok(poor.legs[0].premium_usd <= 100);
});

test('one-sided, deep in-the-money and unpriced legs are skipped with a reason, not guessed', () => {
  const one = planHedge({ matches: matches([20], { overrides: { yes_bid: null } }), horizonDays: 365, now: NOW });
  assert.deepEqual(one.skipped.map((row) => row.reason), ['one-sided-book']);
  const deep = planHedge({ matches: matches([20], { overrides: { yes_bid: 0.93, yes_ask: 0.96 } }), horizonDays: 365, now: NOW });
  assert.deepEqual(deep.skipped.map((row) => row.reason), ['deep-in-the-money']);
  const unpriced = planHedge({ matches: matches([20], { price: null }), horizonDays: 365, now: NOW });
  assert.deepEqual(unpriced.skipped.map((row) => row.reason), ['no-direction-price']);
  assert.equal(unpriced.legs.length, 0);
});

test('unmatched models are reported as unhedgeable exposure', () => {
  const exposure = computeExposure([
    ...history(10),
    ...history(10, event({ model: 'gpt-5.5-mini' }))
  ], { now: NOW });
  const found = matchExposure(exposure, ladder([20]));
  assert.deepEqual(found.pairs.map((pair) => `${pair.model}:${pair.direction}`), ['gpt-5.5:output']);
  assert.deepEqual(found.unhedgeable.map((row) => `${row.model}:${row.direction}`).sort(), ['gpt-5.5-mini:input', 'gpt-5.5-mini:output', 'gpt-5.5:input']);
});

test('netting subtracts what is held on the same side and skips tickers with a resting order', () => {
  const plan = planHedge({ matches: matches([20, 15]), horizonDays: 365, now: NOW });
  const holdings = holdingsFrom({
    positions: { market_positions: [{ ticker: 'T-20', position: 3000 }, { ticker: 'T-15', position: -100 }] },
    orders: { orders: [] }
  });
  const netted = netAgainstHoldings(plan, holdings);
  assert.deepEqual(netted.legs.map((leg) => [leg.ticker, leg.contracts, leg.held_contracts]), [['T-20', 2000, 3000], ['T-15', 5000, 0]]);
  assert.equal(netted.totals.contracts, 7000);

  const resting = netAgainstHoldings(plan, holdingsFrom({
    positions: { market_positions: [] }, orders: { orders: [{ ticker: 'T-20' }] }
  }));
  assert.deepEqual(resting.legs.map((leg) => leg.ticker), ['T-15']);
  assert.ok(resting.skipped.some((row) => row.reason === 'resting-order-exists'));

  const full = netAgainstHoldings(plan, holdingsFrom({
    positions: { market_positions: [{ ticker: 'T-20', position: 9000 }, { ticker: 'T-15', position: 9000 }] }, orders: { orders: [] }
  }));
  assert.equal(full.legs.length, 0);
});

test('a holdings response that cannot be read is an error, never an empty account', () => {
  assert.throws(() => holdingsFrom({ positions: {}, orders: { orders: [] } }), /no market_positions/);
  assert.throws(() => holdingsFrom({ positions: { market_positions: [{ ticker: 'T', position: 'x' }] }, orders: { orders: [] } }), /unreadable position/);
  assert.throws(() => holdingsFrom({ positions: { market_positions: [] }, orders: null }), /no orders array/);
});

async function workspace() {
  return executionPaths(await mkdtemp(path.join(tmpdir(), 'hedge-router-hedge-')));
}

function forbiddenFetch() {
  return () => { throw new Error('dry run opened a socket'); };
}

test('a closed gate holds hedge orders as a dry run that still reports them', async () => {
  const paths = await workspace();
  const plan = planHedge({ matches: matches([20, 15]), horizonDays: 365, now: NOW });
  process.env[ARM_ENV] = ARM_PHRASE;
  try {
    const result = await executeSignals({
      signals: planToSignals(plan), live: true, paths, fetchImpl: forbiddenFetch(),
      limits: { maxContractsPerOrder: 6000, maxNotionalPerOrder: 700, maxNotionalPerRun: 1500 },
      contractsFor: (signal) => signal.contracts
    });
    assert.equal(result.mode, 'dry-run');
    assert.ok(result.blockers.some((row) => row.reason === 'gate-closed'));
    assert.equal(result.orders.length, 2);
    assert.equal(result.orders[0].request.side, 'bid');
  } finally {
    delete process.env[ARM_ENV];
  }
});

test('with the gate open, the phrase and a key, a hedge leg is sent as a post-only bid', async () => {
  const paths = await workspace();
  await writeFile(paths.evaluation, JSON.stringify({
    gate: true, independent_events: 30, relative_brier_improvement: 0.06, paper_pnl: 1.25
  }));
  const keyPath = path.join(paths.dataDir, 'key.pem');
  await writeFile(keyPath, generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const plan = planHedge({ matches: matches([20]), horizonDays: 365, premiumBudget: 100, now: NOW });
  const sent = [];
  const fetchImpl = async (url, options) => {
    sent.push({ url: String(url), body: JSON.parse(options.body) });
    return { ok: true, status: 200, text: async () => JSON.stringify({ order_id: 'o1' }) };
  };
  process.env[ARM_ENV] = ARM_PHRASE;
  process.env[KEY_ID_ENV] = 'key';
  process.env[PRIVATE_KEY_ENV] = keyPath;
  try {
    const result = await executeSignals({
      signals: planToSignals(plan), live: true, paths, fetchImpl,
      limits: { maxContractsPerOrder: 1000, maxNotionalPerOrder: 120, maxNotionalPerRun: 120 },
      contractsFor: (signal) => signal.contracts
    });
    assert.equal(result.mode, 'live');
    assert.equal(sent.length, 1);
    assert.ok(sent[0].url.endsWith('/trade-api/v2/portfolio/events/orders'));
    assert.deepEqual([sent[0].body.ticker, sent[0].body.side, sent[0].body.count, sent[0].body.price, sent[0].body.post_only],
      ['T-20', 'bid', '909', 0.11, true]);
    assert.match(await readFile(paths.journal, 'utf8'), /"phase":"placed"/);
  } finally {
    delete process.env[ARM_ENV];
    delete process.env[KEY_ID_ENV];
    delete process.env[PRIVATE_KEY_ENV];
  }
});
