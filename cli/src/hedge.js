// Sizes a $/token hedge from gateway exposure and turns it into limit orders.
//
// The contracts are the `less_or_equal` list-price ladders: YES pays $1 if the provider's
// published price ends at or below the strike. Two postures, because a company can be wrong in
// either direction:
//
//   locked    A committed rate P. List price falling to K strands (P-K) per MTok. Buy YES on every
//             rung with K < P. Rung j covers the step from the rung above it, so the cumulative
//             payout at K equals the loss at K: n_j = V * (K_{j-1} - K_j), K_0 = P.
//   floating  Pays list. List price rising above K costs (K-P) per MTok more. Buy NO on every rung
//             with K > P, n_j = V * (K_j - K_{j-1}), K_0 = P. NO pays when the price ends above K.
//
// V is MTok over the horizon. A contract pays $1, so contracts = dollars of loss covered.
//
// The average realized price P is what selects the strikes. It does not set the order price: that
// is the venue's own book, joined one tick inside the best bid and never at or through the ask.

import { kalshiFee } from './market.js';

const TICK = 0.01;
const DAY_MS = 86_400_000;

export const POSTURES = ['locked', 'floating'];

function round(value, places = 2) {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

// Join one tick inside the best bid, but stay strictly below the ask: a post-only order that would
// cross is rejected by the venue, and one that crossed on a thin book would be a taker fill at
// exactly the price this module exists to avoid. A one-tick spread leaves nothing to improve, so
// the order joins the bid.
export function limitPrice(bid, ask) {
  if (bid == null || ask == null) return { skip: 'one-sided-book' };
  if (ask <= bid) return { skip: 'crossed-book' };
  const improved = Math.min(bid + TICK, ask - TICK);
  return { price: round(Math.max(bid, improved)) };
}

function horizonDaysFor(instrument, now, override) {
  if (override != null) return override;
  const end = Date.parse(instrument.expected_expiration_time || instrument.close_time);
  return Math.max(0, (end - Date.parse(now)) / DAY_MS);
}

function sideFor(posture) {
  return posture === 'locked' ? 'yes' : 'no';
}

// Rungs ordered nearest-the-average first, each paired with the strike it is incremental to.
function rungs(ladder, price, posture) {
  const usable = ladder.filter((instrument) => instrument.strike_direction === 'less_or_equal');
  const ordered = posture === 'locked'
    ? usable.filter((instrument) => instrument.strike < price).sort((a, b) => b.strike - a.strike)
    : usable.filter((instrument) => instrument.strike > price).sort((a, b) => a.strike - b.strike);
  let previous = price;
  return ordered.map((instrument) => {
    const step = Math.abs(previous - instrument.strike);
    previous = instrument.strike;
    return { instrument, step };
  });
}

function totalsOf(legs) {
  return {
    legs: legs.length,
    contracts: legs.reduce((sum, leg) => sum + leg.contracts, 0),
    premium_usd: round(legs.reduce((sum, leg) => sum + leg.premium_usd, 0)),
    fee_usd_upper_bound: round(legs.reduce((sum, leg) => sum + kalshiFee(leg.contracts, leg.limit_price), 0)),
    max_payout_usd: legs.reduce((sum, leg) => sum + leg.payout_usd_if_hit, 0),
    capacity_limited: legs.filter((leg) => leg.limited_by === 'capacity').length
  };
}

export function planHedge({
  matches, posture = 'locked', ratio = 1, horizonDays = null, now = new Date().toISOString(),
  capacityShare = 0.25, premiumBudget = null, maxLegPrice = 0.9, feeRate = 0.07
}) {
  if (!POSTURES.includes(posture)) throw new Error(`posture must be one of ${POSTURES.join(', ')}`);
  if (!(ratio > 0 && ratio <= 1)) throw new Error('ratio must be in (0, 1]');
  if (!(capacityShare > 0 && capacityShare <= 1)) throw new Error('capacityShare must be in (0, 1]');
  const side = sideFor(posture);
  const legs = [];
  const skipped = [];
  let budget = premiumBudget == null ? Infinity : Number(premiumBudget);

  for (const pair of matches.pairs) {
    const price = pair.exposure.avg_price_per_mtok;
    if (price == null) {
      skipped.push({ model: pair.model, direction: pair.direction, reason: 'no-direction-price' });
      continue;
    }
    for (const { instrument, step } of rungs(pair.ladder, price, posture)) {
      const base = {
        ticker: instrument.ticker, model: pair.model, direction: pair.direction, posture, side,
        strike: instrument.strike, avg_price_per_mtok: price
      };
      const horizon = horizonDaysFor(instrument, now, horizonDays);
      const mtok = pair.exposure.mtok_per_day * horizon;
      const wanted = Math.floor(ratio * mtok * step);
      const bid = side === 'yes' ? instrument.yes_bid : instrument.no_bid;
      const ask = side === 'yes' ? instrument.yes_ask : instrument.no_ask;
      const limit = limitPrice(bid, ask);
      if (limit.skip) { skipped.push({ ...base, reason: limit.skip }); continue; }
      if (limit.price >= maxLegPrice) { skipped.push({ ...base, reason: 'deep-in-the-money' }); continue; }
      if (wanted < 1) { skipped.push({ ...base, reason: 'exposure-below-one-contract' }); continue; }

      const capacity = Math.floor(capacityShare * instrument.open_interest);
      let contracts = Math.min(wanted, capacity);
      let limitedBy = contracts < wanted ? 'capacity' : null;
      if (contracts < 1) { skipped.push({ ...base, reason: 'no-capacity', wanted }); continue; }
      const affordable = Math.floor(budget / limit.price);
      if (affordable < contracts) { contracts = affordable; limitedBy = 'budget'; }
      if (contracts < 1) { skipped.push({ ...base, reason: 'budget-exhausted', wanted }); continue; }

      const premium = round(contracts * limit.price);
      budget -= premium;
      legs.push({
        ...base,
        contracts,
        wanted_contracts: wanted,
        limited_by: limitedBy,
        limit_price: limit.price,
        best_bid: bid,
        best_ask: ask,
        premium_usd: premium,
        fee_usd_upper_bound: kalshiFee(contracts, limit.price, feeRate),
        payout_usd_if_hit: contracts,
        share_of_open_interest: instrument.open_interest ? contracts / instrument.open_interest : null,
        horizon_days: round(horizon, 1),
        close_time: instrument.close_time
      });
    }
  }

  return { posture, ratio, as_of: now, legs, skipped, totals: totalsOf(legs) };
}

// The orders the executor consumes. `observed_at` is the plan's own timestamp, so replaying a plan
// is the same order; re-planning later is a new intent and gets a new id, which is why live
// placement nets against held positions first (see netAgainstHoldings).
export function planToSignals(plan) {
  return {
    results: plan.legs.map((leg) => ({
      id: leg.ticker,
      side: leg.side,
      entry_price: leg.limit_price,
      observed_at: plan.as_of,
      close_time: leg.close_time,
      contracts: leg.contracts
    }))
  };
}

// Reduce a plan by what is already held or resting, so running the planner twice does not buy the
// hedge twice. Anything this cannot read is an error, not an empty book: if the holdings response
// is malformed, the safe reading is "unknown", and unknown must not place an order.
export function holdingsFrom({ positions, orders }) {
  const positionRows = positions?.market_positions;
  if (!Array.isArray(positionRows)) throw new Error('positions response has no market_positions array');
  const held = new Map();
  for (const row of positionRows) {
    const count = Number(row.position_fp ?? row.position);
    if (!row.ticker || !Number.isFinite(count)) throw new Error(`unreadable position row: ${JSON.stringify(row).slice(0, 120)}`);
    held.set(row.ticker, count);
  }
  const orderRows = orders?.orders;
  if (!Array.isArray(orderRows)) throw new Error('orders response has no orders array');
  const resting = new Set();
  for (const row of orderRows) {
    if (!row.ticker) throw new Error(`unreadable order row: ${JSON.stringify(row).slice(0, 120)}`);
    resting.add(row.ticker);
  }
  return { held, resting };
}

export function netAgainstHoldings(plan, { held, resting }) {
  const legs = [];
  const skipped = [...plan.skipped];
  for (const leg of plan.legs) {
    if (resting.has(leg.ticker)) {
      skipped.push({ ticker: leg.ticker, model: leg.model, direction: leg.direction, reason: 'resting-order-exists' });
      continue;
    }
    // Positive is YES, negative is NO. Only holdings on the leg's own side count as hedge.
    const signed = held.get(leg.ticker) ?? 0;
    const have = leg.side === 'yes' ? Math.max(0, signed) : Math.max(0, -signed);
    const remaining = leg.contracts - have;
    if (remaining < 1) {
      skipped.push({ ticker: leg.ticker, model: leg.model, direction: leg.direction, reason: 'already-hedged', held: have });
      continue;
    }
    const premium = round(remaining * leg.limit_price);
    legs.push({ ...leg, contracts: remaining, held_contracts: have, premium_usd: premium, payout_usd_if_hit: remaining });
  }
  return { ...plan, legs, skipped, totals: totalsOf(legs), netted: true };
}
