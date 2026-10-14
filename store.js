// Family storage layer — Durable Object only, NO KV.
// Lesson 2026-10-14: watchdog-1 writes its KV every minute, so that namespace's
// daily put quota is permanently gone. DO storage has no per-day put wall.
// - Config DO (fixed instance "cfg"): tiny JSON state (roster, health, runs).
// - ArtStore DO (one per artifact id): HTML in 100KB chunks, reassembled on GET.

export class Config {
  constructor(state) {
    this.storage = state.storage;
  }
  async fetch(request) {
    const u = new URL(request.url);
    const key = u.pathname.slice(1);
    if (request.method === "PUT") {
      await this.storage.put(key, await request.text());
      return Response.json({ ok: true });
    }
    const v = await this.storage.get(key);
    return v != null ? Response.json({ found: true, value: JSON.parse(v) }) : Response.json({ found: false });
  }
}

export class ArtStore {
  constructor(state) {
    this.storage = state.storage;
  }
  async fetch(request) {
    if (request.method === "PUT") {
      const html = await request.text();
      const CH = 100000;
      const n = Math.ceil(html.length / CH);
      for (let i = 0; i < n; i++) await this.storage.put(`c${i}`, html.slice(i * CH, (i + 1) * CH));
      await this.storage.put("n", String(n));
      return Response.json({ ok: true, bytes: html.length });
    }
    const n = Number((await this.storage.get("n")) ?? 0);
    if (!n) return new Response("Not found", { status: 404 });
    let out = "";
    for (let i = 0; i < n; i++) out += (await this.storage.get(`c${i}`)) ?? "";
    return new Response(out, { headers: { "content-type": "text/html; charset=utf-8" } });
  }
}

const cfgStub = (env) => env.CFG.get(env.CFG.idFromName("cfg"));

export async function cfgGet(env, key, def = null) {
  const r = await (await cfgStub(env).fetch(`https://cfg/${key}`)).json();
  return r.found ? r.value : def;
}

export async function cfgPut(env, key, value) {
  await cfgStub(env).fetch(`https://cfg/${key}`, { method: "PUT", body: JSON.stringify(value) });
}

export async function artSave(env, html) {
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const stub = env.ART.get(env.ART.idFromName(id));
  await stub.fetch(`https://art/`, { method: "PUT", body: html });
  return id;
}

export async function artLoad(env, id) {
  const stub = env.ART.get(env.ART.idFromName(id));
  const res = await stub.fetch(`https://art/`);
  return res.ok ? res : null;
}
