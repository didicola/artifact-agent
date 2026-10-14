export const DASHBOARD_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Artifact agent dashboard</title>
<style>
body{font-family:system-ui,sans-serif;margin:2rem;max-width:960px;background:#0b0e14;color:#e6e6e6}
table{border-collapse:collapse;width:100%;margin-bottom:2rem}
td,th{border-bottom:1px solid #333;padding:6px;text-align:left;font-size:14px}
.ok{color:#3fb950}.bad{color:#f85149}
input,button{padding:6px 10px;border-radius:6px;border:1px solid #444;background:#161b22;color:#e6e6e6}
h1{font-size:1.4rem}h2{font-size:1.1rem;margin-top:1.6rem}
</style></head>
<body>
<h1>Artifact agent dashboard</h1>
<input id="tok" type="password" placeholder="AGENT_TOKEN">
<button onclick="load()">Load</button>
<h2>Roster and health</h2><table id="roster"></table>
<h2>Recent runs</h2><table id="runs"></table>
<script>
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
  });
}
async function load() {
  const res = await fetch("/api/status", {
    headers: { authorization: "Bearer " + document.getElementById("tok").value }
  });
  if (!res.ok) { alert("Unauthorized"); return; }
  const data = await res.json();
  const health = data.health || {};

  let rows = "<tr><th>id</th><th>enabled</th><th>health</th><th>ms</th></tr>";
  for (const r of data.roster) {
    const h = health[r.id] || {};
    const cls = h.ok === false ? "bad" : "ok";
    const state = h.ok === undefined ? "unknown" : h.ok ? "ok" : esc(h.error);
    rows += "<tr><td>" + esc(r.id) + "</td><td>" + esc(r.enabled) +
      '</td><td class="' + cls + '">' + state + "</td><td>" + esc(h.ms) + "</td></tr>";
  }
  document.getElementById("roster").innerHTML = rows;

  let runRows = "<tr><th>run</th><th>model</th><th>status</th><th>artifacts</th><th>when</th></tr>";
  for (const r of data.runs) {
    runRows += "<tr><td>" + esc(r.runId) + "</td><td>" + esc(r.model) + "</td><td>" + esc(r.status) +
      "</td><td>" + esc(r.artifacts) + "</td><td>" + new Date(r.at).toLocaleString() + "</td></tr>";
  }
  document.getElementById("runs").innerHTML = runRows;
}
</script>
</body></html>`;
