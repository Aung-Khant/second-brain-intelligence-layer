// The database picker, served at /setup.
//
// After OAuth the server knows the workspace but not which database is Areas,
// which is Projects, and so on - those used to be hardcoded ids, which is the
// specific thing that made the product single-user. Names are matched to make
// a suggestion, but the person confirms, because a wrong guess here silently
// files everything into the wrong place.
export function renderSetupPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Choose your databases</title>
<style>
  :root { color-scheme: light dark; --ink:#10161a; --muted:#59666c; --line:rgba(16,22,26,.12); --bg:#f4f6f5; --card:#fff; --accent:#1f6f63; }
  @media (prefers-color-scheme: dark) {
    :root { --ink:#e7ecea; --muted:#9aa8ad; --line:rgba(231,236,234,.14); --bg:#0d1214; --card:#141b1e; --accent:#5cbfae; }
  }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; background:var(--bg); color:var(--ink);
    font-family: ui-sans-serif,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif; font-size:15px; line-height:1.6; }
  main { max-width: 34rem; margin: 0 auto; padding: 48px 24px 64px; }
  h1 { font-size: 24px; margin: 0 0 8px; letter-spacing:-.015em; }
  .lede { color: var(--muted); margin: 0 0 28px; }
  .card { background: var(--card); border:1px solid var(--line); border-radius:10px; padding: 20px 22px; }
  .row { display:flex; flex-direction:column; gap:6px; margin-bottom:18px; }
  label { font-size:12px; font-weight:600; letter-spacing:.05em; text-transform:uppercase; color:var(--muted); }
  select { width:100%; padding:9px 10px; border-radius:7px; border:1px solid var(--line);
    background:var(--card); color:var(--ink); font:inherit; font-size:14px; }
  button { width:100%; padding:11px; border:none; border-radius:8px; background:var(--ink); color:var(--bg);
    font:inherit; font-size:14.5px; font-weight:500; cursor:pointer; margin-top:6px; }
  button:disabled { opacity:.45; cursor:not-allowed; }
  #msg { margin-top:14px; font-size:14px; color:var(--muted); min-height:1.4em; }
  #msg.err { color:#c2513a; }
  #msg.ok { color:var(--accent); }
</style>
</head>
<body>
<main>
  <h1>Choose your databases</h1>
  <p class="lede">Tell the extension which database is which. Only databases you shared with the integration appear here.</p>
  <div class="card" id="form" hidden>
    <div class="row"><label for="areas">Areas</label><select id="areas"></select></div>
    <div class="row"><label for="projects">Projects</label><select id="projects"></select></div>
    <div class="row"><label for="topics">Topics</label><select id="topics"></select></div>
    <div class="row"><label for="resources">Resources</label><select id="resources"></select></div>
    <button id="save" type="button">Save and finish</button>
    <p id="msg"></p>
  </div>
  <p id="loading">Loading your databases…</p>
</main>
<script>
  // The session arrives in the URL because this page is opened by the
  // extension, which is the only holder of the token. It is removed from the
  // address bar immediately so it does not linger in browser history.
  const params = new URLSearchParams(location.search);
  const session = params.get("session") || "";
  history.replaceState(null, "", location.pathname);

  const fields = { areas: "areasDataSourceId", projects: "projectsDataSourceId", topics: "topicsDataSourceId", resources: "resourcesDataSourceId" };
  const msg = document.getElementById("msg");

  function setMessage(text, kind) {
    msg.textContent = text;
    msg.className = kind || "";
  }

  async function load() {
    const response = await fetch("/api/auth/notion/databases", { headers: { Authorization: "Bearer " + session } });
    const body = await response.json();

    if (!response.ok) {
      document.getElementById("loading").textContent = body?.error?.message || "Could not load databases.";
      return;
    }

    if (!body.available.length) {
      document.getElementById("loading").textContent =
        "No databases were shared with the integration. In Notion, open each database, use the ••• menu, and connect this integration \\u2014 then reload.";
      return;
    }

    const chosen = body.current || body.suggested || {};

    for (const [id, role] of Object.entries(fields)) {
      const select = document.getElementById(id);
      select.replaceChildren(
        ...body.available.map((source) => {
          const option = document.createElement("option");
          option.value = source.id;
          option.textContent = source.title;
          if (chosen[role] === source.id) option.selected = true;
          return option;
        })
      );
    }

    document.getElementById("loading").hidden = true;
    document.getElementById("form").hidden = false;
  }

  document.getElementById("save").addEventListener("click", async () => {
    const button = document.getElementById("save");
    button.disabled = true;
    setMessage("Saving…");

    const payload = {};
    for (const [id, role] of Object.entries(fields)) payload[role] = document.getElementById(id).value;

    // Choosing the same database twice is always a mistake, and it would
    // write Resources into Topics without complaining.
    if (new Set(Object.values(payload)).size !== 4) {
      setMessage("Each database can only be used once. Pick four different ones.", "err");
      button.disabled = false;
      return;
    }

    const response = await fetch("/api/auth/notion/databases", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + session },
      body: JSON.stringify(payload)
    });
    const body = await response.json();

    if (!response.ok) {
      setMessage(body?.error?.message || "Could not save.", "err");
      button.disabled = false;
      return;
    }

    setMessage("Saved. You can close this tab and use the extension.", "ok");
  });

  load();
</script>
</body>
</html>`;
}
