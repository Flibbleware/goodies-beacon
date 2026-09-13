# Spikes

Throwaway scripts that answer the source-feasibility questions in ARCHITECTURE.md §2 before an
adapter is written for them. They are excluded from CI, are not typechecked with the workspace,
and are written to be deleted once their findings are in `docs/SPIKES.md`.

Each spike produces two things:

- **Findings** in `docs/SPIKES.md` — what works, from where, at what rate, with what caveats.
- **Fixtures** in `packages/sources/<id>/fixtures/` — anonymised real responses, committed, which
  the adapter's test harness (P1-03) replays so adapter tests run offline without credentials.

Raw, un-anonymised output goes to `spikes/<id>/out/`, which is gitignored. Nothing under `out/`
is ever committed: it holds live seller names and whatever else the marketplace returned.

## Running

Node 24 runs TypeScript directly, so there is no build step:

```
node spikes/ebay/run.ts
```

Credentials come from the repository's `.env` (gitignored), which the script loads itself. Each
spike's own section below says which variables it needs.

## eBay — S1-01

Needs a production keyset from https://developer.ebay.com (Application Keys → Production):

```
EBAY_CLIENT_ID=...        # "App ID (Client ID)"
EBAY_CLIENT_SECRET=...    # "Cert ID (Client Secret)"
```

The script asks for an application token by client credentials, then runs a numbered list of
probes — one per question S1-01 has to answer — and writes `out/report.json` plus the fixtures.
A probe that fails is a finding, not a crash: the run continues and records the status and the
error body.
