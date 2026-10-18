# Hedgerouter: preseed memo (draft, 2026-10-17)

Status: draft for the founder to edit. Every number is from the repo or a named public source. The
two blanks, design partners and the first real basis number, are not filled in because they do not
exist yet.

## One line

Hedgerouter turns a company's AI gateway logs into a dollar position, then finds, sizes and
nets the listed contracts that could cap it.

## The problem

Companies shipping on model APIs carry a commodity position that finance cannot see. Engineering
sees tokens per request, finance sees one invoice a month, and neither can say how much of next
quarter's spend is price and how much is volume. The price half is now tradeable: Kalshi lists
contracts that settle on the provider's own published price page (OpenAI GPT 5.5, Claude Opus 4.8,
Gemini 3.5 Flash, input and output, annual tenor). If you pay list, the settlement variable is your
cost, not a proxy for it. See `docs/list-price-token-markets.md`.

## What exists today (all in the repo, MIT)

- Metadata-only ingest from Weave Router, Agentgateway, OTLP, Cloudflare AI Gateway and Vercel AI
  Gateway, behind an allowlist that never reads prompts, completions, paths, credentials or user IDs.
- `exposure`: tokens per day and realized $/MTok per model and direction, from the gateway's own cost.
- `discover`: finds the live per-token list-price contracts and matches them to the models in use.
  On 2026-10-18 it found 24 instruments across the three covered models.
- `hedge-plan` and `hedge-open`: sizes a rung-by-rung hedge, nets it against held positions, prices
  limit orders one tick inside the bid, never at or through the ask. A dry run unless five interlocks
  agree. No live order has ever been placed.
- 152 passing tests, no runtime dependencies. Live site at hedgerouter.vercel.app.

## What we measured that is not obvious

1. **The settlement source is auditable.** The earlier index-settled token markets reconstruct
   exactly from a public endpoint (8 of 8 ladders, zero exceptions), and the model-author share
   markets settle on requests, not tokens, whatever their rules text says (`docs/settlement-sources.md`).
2. **List-price contracts remove most of the basis chain.** Rental price to serving cost to posted
   price to invoice collapses to one link for a company that pays list.
3. **Depth, not price, is the binding constraint.** Total open interest across every open
   list-price ladder was about 49,900 contracts on 2026-10-18. A synthetic company spending $15.4k a
   month could fill 8% of full input cover and 24% of full output cover at a 25% open-interest cap
   (`docs/worked-example.md`). Premium for what filled was $606.
4. **Our own demand signal does not yet beat carrying the last price forward.** The research gate that
   would authorise a live order is shut for that reason, and we keep it shut.

## What is not proven

- **Basis on a real bill.** This is the main thing. The worked example is synthetic and built to
  sit on the committed rate. One real company's ledger, run through `hedge basis`, is the first
  evidence of whether a bill tracks these contracts. [blank: not yet measured]
- **Demand.** No design partner yet. [blank: fill in when there is one]
- **Fit of a dated binary to a continuous cost line.** List prices change rarely and in steps; a
  company that is not on list price, or is on a discount or committed-spend contract, has weaker
  basis.
- **Venue depth growing.** The product is only as large as the listed markets. A compute perpetual
  would fit better and is not listed.
- **Value of the premiums.** We have not tested whether the market prices list-price moves well.

## Why this could be a company anyway

The measurement half is useful with no market at all: a dollar position split into price and
volume, concentration by model, and an honest statement of how much of it any instrument covers.
It is the layer a finance team needs before it can ask the hedging question, and it works on logs
the company already emits. If depth grows, the same ledger already sizes the order. If it does not,
the product is still the exposure report.

## The ask and the plan

Preseed to get to the first real answer: three to five design partners running a gateway, each
producing a real ledger and a real basis number; a decision at that point on whether to arm the
order path with a small, capped live position; and a read on whether the exposure report alone
sells. [blank: amount and runway]

## Risks to say out loud

Market depth is small and may stay small. The reference venue is one exchange. Providers can change
what their price page shows. A company's contract may not be at list. Regulatory treatment of
event contracts used for hedging is not something this memo assesses.
