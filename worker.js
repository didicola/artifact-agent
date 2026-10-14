// Artifact Agent — family merged build 2026-10-14 (termux1).
// Storage: KV aa:* keys for state, art:<id> for artifact HTML (family has no
// Google OAuth secrets on this account — Drive is a later optional add-on).
// Deltas applied: D1 JS gate, D2 polyglot off, D3 k default 2, D4 8192 tokens,
// D5 unicode titles + @hf/, D6 hourly probe, D7 secrets via metadata.
import { runHarness } from "./harness.js";
import { pickModel, getRoster, putRoster } from "./roster.js";
import { probeRoster } from "./probe.js";
import { DASHBOARD_HTML } from "./dashboard.js";
import { runSwarm } from "./swarm.js";
import { cfgGet, cfgPut, artSave, artLoad } from "./store.js";
export { RunState } from "./run-state.js";
export { SwarmRun } from "./swarm-run.js";
export { Config, ArtStore } from "./store.js";

const SYSTEM = `You build single-file HTML artifacts.
Rules: start with <!doctype html> and <html>, close every <script>, <style> and <div>,
end with </html>, use no external URLs (no http in src or href), no lorem ipsum, no stubs.
Workflow: 1) write the complete HTML with inline CSS and JS,
2) call save_artifact with a short title and the html,
3) if save_artifact returns an error, fix the html and call it again,
4) call finish with a one-sentence summary.`;

const RUNS_KEY = "runs";

const authed = (req, env) => req.headers.get("authorization") === `Bearer ${env.AGENT_TOKEN}`;
const json = (obj, status = 200) => Response.json(obj, { status });

// Artifact store: ArtStore DO (chunked, no daily quota). Ids are short hex.
async function saveArtifact(env, _name, html) {
  return artSave(env, html);
}

// Single-model tools: save_artifact validates then stores; finish ends the run.
function buildTools(ctx) {
  return [
    {
      name: "save_artifact",
      description: "Save the finished artifact as one self-contained HTML document.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short file name, no extension" },
          html: { type: "string", description: "Complete HTML document" },
        },
        required: ["title", "html"],
      },
      run: async ({ title, html }) => {
        if (!title || !/^[\p{L}\p{N} _-]{1,60}$/u.test(title)) {
          return { error: "title must be 1-60 letters, digits, spaces, - or _" };
        }
        if (!html || !/<html[\s>]/i.test(html)) {
          return { error: "html must be a complete document starting with <html>" };
        }
        if (html.length > 2_000_000) return { error: "html is too large (over 2 MB)" };
        const id = await saveArtifact(ctx.env, `${title}.html`, html);
        ctx.artifacts.push({ id, title, url: `/artifact/${id}` });
        return { saved: true, url: `/artifact/${id}` };
      },
    },
    {
      name: "finish",
      description: "Call once when all artifacts are saved.",
      parameters: {
        type: "object",
        properties: { summary: { type: "string" } },
        required: ["summary"],
      },
      run: async ({ summary }) => {
        // Family guardrail E8: never let a run end with nothing stored.
        if (!ctx.artifacts.length) return { error: "No artifact saved yet. Call save_artifact first, then finish." };
        return { done: true, summary };
      },
    },
  ];
}

// Store a run's full detail in its Durable Object and add a summary row to the runs list.
async function storeRun(env, runId, locationHint, record, detail) {
  const stub = env.RUNS.get(env.RUNS.idFromName(runId), { locationHint });
  await stub.fetch("https://run/", {
    method: "PUT",
    body: JSON.stringify({ ...record, ...detail }),
  });
  const runs = (await cfgGet(env, RUNS_KEY)) ?? [];
  await cfgPut(env, RUNS_KEY, [record, ...runs].slice(0, 50));
}

async function handleRequest(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;

    if (p === "/healthz") return json({ ok: true, service: "artifact-agent" });

    if (p === "/dashboard") {
      return new Response(DASHBOARD_HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    if (p === "/api/status" && request.method === "GET") {
      if (!authed(request, env)) return new Response("Unauthorized", { status: 401 });
      return json({
        roster: await getRoster(env),
        health: (await cfgGet(env, "health")) ?? {},
        runs: (await cfgGet(env, RUNS_KEY)) ?? [],
      });
    }

    if (p === "/api/roster" && request.method === "PUT") {
      if (!authed(request, env)) return new Response("Unauthorized", { status: 401 });
      try {
        await putRoster(env, await request.json());
      } catch (err) {
        return json({ error: err.message }, 400);
      }
      return json({ ok: true });
    }

    const runMatch = p.match(/^\/runs\/([\w-]+)$/);
    if (runMatch && request.method === "GET") {
      if (!authed(request, env)) return new Response("Unauthorized", { status: 401 });
      const stub = env.RUNS.get(env.RUNS.idFromName(runMatch[1]));
      return stub.fetch("https://run/");
    }

    if (p === "/generate" && request.method === "POST") {
      if (!authed(request, env)) return new Response("Unauthorized", { status: 401 });
      const { prompt } = await request.json();
      const runId = crypto.randomUUID();
      const model = await pickModel(env);

      const ctx = { env, artifacts: [] };
      let run;
      try {
        run = await runHarness({
          env,
          model: model.model,
          system: SYSTEM,
          prompt,
          tools: buildTools(ctx),
          maxSteps: 12,
        });
      } catch (err) {
        return json({ error: String(err?.message ?? err), stack: String(err?.stack ?? "").slice(0, 400), model: model.id }, 500);
      }

      const record = {
        runId,
        model: model.id,
        status: run.status,
        at: Date.now(),
        artifacts: ctx.artifacts.length,
      };
      const summary = run.result?.summary ?? null;
      await storeRun(env, runId, model.location, record, {
        prompt,
        summary,
        artifacts: ctx.artifacts,
        trace: run.trace,
      });
      return json({ ...record, summary, artifacts: ctx.artifacts, trace: run.trace });
    }

    if (p === "/swarm" && request.method === "POST") {
      if (!authed(request, env)) return new Response("Unauthorized", { status: 401 });
      const { prompt, langs, k } = await request.json();
      const runId = crypto.randomUUID();
      const roster = await getRoster(env);
      const location = roster[0]?.location ?? "wnam";

      // Family delta D3: k defaults to 2 (neuron thrift), max 5.
      const result = await runSwarm({
        env,
        runId,
        prompt,
        system: SYSTEM,
        k: Number.isInteger(k) && k >= 1 && k <= 5 ? k : 2,
        langs,
        saveFile: (name, html) => saveArtifact(env, name, html),
      });

      const record = {
        runId,
        model: result.winner?.model ?? "swarm",
        status: result.status,
        at: Date.now(),
        artifacts: (result.winner ? 1 : 0) + Object.values(result.translations ?? {}).filter((t) => t.url).length,
      };
      await storeRun(env, runId, location, record, { prompt, ...result });
      return json(result);
    }

    const match = p.match(/^\/artifact\/([\w-]+)$/);
    if (match && request.method === "GET") {
      const res = await artLoad(env, match[1]);
      if (!res) return new Response("Not found", { status: 404 });
      const body = await res.text();
      return new Response(body, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "content-security-policy": "sandbox allow-scripts",
          "x-content-type-options": "nosniff",
        },
      });
    }

    return new Response("Not found", { status: 404 });
}

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (err) {
      return json({ error: String(err?.message ?? err), stack: String(err?.stack ?? "").slice(0, 500) }, 500);
    }
  },

  // Cron trigger: refresh model and endpoint health (hourly — family delta D6).
  async scheduled(event, env, ctx) {
    ctx.waitUntil(probeRoster(env).catch(() => {}));
  },
};
