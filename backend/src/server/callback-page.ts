// The page Notion redirects a real browser to after the user approves access.
//
// It is deliberately a dead end: it reports success or failure and tells the
// person to go back to the extension. It never receives or displays a session
// token, because the extension collects that itself by polling with the state
// it generated - so nothing sensitive is ever rendered into a page that could
// sit in browser history or be screenshotted.
import type { NotionConnection } from "../auth/connections.js";

export async function renderCallbackPage(
  query: URLSearchParams,
  complete: (code: string, state: string) => Promise<NotionConnection>
): Promise<string> {
  const error = query.get("error");
  if (error) {
    return page({
      ok: false,
      heading: "Notion didn't grant access",
      detail:
        error === "access_denied"
          ? "You declined the request. Nothing was connected."
          : `Notion reported: ${escapeHtml(error)}`
    });
  }

  const code = query.get("code");
  const state = query.get("state");

  if (!code || !state) {
    return page({
      ok: false,
      heading: "That link is incomplete",
      detail: "Start again from the extension."
    });
  }

  try {
    const connection = await complete(code, state);
    return page({
      ok: true,
      heading: "Notion connected",
      detail: `Connected to ${escapeHtml(connection.workspaceName)}. You can close this tab and go back to the extension.`
    });
  } catch (caught) {
    return page({
      ok: false,
      heading: "Couldn't finish connecting",
      detail: escapeHtml(caught instanceof Error ? caught.message : "Unexpected error.")
    });
  }
}

function page(input: { ok: boolean; heading: string; detail: string }): string {
  const accent = input.ok ? "#1f6f63" : "#a8452a";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${input.ok ? "Notion connected" : "Connection failed"}</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    background: #f4f6f5; color: #10161a;
    font-family: ui-sans-serif, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
  }
  @media (prefers-color-scheme: dark) {
    body { background: #0d1214; color: #e7ecea; }
    .card { background: #141b1e !important; border-color: rgba(231,236,234,.12) !important; }
  }
  .card {
    background: #fff; border: 1px solid rgba(16,22,26,.11); border-radius: 10px;
    padding: 34px 38px; max-width: 30rem; margin: 24px;
  }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: ${accent}; display: inline-block; margin-right: 9px; }
  h1 { font-size: 20px; margin: 0 0 10px; letter-spacing: -.01em; }
  p { margin: 0; color: rgba(89,102,108,.95); font-size: 14.5px; line-height: 1.6; }
  @media (prefers-color-scheme: dark) { p { color: #9aa8ad; } }
</style>
</head>
<body>
  <main class="card">
    <h1><span class="dot"></span>${input.heading}</h1>
    <p>${input.detail}</p>
  </main>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
