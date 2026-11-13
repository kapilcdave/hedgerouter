# Hedgerouter landing page

This is `site/` in the hedgerouter monorepo (the CLI is in `cli/`). Static one-page site for
Hedgerouter. No framework, no build step — `index.html`, `styles.css` and `assets/`.

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

## Deploy

The canonical host is **https://hedgerouter.com**. It is a Vercel project
(`kapilcdaves-projects/hedgerouter`) behind a Cloudflare proxy, with `www` redirected to the
apex in `vercel.json`. https://hedgerouter.vercel.app is the deployment alias, not the URL to
share; canonical and `og:` tags point at the apex.

Framework preset: **Other**. No build command, no output directory. The project's Root
Directory is `site`, so that directory is served as-is.

Pushing to `main` deploys to production; any other branch gets a preview URL. The build shows
up on hedgerouter.com within about a minute — Cloudflare caches HTML as
`must-revalidate`, so it does not need purging.

Cloudflare's **Email Address Obfuscation** is on, which rewrites `mailto:` links in the served
HTML to `/cdn-cgi/l/email-protection#…` and decodes them with a script. That is why the
contact link looks encoded in `curl` output but still works in a browser. Turn it off in
Cloudflare → Scrape Shield if the raw HTML needs to carry a usable `mailto:`.
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

The page is a position statement, not a landing page. Structure comes from rules, data and
diagrams; prose is the fallback, not the default.

- **Type roles.** IBM Plex Sans carries both language and display: `h1` and `h2` are the same
  face at 600 weight, tighter tracking and larger size, not a second typeface. IBM Plex Mono
  is for figures, labels, captions and commands. Mono labels are deliberate; do not use it
  for paragraphs.
- **Size floor.** Body copy is 17px and no reading text is below 14.5px. Mono labels sit at
  11–13px; anything smaller reads as texture rather than information. If a label needs to be
  10px to fit, cut the label instead.
- **Palette.** Paper, ink, rule and signal live in `:root`. `--signal` is a deep green used
  for the measurement accent and positive state. There are no dark bands, no gradients, no
  shadows and no third decorative colour. Buttons are the only filled controls.
- **Diagrams are content.** The hero position readout, the four-step flow, the order rail,
  the ladder, the cover-fill bars and the findings row all encode real values from the CLI
  or its published snapshot. If a number changes, regenerate the diagram and the copy
  together. A diagram with invented data is worse than no diagram.
- **No cards and few labels.** The position readout and the ladder are ruled sections, not
  panels. Everything else is a hairline rule, a real table or a list. Radius lives on controls
  (2px) and nowhere else. Claims that are already in the footer or the privacy band do not
  get repeated as a tag row in the hero.
- **Numbered markers only for real sequences.** The four-step flow is numbered because the
  steps run in order. Nothing else is. Sections have no eyebrows or index numbers; the `h2`
  names them.
- **Tables where content is tabular.** Instruments are a table. Status is a checklist, not a
  table, because each line is a state rather than a value. Below 640px the instrument table
  restacks and cells with `data-label` carry their own labels.
- **No motion.** No scroll reveals, no hover transitions.
- Avoid the generic-AI-page tells this was rewritten to remove: eyebrow pills with status
  dots, one word coloured inside a headline, `A · B · C` middle-dot meta strings, spaced
  em-dash labels, tracked ALL-CAPS headings everywhere, and uniform radius plus soft shadow
  on every block. Size and weight are the only display moves.

## Copy

The page sells the measurement half, because that is the half that exists. Three rules when
editing:

1. **Keep it short.** One claim per block. Two sentences is the ceiling for a paragraph;
   if a diagram can carry the point, delete the paragraph. Do not explain the same claim in
   the section header, the lede and the note.
2. **Don't overstate what runs.** The "What runs, what doesn't" section is the contract —
   ingest, the metadata-only boundary, the dollar/token exposure ledger, basis reporting that
   says "not measured" until a real ledger exists, and paper hedge sizing are shipped; the
   order path is built but has never been armed; forward pricing is in progress; compute
   perpetuals, routing and content storage are not instrumented or not built. If a claim
   elsewhere on the page outruns that section, the claim is wrong.

   The order path being built is **not** a hedging claim. `hedge live-status` prints
   `would_arm: false`, and the research gate that would authorise an order has not opened —
   on current data the demand signal scores slightly worse than carrying the last index price
   forward. The page must never imply a hedge executes. "Built, never armed" and "Zero
   placed; gate is shut" are the strongest honest statements, and they are stronger than
   "not built".
3. **Only show commands that exist.** The flow names `hedge ingest`, `hedge exposure`,
   `hedge discover` and `hedge hedge-plan`; the order rail names `hedge live-status`. There
   is no `hedge basis`; basis is not measured. The worked example runs on the synthetic
   ledger (`cli/examples/synthetic-gateway-month.mjs`), not a customer's.

Contact address: `hi@hedgerouter.com` (Email Routing forward, not a mailbox) — it appears in
the close CTA and the footer.
