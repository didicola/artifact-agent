import { runHarness } from "./harness.js";
import { getRoster } from "./roster.js";
import { scoreHtml } from "./scorer.js";
import { cfgGet } from "./store.js";

// Family delta D2: polyglot OFF by default — opt-in per request via langs: ["fr"] etc.
export const POLYGLOT_LANGS = [];
const LANG_NAMES = { en: "English", fr: "French", ar: "Arabic" };
const MIN_PASSED = 5; // out of 7 checks

// Each swarm member gets its own bucket. Only candidates that pass the gate are kept.
// Family delta D5: unicode-friendly title regex. E8: finish refuses empty buckets,
// so FINISH is constructed per-bucket inside this factory.
function candidateTools(bucket) {
  const FINISH = {
    name: "finish",
    description: "Call once after the artifact is submitted.",
    parameters: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] },
    run: async ({ summary }) => {
      if (!bucket.length) return { error: "No artifact saved yet. Call save_artifact first, then finish." };
      return { done: true, summary };
    },
  };
  return [
    {
      name: "save_artifact",
      description: "Submit the finished single-file HTML artifact. It must pass the quality checks.",
      parameters: {
        type: "object",
        properties: { title: { type: "string" }, html: { type: "string" } },
        required: ["title", "html"],
      },
      run: async ({ title, html }) => {
        if (!/^[\p{L}\p{N} _-]{1,60}$/u.test(title ?? "")) {
          return { error: "title must be 1-60 letters, digits, spaces, - or _" };
        }
        if (!/<html[\s>]/i.test(html ?? "")) {
          return { error: "html must be a complete document starting with <html>" };
        }
        const s = scoreHtml(html);
        if (s.passed < MIN_PASSED) {
          return { error: `quality checks failed: ${s.failed.join(", ")}. Fix them and resubmit.` };
        }
        bucket.push({ title, html, score: s.passed, bytes: html.length });
        return { saved: true, score: `${s.passed}/${s.total}` };
      },
    },
    FINISH,
  ];
}

// Translate visible text only, keeping the markup intact.
async function translate(env, html, lang, model) {
  const out = await env.AI.run(model, {
    messages: [
      {
        role: "system",
        content:
          "Translate the visible text of an HTML page. Keep every tag, attribute, class, id, and script exactly as it is. Translate only human-readable text. Output the complete HTML document and nothing else.",
      },
      {
        role: "user",
        content: `Target language: ${LANG_NAMES[lang]}. On the <html> tag set lang="${lang}" and dir="${lang === "ar" ? "rtl" : "ltr"}".\n\n${html}`,
      },
    ],
    max_tokens: 8192,
  });
  return (out?.response ?? "")
    .replace(/^```(?:html)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
}

export async function runSwarm({ env, runId, prompt, system, k = 2, langs = POLYGLOT_LANGS, saveFile }) {
  const health = (await cfgGet(env, "health")) ?? {};
  const models = (await getRoster(env))
    .filter((r) => r.enabled && health[r.id]?.ok !== false)
    .sort((a, b) => a.priority - b.priority)
    .slice(0, k);
  if (!models.length) throw new Error("no healthy models in roster");

  // 1. Swarm: models work in parallel, each with its own candidate bucket.
  const settled = await Promise.allSettled(
    models.map(async (m) => {
      const cands = [];
      const run = await runHarness({ env, model: m.model, system, prompt, tools: candidateTools(cands), maxSteps: 8 });
      return cands.map((c) => ({ ...c, modelId: m.id, runStatus: run.status }));
    })
  );
  const all = settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  if (!all.length) return { runId, status: "no_candidates", candidates: [], translations: {} };

  // 2. Durable Object: record candidates and pick the winner near the first model.
  const stub = env.SWARM.get(env.SWARM.idFromName(runId), { locationHint: models[0].location });
  for (let i = 0; i < all.length; i++) {
    const c = all[i];
    await stub.fetch("https://swarm/candidate", {
      method: "POST",
      body: JSON.stringify({ index: i, model: c.modelId, title: c.title, score: c.score, bytes: c.bytes }),
    });
  }
  const pick = await (await stub.fetch("https://swarm/pick", { method: "POST" })).json();
  const win = all[pick.index];

  // 3. Save the winner, then the translations (each one passes the gate too).
  const winnerId = await saveFile(`${win.title}.html`, win.html);
  const translations = {};
  await Promise.all(
    (langs ?? []).map(async (lang) => {
      const html = await translate(env, win.html, lang, models[0].model);
      const s = scoreHtml(html);
      if (s.passed < MIN_PASSED) {
        translations[lang] = { error: `failed checks: ${s.failed.join(", ")}` };
        return;
      }
      const id = await saveFile(`${win.title}.${lang}.html`, html);
      translations[lang] = { url: `/artifact/${id}` };
    })
  );

  return {
    runId,
    status: "done",
    winner: { model: win.modelId, title: win.title, url: `/artifact/${winnerId}`, score: pick.score },
    candidates: all.map((c, i) => ({ index: i, model: c.modelId, score: c.score, status: c.runStatus })),
    translations,
  };
}
