# Hedgerouter

Turn a company's AI gateway logs into a dollar position, then find, size and net the listed
contracts that could cap it. Experimental and paper-only: no live order has ever been placed.

| directory | what it is |
| --- | --- |
| [`cli/`](cli) | The `hedge` command line tool: ingest, exposure ledger, contract discovery, hedge sizing. Node 20+, no runtime dependencies, MIT. Start with [`cli/README.md`](cli/README.md). |
| [`site/`](site) | The landing page, a static site deployed to Vercel. See [`site/README.md`](site/README.md). |

```sh
cd cli
npm link
hedge init
```

Docs live in [`cli/docs`](cli/docs): the [worked example](cli/docs/worked-example.md), the
[preseed memo](cli/docs/preseed-memo.md), and the research notes behind the instruments.
