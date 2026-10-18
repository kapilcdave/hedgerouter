# Hedgerouter landing page

Static one-page site for Hedgerouter. No framework, no build step — `index.html`,
`styles.css` and `assets/`.

```
index.html              the page
styles.css              all styles
assets/mark.svg         the mark, traced from the source PNG (used as a CSS mask,
                        so it takes the surrounding text colour)
assets/favicon.svg      ink mark on paper; favicon.png / apple-touch-icon.png /
                        icon-512.png are rasterized from it
assets/og.png           1200x630 social card
assets/hedgerouter-lockup.png   original supplied logo lockup (mark + wordmark)
tools/png-to-svg.mjs    PNG -> rectangle-decomposed SVG tracer (no deps)
tools/og-template.html  source for assets/og.png
```

## Local preview

```sh
python3 -m http.server 4321
# http://localhost:4321
```

## Deploy to Vercel

Project: `kapilcdaves-projects/hedgerouter` → https://hedgerouter.vercel.app

Framework preset: **Other**. No build command, no output directory — the repo root
is served as-is.

Pushing to `main` deploys to production; any other branch gets a preview URL.
Manual deploys, if the Git integration is ever down:

```sh
npx vercel --scope kapilcdaves-projects            # preview
npx vercel --prod --scope kapilcdaves-projects     # production
```

`--scope` is required: the global CLI config has a `currentTeam` this account
can't access, so unscoped commands fail with a team error.

## Regenerating assets

The mark SVG is traced from `assets/mark.png` (a cropped copy of the supplied
lockup). Re-run after replacing the source:

```sh
node tools/png-to-svg.mjs assets/mark.png assets/mark.svg
```

The social card is an HTML template screenshotted at 1200x630:

```sh
python3 -m http.server 4321 &
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --hide-scrollbars --window-size=1200,630 \
  --screenshot=assets/og.png --virtual-time-budget=6000 \
  http://localhost:4321/tools/og-template.html
```

## Design rules

The page is styled as a risk memo, not a landing page. The principle: **nothing
here is decoration — every rule, number and label carries information.** These
are deliberate constraints, so don't relax them by accident:

- **Palette is six values**, all in `:root`: paper, paper-2, ink, ink-2, rule,
  signal. `--signal` is for interactive things only; it is not an accent to
  sprinkle. No third colour, no gradients, no shadows anywhere.
- **Two type roles.** IBM Plex Sans for everything read as language; IBM Plex
  Mono only inside the CLI block and for figures. Mono is never a label font.
- **No cards.** Structure comes from hairline rules and real tables. `border-radius`
  exists on buttons (2px) and nowhere else.
- **Tables where content is tabular** — instruments, status, the privacy
  allowlist. Below 620px they restack, and the four-column table carries its own
  column labels via `data-label`.
- **Numbered markers only for real sequences.** The pipeline is numbered because
  it is one; the four exposure facts are simultaneous, so they are a ruled
  definition list instead.
- **No motion.** No scroll reveals, no hover transitions.
- Avoid the generic-AI-page tells this was rewritten to remove: eyebrow pills with
  status dots, one word coloured inside a headline, `A · B · C` middle-dot meta
  strings, spaced em-dash labels, tracked ALL-CAPS mono headings, and uniform
  radius plus soft shadow on every block.

## Copy

The page sells the measurement half, because that is the half that exists. Two
rules when editing:

1. **Don't overstate what runs.** The "What runs today, and what doesn't" section
   is the contract — ingest, the metadata-only boundary, the dollar/token exposure
   ledger, basis reporting and paper hedge sizing are shipped; the order path is
   built but has never been armed; forward pricing is in progress; compute
   perpetuals, routing and content storage are not instrumented or not built.
   If a claim elsewhere on the page outruns that section, the claim is wrong.

   The order path being built is **not** a hedging claim. `hedge-router
   live-status` prints `would_arm: false`, and the research gate that would
   authorise an order has not opened — on current data the demand signal scores
   slightly worse than carrying the last index price forward. The page must never
   imply a hedge executes. "Built, never armed" and "Zero placed; gate is shut"
   are the strongest honest statements, and they are stronger than "not built".
2. **Numbers in the terminal block are an illustrative run**, not a customer's.
   Keep them plausible and internally consistent (spend, token count, model
   concentration, basis fraction).

Contact address: `hi@hedgerouter.com` (Email Routing forward, not a mailbox) — it appears in
the close CTA and the footer.
