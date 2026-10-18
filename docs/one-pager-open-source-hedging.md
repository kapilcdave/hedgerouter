# Markets on open-source and open-weights risk: which public sources can actually settle them

*Kapil Dave — for Nelson, 2026-09-25. Every figure below was read from the named
public source; the reproductions run from scripts in this repo.*

The developer world now carries a shared, compounding exposure to software and
models it does not control: a package can be deprecated or a release yanked, a
repository archived, a licence changed, a model gated, downloadable weights held
back. That exposure is legible in public metadata, which is what makes it a
candidate for a listed market. The hard part is never the idea — it is finding a
source a payout can be defended against months after settlement. This is a survey
of the open-source and open-weights sources against that test. I've left the
software-supply-chain / CVE side out, since that's the piece you're already
carrying.

## Start from what the platform already accepts

Two families are already live, both on the *demand* side, and they set a useful
baseline for what a settlement source can look like here.

The open-vs-closed token-share market settles on a single vendor chart. That chart
has no public API, no stated methodology for what counts as open weights, and no
archive — the resolving number is one only its publisher can see, computed a way
they haven't described. It trades, but it can't be re-audited, which is the one
property a defensible settlement needs.

The larger family settles on model-author market share and is roughly 28× the size
of the first (about 284 markets, ~3.1M contracts of lifetime volume). The
non-obvious thing about it — and the most useful finding I have for you — is that
it settles on **requests, not tokens**, even though the rule says "text market
share." Those are different numbers and they don't even rank the authors the same
way: for the week of Sep 14, Google was ~18.8% of requests but ~5.4% of tokens,
Tencent ~6.5% and ~13.4%. The settled prints follow requests every time — mean
absolute error 0.086 share points on requests against 5.35 on tokens across five
prints, with a sixth author scored only after the recipe was fixed and landing
within 0.03. It's reproducible from a free, unauthenticated endpoint. The catch is
that the endpoint serves only one trailing week with no history, so most already-
settled prints can no longer be checked by anyone. A weekly archive is the whole
fix, and it's running here since Sep 20.

The lesson from both: the venue is comfortable settling on a vendor dashboard, but
the ones that trade well and the ones that can be audited are not the same set.

## The bar every proposed source has to clear

Public and free · archived (re-readable after settlement, not just live) · a stated
method for the number · a fixed schedule · a revision policy · and indifferent to
the publisher's own product decisions (a chart that can drop an author from view
turns absence into an automatic loss).

## The open-source / open-weights sources, judged on that bar

| source | what it settles | where it's strong / where it breaks |
| --- | --- | --- |
| Package registries (npm, PyPI) | deprecation, a yanked release, licence metadata on a named basket | mechanical and daily; registries are the underlying of record. Reversible flags mean observation window matters. Don't settle on download counts — PyPI doesn't publish them. |
| deps.dev | the mapping layer to define a cross-ecosystem basket | best route to a broad, defensible basket; settle each outcome on the underlying registry, not a basket calc that only we can run |
| GitHub repository API | archived / disabled status, last activity, releases, licence | clean single-field reads; a "any repo in a fixed basket archived by year-end" market is well posed. A missing repo is unresolved, not archived. Maintainers can reverse an archive. |
| Hugging Face model cards | a model becoming gated, or its licence changing | the only source that touches what a self-hoster actually fears, and it's an unauthenticated read. Its one weakness — no history — is the one we can fix ourselves with a daily snapshot (running here since Sep 21). A missing model returns 401, so *disappearance* is the event this source alone can't confirm. |
| Epoch AI model registry | whether a frontier open-weights model was released, under a documented capability test | the cleanest provenance of the set: public, archived, methodologically documented, CC-BY. Additions lag the release by ~2 weeks, so it's an annual-tenor source, not an intraday one. |
| Vercel AI Gateway | model availability, provider routing, deprecation signals | genuinely useful for market *discovery* and monitoring; not a settlement source until Vercel exposes stable, archivable history rather than a rendered chart. |

## What I'd recommend, and in what order

1. **Package baskets first.** A fixed critical-dependency basket for deprecation and
   yanks, plus a repository-archive basket, settled on the registries and GitHub. The
   data is mechanical, the buyers (anyone shipping on these dependencies) are broad,
   and every outcome is re-auditable.
2. **Model availability next**, on Hugging Face gating and licence changes, backed by
   an owned daily snapshot so the history exists at settlement time. This is the one
   that maps to the exposure a self-hoster carries rather than to someone else's
   traffic mix.
3. **Open-weights release on an annual tenor**, on Epoch AI, which has the best
   provenance for "did a frontier open model ship in 2027."

Baskets, namespaces, and aggregation rules get fixed at listing; each contract names
its exact source, its observation time, the event-date-vs-report-date distinction, a
revision window, and how missing data resolves. If a rule can't be written
mechanically, it isn't ready to list.

## The one gap worth naming

Everything above argues the *source* is settleable. What it doesn't yet prove is
**basis** — how much of a real payer's bill actually moves with any of these
variables. A single realised-cost ledger from one self-hoster would turn each of
these from a plausible market into a demonstrated hedge, and it's the thing I'd want
before pushing any of them past the package baskets.
