// Local unit test for harness D9 context sandbox (no AI quota needed).
import { runHarness, sandboxMessages } from "./artifact-agent/harness.js";

let pass = 0, fail = 0;
const ok = (cond, label) => { cond ? pass++ : fail++; console.log((cond ? "PASS " : "FAIL ") + label); };

// ---------- Unit: sandboxMessages pure behavior ----------
// under budget -> untouched
{
  const msgs = [
    { role: "system", content: "sys" },
    { role: "user", content: "hi" },
    { role: "assistant", content: "a", tool_calls: [{ id: "1" }] },
    { role: "tool", content: "Y".repeat(5000) },
    { role: "assistant", content: "a", tool_calls: [{ id: "2" }] },
    { role: "tool", content: "Z".repeat(5000) },
    { role: "assistant", content: "a", tool_calls: [{ id: "3" }] },
    { role: "tool", content: "W".repeat(5000) },
  ];
  const { messages, saved } = sandboxMessages(msgs.map((m) => ({ ...m })));
  ok(saved === 0, `under budget: saved=0 (got ${saved})`);
  ok(messages[3].content.length === 5000, "under budget: tool result intact");
}

// over budget -> oldest tool results hollowed, newest two intact, system untouched
{
  const msgs = [
    { role: "system", content: "sys" },
    { role: "user", content: "prompt" },
    { role: "assistant", content: "a", tool_calls: [{ id: "1" }] },
    { role: "tool", content: "OLD".repeat(30000) },   // index 3 -> should hollow
    { role: "assistant", content: "a", tool_calls: [{ id: "2" }] },
    { role: "assistant", content: "ASST".repeat(1000), tool_calls: [{ id: "2" }] }, // index 5 -> old asst, trim
    { role: "tool", content: "MID".repeat(30000) },   // index 6 -> newest-2, keep
    { role: "assistant", content: "a", tool_calls: [{ id: "3" }] },
    { role: "tool", content: "NEW".repeat(30000) },   // index 8 -> keep
    { role: "assistant", content: "latest assistant" }, // index 9 -> newest asst, keep
    { role: "user", content: "final question" },
  ];
  const out = sandboxMessages(msgs.map((m) => ({ ...m })));
  ok(out.saved > 50000, `over budget: big save (got ${out.saved})`);
  ok(out.messages[3].content.startsWith("[sandboxed"), "oldest tool result hollowed");
  ok(out.messages[3].content.includes("OLD"), "hollow keeps tail sample");
  ok(out.messages[3].content.length < 900, `hollow size capped (${out.messages[3].content.length})`);
  ok(out.messages[6].content.length === 90000, "newest-2 tool result intact");
  ok(out.messages[8].content.length === 90000, "newest tool result intact");
  ok(out.messages[10].content === "final question", "final user turn intact");
  ok(out.messages[1].content === "prompt", "opening user turn intact");
  ok(out.messages[0].content === "sys", "system intact");
  ok(out.messages[5].content.length <= 415, `old assistant trimmed (${out.messages[5].content.length})`);
  ok(out.messages[9].content === "latest assistant", "newest assistant kept whole");
}

// ---------- Integration: runHarness fires sandbox mid-run, run completes ----------
{
  let step = 0;
  const env = {
    AI: {
      run: async () => {
        step++;
        if (step <= 3) {
          return { choices: [{ message: { content: "", tool_calls: [{
            id: "c" + step, function: { name: "fetch", arguments: "{}" },
          }] } }] };
        }
        return { choices: [{ message: { content: "done thinking", tool_calls: [{
          id: "cF", function: { name: "finish", arguments: "{}" },
        }] } }] };
      },
    },
  };
  const tools = [
    { name: "fetch", description: "t", parameters: { type: "object", properties: {} },
      run: async () => ({ body: "X".repeat(60000) }) },
    { name: "finish", description: "t", parameters: { type: "object", properties: {} },
      run: async () => ({ done: true, ok: true }) },
  ];
  const res = await runHarness({ env, model: "llama", system: "s", prompt: "p", tools, maxSteps: 8 });
  ok(res.status === "done", `run completes (status=${res.status})`);
  const sb = res.trace.filter((t) => t.type === "sandbox");
  ok(sb.length >= 1, `sandbox fired in run (${sb.length}x)`);
  ok(sb.some((t) => t.saved > 50000), "sandbox reported a real save");
  ok(res.trace.filter((t) => t.type === "tool" && t.name === "fetch").length === 3, "3 fetches executed");
}

// small transcript -> never sandboxed
{
  const env = { AI: { run: async () => ({ choices: [{ message: { content: "", tool_calls: [{
    id: "x", function: { name: "finish", arguments: "{}" },
  }] } }] }) } };
  const tools = [{ name: "finish", description: "t", parameters: { type: "object", properties: {} },
    run: async () => ({ done: true, ok: true }) }];
  const res = await runHarness({ env, model: "llama", system: "s", prompt: "tiny", tools, maxSteps: 3 });
  ok(res.status === "done" && res.trace.filter((t) => t.type === "sandbox").length === 0,
    "small transcript not sandboxed");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
