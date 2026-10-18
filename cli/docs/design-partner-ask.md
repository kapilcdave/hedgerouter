# Design-partner ask (for the founder to send)

Draft message, edit freely.

> I'm building Hedgerouter, an open-source tool that reads your AI gateway's logs and tells you,
> in dollars, how much of your model spend is price and how much is volume. It then checks which
> listed contracts, if any, would track that bill.
>
> The ask is small: one export from your gateway (Weave Router, Agentgateway, Cloudflare AI Gateway,
> Vercel AI Gateway, or any OTLP source), run locally by you or on a call with me. It reads
> metadata only: model, provider, token counts, cost, latency, status. It never reads prompts,
> completions, code, paths, credentials or user IDs, and nothing is uploaded. You get your exposure
> report and an honest read on how closely your price tracks a listed contract. I get to learn whether it matches anything tradeable.
>
> No trading, no commitment, and I'll tell you if the answer is "nothing here fits your bill."

## What to do on the call

```sh
hedge init
hedge ingest --format <weave|agentgateway|cloudflare|vercel|otel> --input <their export>
hedge report
hedge exposure
hedge discover
hedge hedge-plan --horizon-days 90
```

Then record, with their permission: monthly spend, share of spend in models that have a listed
contract, whether they pay list or a discounted/committed rate, and the realized $/MTok from
`hedge exposure`. Comparing that to the contract terms is the first real basis number for the memo.

## Who to ask first

Teams already running a gateway with cost fields turned on, spending enough that a few percent
of price risk is a line item. Cloudflare and Vercel users are the easiest, since export is an
API call.
