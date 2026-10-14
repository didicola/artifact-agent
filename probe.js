import { getRoster } from "./roster.js";
import { cfgPut } from "./store.js";

export async function probeRoster(env) {
  const health = {};

  for (const r of (await getRoster(env)).filter((x) => x.enabled)) {
    const t = Date.now();
    try {
      await env.AI.run(r.model, { messages: [{ role: "user", content: "Reply OK" }], max_tokens: 5 });
      health[r.id] = { ok: true, ms: Date.now() - t, at: Date.now() };
    } catch (err) {
      health[r.id] = { ok: false, error: String(err?.message ?? err).slice(0, 200), at: Date.now() };
    }
  }

  // Endpoint check over the SELF service binding, which stays inside Cloudflare.
  const t = Date.now();
  try {
    const res = await env.SELF.fetch("https://internal/healthz");
    health._endpoint = { ok: res.ok, ms: Date.now() - t, at: Date.now() };
  } catch (err) {
    health._endpoint = { ok: false, error: String(err?.message ?? err).slice(0, 200), at: Date.now() };
  }

  await cfgPut(env, "health", health);
  return health;
}
