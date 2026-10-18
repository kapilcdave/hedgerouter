# Worked example: ledger to sized hedge, on a synthetic company

The company here is invented. `examples/synthetic-gateway-month.mjs` writes 30 days of Weave-format
routing decisions for one model (`gpt-5.5`) at a committed rate of $5 per MTok input and $30 per
MTok output, about $15.4k a month. Each row is one hour of traffic, where a real export has one row
per request. The order books are real: `discover` reads Kalshi's public API, unauthenticated.

Nothing below sends an order. `hedge-plan` never trades, and `hedge-open` is a dry run unless
`--live` is passed and the research gate is open (it is not).

```sh
mkdir demo && cd demo
node ../examples/synthetic-gateway-month.mjs > month.ndjson   # SYNTHETIC
hedge init
hedge ingest --format weave --input month.ndjson

hedge exposure                         # tokens/day and realized $/MTok, per model and direction
hedge discover --output instruments.json   # live per-token list-price contracts, matched to your models
hedge hedge-plan --instruments instruments.json --horizon-days 90 --output plan.json
```

## What it printed (18 October 2026)

`exposure`: 49.6 MTok/day of input at $5.00 and 9.0 MTok/day of output at $30.00.

`discover`: 24 instruments across 23 candidate series, 39 markets rejected because their rules do
not name a published per-token list price. The three models with an open ladder are GPT 5.5,
Claude Opus 4.8 and Gemini 3.5 Flash. Total open interest across every ladder was about 49,900
contracts (GPT 5.5 25.1k, Claude Opus 4.8 15.1k, Gemini 3.5 Flash 9.6k).

`hedge-plan --posture locked --horizon-days 90`:

| side | committed | rungs bought | full cover (contracts) | fillable now | premium |
| --- | --- | --- | --- | --- | --- |
| input | $5 | $4, $3, $2, $1 | 17,836 | 1,506 (8%) | $229.11 |
| output | $30 | $25, $20, $15 | 16,108 | 3,939 (24%) | $377.29 |

Totals: 7 limit orders, 5,445 contracts, $606.40 premium, fees at most $36.81. The $10 output rung was
skipped because it has no bid.

## How to read it

A locked rate P loses (P − K) per MTok if list price falls to K. Buying YES on each
`less_or_equal` rung below P, sized so the cumulative payout at K equals the loss at K, is the
cover. A contract pays $1, so contracts equal dollars of loss covered. "Full cover" is that count.

Every order was limited by capacity, not by budget. The planner caps each rung at 25% of that
rung's open interest, so a company this size can fill only a fraction of what it would want. That is
the finding to carry forward. The instruments exist, are priced, and settle on the published price
page, but the depth is thin. Order prices join one tick inside the best bid and never at or through
the ask, so there is no taker cost to hide.

## What this does not show

- Whether any real company's bill moves with these contracts. This ledger was built to sit exactly
  on the committed rate, so basis is perfect by construction. Comparing a real ledger's
  realized $/MTok and contract terms to the contract is the missing number. There is no `hedge basis`
  command yet, and the planner reports basis as not measured.
- Whether the premiums are good value. These are binary contracts on a list price that a provider
  changes rarely; whether the market prices that well is not tested here.
- That a live order would fill. The order path has never been armed.
