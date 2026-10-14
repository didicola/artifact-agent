# Artifact Agent (EON family build)

Self-contained HTML artifact factory on Cloudflare Workers Free plan.
Models race in parallel, a deterministic quality gate filters output, a
Durable Object picks the winner. Storage is Durable-Object-only (no KV —
no daily put quota walls). Deployed live 2026-10-14 as `artifact-agent`
on the family's main account (replaced the cronless `eon-watchdog-3`
zombie; source archived in family backup).

## Endpoints (all except /healthz and /artifact/* require `Authorization: Bearer $AGENT_TOKEN`)

- `GET  /healthz` — liveness
- `GET  /dashboard` — roster health + recent runs (token entered in page)
- `GET  /api/status` — roster + probe health + last 50 runs
- `PUT  /api/roster` — replace model roster at runtime
- `POST /generate` — single-model artifact run (max 12 steps, finish-guard E8)
- `POST /swarm` — parallel k (default 2, max 5) + gate + DO winner pick;
  optional `"langs": ["fr"]` opt-in polyglot translations (default off)
- `GET  /runs/<id>` — full run detail (trace, artifacts) from RunState DO
- `GET  /artifact/<id>` — served CSP-sandboxed (`sandbox allow-scripts`)

## Quality gate (7 bitmask checks, pure JS)

doctype+html tag, balanced script/style/div, no external URLs, not a stub
(≥500 chars, no lorem/todo), closing </html>. Swarm members that fail get
the failure list back and self-correct (maxSteps 8). `finish` refuses to
end a run with zero saved artifacts (guardrail E8).

## Family deltas applied vs the original proposal

D1 Rust/WASM gate → pure-JS twin (verified GATE-OK) · D2 polyglot default
OFF · D3 k default 2 · D4 max_tokens 8192 · D5 unicode titles + @hf/
models · D6 hourly probe · D7 secrets via metadata · E8 finish-guard ·
D8 storage = Config/ArtStore Durable Objects (KV abandoned: shared family
namespace quota is permanently consumed by the every-minute watchdog-1).

## Cost envelope (Workers Free, 10k neurons/day account-wide)

- /generate: ~1-3k neurons · /swarm k=2: ~2-6k · /swarm k=3: ~3-9k
- Probe cron hourly: negligible · Storage: DO, no daily put wall

## First deploy on a fresh worker

Set repo variable `MIGRATE=true` for the first push only (creates the four
SQLite-backed DO classes — required on Free). Then remove it; later deploys
must not repeat the migration.
