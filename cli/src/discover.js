// Finds the Kalshi contracts that settle on a provider's own published $/MTok price, and matches
// them to the models a company actually calls.
//
// Discovery is by contract text, not by label. `/series?category=` is many-to-many and misses
// series (docs/list-price-token-markets.md), and `no_sub_title` duplicates `yes_sub_title`, so the
// only trustworthy description of what a market pays on is `rules_primary`. A market is a hedge
// instrument only if that sentence parses into (direction, model, strike); everything else is
// reported as not hedgeable rather than guessed at.

import { KALSHI_API_BASE_URL, fetchKalshiMarkets } from './kalshi.js';
import { strikeFor } from './market.js';

const CATEGORIES = ['Commodities', 'Financials'];
const CANDIDATE_SERIES = /token|gpt|opus|sonnet|haiku|claude|gemini|llama|deepseek|grok|mistral|qwen/i;

// "If the Output Token Price of OpenAI GPT 5.5 on https://… is at or below $25 in 2026, …"
// The parenthetical covers "Input Token Price (Paid Tier)".
const LIST_PRICE_RULE = /\b(Input|Output) Token Price(?: \([^)]*\))? of (.+?) on (https?:\/\/\S+?) is (?:at or below|above) \$([\d,]+(?:\.\d+)?)/i;

export function parseListPriceRule(rules) {
  const match = LIST_PRICE_RULE.exec(String(rules || ''));
  if (!match) return null;
  return {
    direction: match[1].toLowerCase(),
    modelName: match[2].trim(),
    url: match[3],
    strike: Number(match[4].replaceAll(',', ''))
  };
}

const PROVIDER_WORDS = new Set(['openai', 'anthropic', 'google', 'vertex', 'bedrock', 'azure', 'xai', 'meta', 'deepseek']);

function tokens(name) {
  return String(name)
    .toLowerCase()
    .split('/').slice(-1)[0]
    .split(/[^a-z0-9]+/)
    .filter((token) => token && !PROVIDER_WORDS.has(token));
}

// A gateway model id matches a contract's model name when it is that name plus, at most, a dated
// snapshot suffix. "gpt-5.5-2026-06-01" is GPT 5.5; "gpt-5.5-mini" is a different product with a
// different price page, and hedging it with GPT 5.5 strikes would be basis risk dressed as cover.
export function modelMatches(contractModelName, gatewayModel) {
  const wanted = tokens(contractModelName);
  const have = tokens(gatewayModel);
  if (!wanted.length || have.length < wanted.length) return false;
  if (!wanted.every((token, index) => have[index] === token)) return false;
  return have.slice(wanted.length).every((token) => /^\d+$/.test(token));
}

function quote(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number < 1 ? number : null;
}

export function instrumentFromMarket(market) {
  const rule = parseListPriceRule(market.rules_primary);
  if (!rule) return null;
  const { strikeDirection, threshold } = strikeFor(market);
  return {
    venue: 'kalshi',
    kind: 'binary',
    family: 'list-price',
    ticker: market.ticker,
    event_ticker: market.event_ticker,
    direction: rule.direction,
    model_name: rule.modelName,
    settlement_url: rule.url,
    strike: threshold,
    strike_direction: strikeDirection,
    close_time: market.close_time,
    expected_expiration_time: market.expected_expiration_time || market.close_time,
    yes_bid: quote(market.yes_bid_dollars),
    yes_ask: quote(market.yes_ask_dollars),
    no_bid: quote(market.no_bid_dollars),
    no_ask: quote(market.no_ask_dollars),
    yes_bid_size: Number(market.yes_bid_size_fp || 0),
    yes_ask_size: Number(market.yes_ask_size_fp || 0),
    open_interest: Number(market.open_interest_fp || 0),
    volume_24h: Number(market.volume_24h_fp || 0),
    // The strike is the one fact the title cannot be trusted for; the rule text and the strike
    // field must agree or the market is described inconsistently and is not hedged against.
    consistent: Math.abs(rule.strike - threshold) < 1e-9
  };
}

// The public API answers 429 after a few dozen quick requests, and a discovery sweep is exactly
// that. Back off and retry rather than failing a sweep that was ninety percent done.
export function withRetry(fetchImpl, { attempts = 6, delayMs = 400, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  return async (url, options) => {
    for (let attempt = 0; ; attempt += 1) {
      const response = await fetchImpl(url, options);
      if (response.status !== 429 || attempt + 1 >= attempts) return response;
      await sleep(delayMs * 2 ** attempt);
    }
  };
}

async function listJson(url, fetchImpl) {
  const response = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Kalshi API returned HTTP ${response.status} for ${new URL(url).pathname}`);
  return response.json();
}

export async function listCandidateSeries({ baseUrl = KALSHI_API_BASE_URL, fetchImpl = fetch } = {}) {
  const found = new Map();
  for (const category of CATEGORIES) {
    const url = new URL(`${baseUrl.replace(/\/$/, '')}/series`);
    url.searchParams.set('category', category);
    const page = await listJson(url, fetchImpl);
    for (const series of page.series || []) {
      if (CANDIDATE_SERIES.test(`${series.ticker} ${series.title}`)) found.set(series.ticker, series.title);
    }
  }
  return [...found.entries()].map(([ticker, title]) => ({ ticker, title }));
}

export async function discoverTokenMarkets({ baseUrl = KALSHI_API_BASE_URL, fetchImpl: rawFetch = fetch, series = null, retry = true } = {}) {
  const fetchImpl = retry ? withRetry(rawFetch) : rawFetch;
  const candidates = series?.length
    ? series.map((ticker) => ({ ticker, title: null }))
    : await listCandidateSeries({ baseUrl, fetchImpl });
  const instruments = [];
  const rejected = [];
  for (const candidate of candidates) {
    const markets = await fetchKalshiMarkets({ series: candidate.ticker, status: 'open', baseUrl, fetchImpl });
    for (const market of markets) {
      try {
        const instrument = instrumentFromMarket(market);
        if (!instrument) rejected.push({ ticker: market.ticker, reason: 'rules do not name a published per-token list price' });
        else if (!instrument.consistent) rejected.push({ ticker: market.ticker, reason: 'rule strike and cap_strike disagree' });
        else instruments.push(instrument);
      } catch (error) {
        rejected.push({ ticker: market.ticker, reason: error.message });
      }
    }
  }
  return {
    discovered_at: new Date().toISOString(),
    series: candidates,
    instruments: instruments.sort((a, b) => a.ticker.localeCompare(b.ticker)),
    rejected
  };
}

// Pairs each (gateway model, direction) the company actually uses with the ladder that settles on
// that model's price. Exposure with no ladder is returned, not dropped: "you spend $X on a model
// nothing can hedge" is the second most useful thing this command says.
export function matchExposure(exposure, instruments) {
  const pairs = [];
  const unhedgeable = [];
  for (const entry of exposure.models) {
    for (const direction of ['input', 'output']) {
      const side = entry[direction];
      if (!(side.mtok > 0)) continue;
      const ladder = instruments.filter((instrument) =>
        instrument.direction === direction && modelMatches(instrument.model_name, entry.model));
      if (ladder.length) pairs.push({ model: entry.model, direction, exposure: side, ladder });
      else unhedgeable.push({ model: entry.model, direction, mtok: side.mtok, spend_usd: side.spend_usd });
    }
  }
  return { pairs, unhedgeable };
}
