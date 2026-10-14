// SwarmRun DO — family-patched: after winner picked, delete c:* keys + set a
// 3-day alarm sweep so orphan Durable Objects don't accumulate on free tier.
// Only metadata is stored here (128 KiB DO value limit) — never HTML.

export class SwarmRun {
  constructor(state) {
    this.storage = state.storage;
    this.state = state;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/candidate") {
      const c = await request.json();
      await this.storage.put(`c:${String(c.index).padStart(4, "0")}`, c);
      return Response.json({ ok: true });
    }

    if (request.method === "POST" && url.pathname === "/pick") {
      const existing = await this.storage.get("winner");
      if (existing) return Response.json(existing);

      const list = [...(await this.storage.list({ prefix: "c:" })).values()];
      if (!list.length) return Response.json({ error: "no candidates" }, { status: 422 });

      list.sort((a, b) => b.score - a.score || a.bytes - b.bytes);
      const winner = list[0];
      await this.storage.put("winner", winner);

      // Family delta: drop candidate keys, schedule self-cleanup in 3 days.
      const keys = [...(await this.storage.list({ prefix: "c:" })).keys()];
      await Promise.all(keys.map((k) => this.storage.delete(k)));
      await this.storage.setAlarm(Date.now() + 3 * 24 * 3600 * 1000);

      return Response.json(winner);
    }

    if (request.method === "GET") {
      const list = [...(await this.storage.list({ prefix: "c:" })).values()];
      return Response.json({ candidates: list, winner: (await this.storage.get("winner")) ?? null });
    }

    return new Response("Not found", { status: 404 });
  }

  // Alarm: wipe everything — this run is over.
  async alarm() {
    const keys = [...(await this.storage.list()).keys()];
    await Promise.all(keys.map((k) => this.storage.delete(k)));
  }
}
