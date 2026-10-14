// Generic agent harness: model loop, tool dispatch, guardrails, trace.
// Family delta D4: max_tokens 8192 (HTML pages overflow 4k and truncate mid-tag).
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
    const out = await env.AI.run(model, { messages, tools: schemas, max_tokens: 8192 });
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
