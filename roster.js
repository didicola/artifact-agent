// Family delta: state lives in the Config DO (no KV — daily put quota walls).
// All keys tiny JSON values under the fixed "cfg" DO instance.
import { cfgGet, cfgPut } from "./store.js";

const KEY = "roster";
const LOCATIONS = ["wnam", "enam", "sam", "weur", "eeur", "apac", "oc", "afr", "me"];

// Used until a roster is saved. Verified against the Workers AI catalog 2026-10-14.
const DEFAULT = [
  { id: "llama-70b", model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", enabled: true, priority: 1, location: "wnam" },
  { id: "mistral-24b", model: "@cf/mistralai/mistral-small-3.1-24b-instruct", enabled: true, priority: 2, location: "wnam" },
  { id: "qwen-coder-32b", model: "@cf/qwen/qwen2.5-coder-32b-instruct", enabled: true, priority: 3, location: "wnam" },
];

export async function getRoster(env) {
  return (await cfgGet(env, KEY)) ?? DEFAULT;
}

export async function putRoster(env, roster) {
  if (!Array.isArray(roster) || roster.length === 0) throw new Error("roster must be a non-empty array");
  for (const r of roster) {
    if (!/^[a-z0-9][\w-]*$/i.test(r.id ?? "")) throw new Error(`bad id: ${r.id}`);
    // Family delta D5: allow @hf/ hosted models too, not just @cf/.
    if (!/^@(cf|hf)\//.test(r.model ?? "")) throw new Error(`model must be a Workers AI id (@cf/ or @hf/): ${r.id}`);
    if (!LOCATIONS.includes(r.location)) throw new Error(`bad location for ${r.id}`);
  }
  await cfgPut(env, KEY, roster);
}

// Highest-priority enabled model that the last probe did not mark down.
export async function pickModel(env) {
  const roster = await getRoster(env);
  const health = (await cfgGet(env, "health")) ?? {};
  const ok = roster
    .filter((r) => r.enabled && health[r.id]?.ok !== false)
    .sort((a, b) => a.priority - b.priority);
  if (!ok.length) throw new Error("no healthy enabled models in roster");
  return ok[0];
}
