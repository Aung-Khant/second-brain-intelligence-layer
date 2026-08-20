# Sharing this with someone else

The onboarding flow is built: install the extension, click Connect, duplicate
the template, approve in Notion, done. This is what still has to be true for
that flow to actually run for a person who is not you.

Four things. Only the first is fiddly.

---

## 1. Create a public Notion integration

The tool needs one integration that everybody signs in through. This is a
different thing from the internal integration you already have, and the type
cannot be changed after creation.

1. Go to <https://www.notion.so/my-integrations> and click **New integration**
2. Set the type to **Public**, not Internal
3. Fill in the required fields (name, icon, a support email, and a privacy
   policy URL — Notion requires one to publish a public integration)
4. Under **Redirect URIs**, add exactly the URL your backend will use:
   - testing locally: `http://127.0.0.1:3737/api/auth/notion/callback`
   - hosted: `https://your-host.example.com/api/auth/notion/callback`
5. Copy the **OAuth client ID** and **client secret** into `.env`

The redirect URI has to match character for character. A trailing slash is a
different URI as far as Notion is concerned.

Notion only allows plain `http` for `localhost` / `127.0.0.1`. A hosted backend
must be `https`.

---

## 2. Publish the template so it can be duplicated

The link in your address bar (`app.notion.com/p/...`) is your private,
logged-in view of the page. Sending it to someone gets them a login wall, not
your template.

1. Open the Second Brain page in Notion
2. **Share** → turn on **Share to web**
3. Turn on **Allow duplicate as a template**
4. Copy the link — it will look like `https://<something>.notion.site/...`
5. Put it in `.env` as `NOTION_TEMPLATE_URL`

Keep the four database names as `Areas`, `Projects`, `Topics`, and
`Resources`. That is what lets setup finish with no manual step: after someone
approves access, the backend matches those names and fills in the mapping
itself. Rename them and every new user gets the manual picker instead — which
still works, it is just an extra screen.

---

## 3. Host the backend

Skip this only if the other person is on your machine. Their `127.0.0.1` is
their own computer, so an unhosted setup silently fails for them.

Any small Node host works — Railway, Render, and Fly all do this on a free or
roughly $5 tier, and all give you HTTPS automatically, which step 1 requires.

What the host needs:

- Node 20+, `npm install`, `npm run build`, `npm run server`
- Every variable from `.env.example` set as environment variables
- A **persistent disk** mounted for `data/` and `correction-logs/`

That last point matters more than it looks. On a platform with an ephemeral
filesystem, a redeploy wipes `data/connections.json` and everyone silently has
to reconnect. Point `CONNECTIONS_STORE_PATH` and `CORRECTIONS_LOG_PATH` at a
mounted volume.

---

## 4. Point the extension at your backend

Two files, one line each:

- `extension/config.js` — set `SECOND_BRAIN_API_BASE_URL` to your hosted URL
- `extension/manifest.json` — add that same origin to `host_permissions`,
  e.g. `"https://your-host.example.com/*"`

Chrome blocks requests to an origin missing from `host_permissions` before
they are ever sent, so both have to change together.

Then send them the `extension/` folder. They open `chrome://extensions`, turn
on **Developer mode**, and click **Load unpacked**. That is the whole install.

The Chrome Web Store ($5 one-off, a few days of review) is only worth it past a
handful of people.

---

## What they actually experience

1. Load the extension
2. Open any page, click the extension, click **Connect Notion**
3. A page explains what is about to happen and links your template
4. They click **Duplicate** — the template lands in their Notion
5. They click **Connect Notion** and approve on Notion's own screen, choosing
   which pages to share
6. Done. If they duplicated the template, the database mapping is already
   filled in and there is nothing else to do.

No terminal, no `.env`, no API key.

---

## Before you send it to anyone

Tell them, in your own words, what this does with their stuff. Concretely:

- Their Notion token is stored on your server, encrypted
- Which Areas, Projects, and Topics they keep or remove is recorded, so future
  suggestions get better
- **Page content they save is sent to an AI provider** to classify it — under
  your API account, so if they save something private, it transits a third
  party. This is the one people do not expect.
- They can disconnect from the extension at any time, which deletes the token
  and every correction record

The AI calls are billed to your OpenRouter key, and there is currently no
per-user limit.

Sessions do not expire on their own. Fine among friends; worth changing before
this goes anywhere public.
