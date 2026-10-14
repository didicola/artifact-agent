// Per-run state Durable Object: full run detail lives here (not in KV),
// so KV only ever holds small summary rows.
export class RunState {
  constructor(state) {
    this.storage = state.storage;
  }

  async fetch(request) {
    if (request.method === "PUT") {
      await this.storage.put("run", await request.json());
      return new Response("ok");
    }
    const run = await this.storage.get("run");
    return run ? Response.json(run) : new Response("Not found", { status: 404 });
  }
}
