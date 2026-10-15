// Generic agent harness: model loop, tool dispatch, guardrails, trace.
// Family delta D4: max_tokens 8192 (HTML pages overflow 4k and truncate mid-tag).
// Family delta D9 (2026-10-14, mechanism ported from trending mksglu/context-mode):
//   CONTEXT SANDBOX — old tool results are hollowed out once newer turns exist,
//   keeping raw data out of the context window (~98% reduction pattern) while
//   the current turn stays complete so self-correction still works.
const SANDBOX_BUDGET = 24000; // chars of accumulated transcript before hollowing
const SANDBOX_KEEP_TAIL = 600; // chars retained per hollowed tool result

export function sandboxMessages(messages) {
  // Measure accumulated transcript size (excluding system + final user turn).
  let size = 0;
  for (const m of messages) size += JSON.stringify(m).length;
  if (size <= SANDBOX_BUDGET) return { messages, saved: 0 };

  const before = size;
  // Hollow every TOOL result except the newest two — those power active fixing.
  const toolIdx = [];
  messages.forEach((m, i) => { if (m.role === "tool") toolIdx.push(i); });
  const hollowable = toolIdx.slice(0, Math.max(0, toolIdx.length - 2));
  for (const i of hollowable) {
    const c = messages[i].content ?? "";
    if (c.length > SANDBOX_KEEP_TAIL) {
      messages[i].content =
        `[sandboxed ${c.length - SANDBOX_KEEP_TAIL} chars — full data aged out; ` +
        `re-run the tool if needed]\n` + c.slice(-SANDBOX_KEEP_TAIL);
    }
  }
  // Also trim older assistant thinking text (keep newest two).
  const asstIdx = [];
  messages.forEach((m, i) => { if (m.role === "assistant") asstIdx.push(i); });
  for (const i of asstIdx.slice(0, Math.max(0, asstIdx.length - 2))) {
    const c = messages[i].content ?? "";
    if (c.length > 400) messages[i].content = c.slice(0, 400) + "…[sandboxed]";
  }
  let after = 0;
  for (const m of messages) after += JSON.stringify(m).length;
  return { messages, saved: Math.max(0, before - after) };
}

export async function runHarness({ env, model, system, prompt, tools, maxSteps = 12 }) {
  const registry = Object.fromEntries(tools.map((t) => [t.name, t]));
  const schemas = tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));

  const messages = [
    { role: "system", content: system },
    { role: "user", content: prompt },
  ];
  const trace = [];
  const log = (type, data) => trace.push({ t: Date.now(), type, ...data });
  let nudged = false;

  for (let step = 1; step <= maxSteps; step++) {
    // Context sandbox before every model call (D9 / context-mode mechanism).
    const { messages: ready, saved } = sandboxMessages(messages);
    if (saved > 0) log("sandbox", { step, saved });
    const out = await env.AI.run(model, { messages: ready, tools: schemas, max_tokens: 8192 });
    const msg = out?.choices?.[0]?.message ?? { content: out?.response ?? "" };
    const calls = msg.tool_calls ?? [];

    messages.push({
      role: "assistant",
      content: msg.content ?? "",
      tool_calls: calls.length ? calls : undefined,
    });
    log("model", { step, text: (msg.content ?? "").slice(0, 300), calls: calls.length });

    // No tool call: nudge once, then give up.
    if (calls.length === 0) {
      if (nudged) return { status: "no_tool_call", trace };
      nudged = true;
      messages.push({
        role: "user",
        content: "You must act through tools. Save the artifact, then call finish.",
      });
      continue;
    }

    for (const call of calls) {
      const name = call.function?.name;
      const tool = registry[name];
      let result;
      try {
        if (!tool) {
          throw new Error(`Unknown tool "${name}". Available: ${Object.keys(registry).join(", ")}`);
        }
        const raw = call.function.arguments;
        const args = typeof raw === "string" ? JSON.parse(raw || "{}") : raw ?? {};
        result = await tool.run(args);
      } catch (err) {
        // Errors go back to the model so it can fix the call instead of ending the run.
        result = { error: String(err?.message ?? err) };
      }
      log("tool", { step, name, ok: !result?.error });
      messages.push({
        role: "tool",
        tool_call_id: call.id ?? name,
        name,
        content: JSON.stringify(result),
      });
      if (result?.done) return { status: "done", result, trace };
    }
  }
  return { status: "max_steps", trace };
}
