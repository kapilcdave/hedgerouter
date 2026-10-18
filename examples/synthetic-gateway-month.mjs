#!/usr/bin/env node
// SYNTHETIC. Writes 30 days of Weave-format routing decisions for an invented company so the
// exposure -> discover -> hedge-plan loop can be shown end to end. Nothing here is a customer's
// data. Each row stands for one hour of traffic (a real export has one row per request), at a
// committed rate of $5/MTok input and $30/MTok output.
//
//   node examples/synthetic-gateway-month.mjs [END_ISO] > month.ndjson
//   hedge ingest --format weave --input month.ndjson

const DAYS = 30;
const INPUT_PRICE = 5;
const OUTPUT_PRICE = 30;
// The month ends now unless an ISO time is passed, so the default 30-day exposure window is full.
const END = process.argv[2] ? Date.parse(process.argv[2]) : Math.floor(Date.now() / 3_600_000) * 3_600_000;

// Small deterministic generator so the output is reproducible.
let seed = 20261017;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);

for (let hour = 0; hour < DAYS * 24; hour += 1) {
  const at = END - (DAYS * 24 - hour) * 3_600_000;
  const hourOfDay = new Date(at).getUTCHours();
  const weekday = new Date(at).getUTCDay();
  const load = (0.35 + 0.65 * Math.exp(-(((hourOfDay - 15) / 5) ** 2))) * (weekday === 0 || weekday === 6 ? 0.45 : 1);
  const inputTokens = Math.round(4_200_000 * load * (0.85 + 0.3 * rand()));
  const outputTokens = Math.round(inputTokens * (0.16 + 0.04 * rand()));
  const stamp = new Date(at).toISOString().replace('.000Z', 'Z');
  console.log(JSON.stringify({
    id: `synthetic-${hour}`,
    recorded_at: stamp,
    requested_at: stamp,
    request_id: `synthetic-request-${hour}`,
    trace_id: `synthetic-trace-${hour}`,
    session_id: 'synthetic-session',
    requested_model: 'gpt-5.5',
    decision_model: 'gpt-5.5',
    decision_provider: 'openai',
    failover_used: false,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
    actual_input_cost_usd: +(inputTokens / 1e6 * INPUT_PRICE).toFixed(6),
    actual_output_cost_usd: +(outputTokens / 1e6 * OUTPUT_PRICE).toFixed(6),
    route_latency_ms: 8,
    upstream_latency_ms: 900,
    total_latency_ms: 908,
    upstream_status_code: 200
  }));
}
