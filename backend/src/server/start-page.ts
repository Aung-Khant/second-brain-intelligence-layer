// The page a friend actually lands on when they click "Connect Notion" - not
// Notion's consent screen directly, but a stop before it that explains what
// they're about to share and, if a template link is configured, gets their
// workspace into a shape where setup can auto-complete.
//
// Sending someone straight into an OAuth consent screen with no context is
// how people bail or approve something they don't understand. This exists so
// "duplicate the template, then connect" is two unambiguous steps instead of
// something explained over chat.
export function renderStartPage(input: {
  authorizeUrl: string | null;
  templateUrl: string | null;
}): string {
  if (!input.authorizeUrl) {
    return errorPage(
      "Open this from the extension",
      "This page needs to be opened by clicking Connect Notion in the extension popup, not visited directly."
    );
  }

  const step1 = input.templateUrl
    ? `<li class="step">
         <div class="num">1</div>
         <div>
           <h2>Duplicate the template</h2>
           <p>Opens in a new tab. Click <b>Duplicate</b> in the top right to copy it into your own Notion.</p>
           <a class="btn btn-secondary" href="${escapeAttr(input.templateUrl)}" target="_blank" rel="noopener">Open the template</a>
         </div>
       </li>`
    : `<li class="step">
         <div class="num">1</div>
         <div>
           <h2>Have your Second Brain set up</h2>
           <p>You need Areas, Projects, Topics, and Resources databases in Notion. If you already have them, continue below.</p>
         </div>
       </li>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Connect Notion</title>
<style>
  :root { color-scheme: light dark; --ink:#10161a; --muted:#59666c; --line:rgba(16,22,26,.12);
    --bg:#f4f6f5; --card:#fff; --accent:#1f6f63; --accent-soft:rgba(31,111,99,.1); }
  @media (prefers-color-scheme: dark) {
    :root { --ink:#e7ecea; --muted:#9aa8ad; --line:rgba(231,236,234,.14); --bg:#0d1214; --card:#141b1e;
      --accent:#5cbfae; --accent-soft:rgba(92,191,174,.14); }
  }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; background:var(--bg); color:var(--ink);
    font-family: ui-sans-serif,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif; font-size:15px; line-height:1.6; }
  main { max-width: 30rem; margin: 0 auto; padding: 52px 24px 64px; }
  h1 { font-size: 23px; margin: 0 0 6px; letter-spacing:-.015em; }
  .lede { color: var(--muted); margin: 0 0 32px; font-size: 14.5px; }
  ol.steps { list-style:none; margin:0 0 28px; padding:0; display:flex; flex-direction:column; gap:0; }
  .step { display:grid; grid-template-columns: 28px 1fr; gap:14px; padding: 18px 0; border-top:1px solid var(--line); }
  .step:first-child { border-top:none; }
  .num { width:26px; height:26px; border-radius:50%; background:var(--accent-soft); color:var(--accent);
    display:grid; place-items:center; font-size:13px; font-weight:600; }
  h2 { font-size: 15.5px; margin:0 0 4px; font-weight:600; }
  .step p { margin: 0 0 12px; color: var(--muted); font-size: 14px; }
  .btn { display:inline-block; padding:9px 16px; border-radius:8px; text-decoration:none;
    font-size:14px; font-weight:500; border:1px solid transparent; }
  .btn-secondary { background: var(--card); color: var(--ink); border-color: var(--line); }
  .btn-primary { background: var(--ink); color: var(--bg); width:100%; text-align:center;
    padding:12px; font-size:14.5px; }
  .privacy { margin-top: 30px; padding: 16px 18px; background: var(--card); border:1px solid var(--line);
    border-radius: 10px; font-size: 13px; color: var(--muted); line-height:1.6; }
  .privacy b { color: var(--ink); }
</style>
</head>
<body>
<main>
  <h1>Connect your Notion</h1>
  <p class="lede">Two steps, then you're saving things.</p>

  <ol class="steps">
    ${step1}
    <li class="step">
      <div class="num">2</div>
      <div>
        <h2>Connect Notion</h2>
        <p>You'll pick which pages to share on Notion's own screen. Only what you choose there is visible to this tool.</p>
        <a class="btn btn-primary" href="${escapeAttr(input.authorizeUrl)}">Connect Notion</a>
      </div>
    </li>
  </ol>

  <div class="privacy">
    <b>What this stores:</b> your Notion access token (encrypted), and a record of which
    Areas/Projects/Topics you keep or remove per save, so future suggestions improve. Page
    content you save is sent to an AI provider to classify it. You can disconnect and
    delete everything from the extension at any time.
  </div>
</main>
</body>
</html>`;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function errorPage(heading: string, detail: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${heading}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:#f4f6f5; color:#10161a;
    font-family: ui-sans-serif,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif; }
  @media (prefers-color-scheme: dark) { body { background:#0d1214; color:#e7ecea; } }
  main { max-width: 26rem; margin: 24px; text-align:center; }
  h1 { font-size: 18px; margin: 0 0 8px; }
  p { color: #59666c; font-size: 14px; margin:0; }
</style>
</head>
<body><main><h1>${heading}</h1><p>${detail}</p></main></body>
</html>`;
}
