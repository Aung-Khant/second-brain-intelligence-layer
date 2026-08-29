# Second Brain Intelligence Layer

A Chrome extension and Node backend for capturing useful material into a
Notion Second Brain. It extracts facts from the current page, uses AI to
understand the resource, suggests relationships to the user's existing Areas,
Projects, and Topics, and saves only after the user reviews the result.

The current capture flow supports:

- YouTube videos and channels
- GitHub repositories
- Research papers, including arXiv and common academic publishers
- Articles and general web pages

## How It Works

1. Open a supported page and click the extension.
2. The extension captures deterministic metadata from the page.
3. The backend summarizes the resource and matches it against the connected
   Notion workspace's Areas, Projects, and Topics.
4. Review the suggestions, add or remove relationships, and write **Why Saved**.
5. Save the confirmed Resource to Notion.

AI suggestions never write directly to Notion. Existing taxonomy is matched by
ID, new Areas or Topics require an explicit user action, and new Projects can
only be created manually. Corrections are recorded locally so future ranking
can be evaluated without polluting the Notion databases.

## Requirements

- Node.js 20 or newer
- Chrome or another Chromium browser
- A Notion workspace containing Areas, Projects, Topics, and Resources databases
- An OpenRouter or OpenAI API key

## Local Development

Install dependencies and create a local environment file:

```bash
npm install
cp .env.example .env
```

Choose one AI provider in `.env`:

```bash
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=your_openrouter_api_key
OPENROUTER_MODEL=google/gemini-2.5-flash-lite
```

Or use OpenAI:

```bash
AI_PROVIDER=openai
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-5-mini
```

Then configure Notion using one of the two modes below and start the backend:

```bash
npm run server
```

Load the extension:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click **Load unpacked**.
4. Select the `extension/` directory.
5. Open a supported page and click **Second Brain Capture**.

The extension uses `http://127.0.0.1:3737` by default. The server must remain
running while the extension is in use.

## Notion Connection

### OAuth mode

OAuth is the normal path and is required when more than one person uses the
backend. Create a public Notion integration, then set:

```bash
NOTION_OAUTH_CLIENT_ID=
NOTION_OAUTH_CLIENT_SECRET=
NOTION_OAUTH_REDIRECT_URI=http://127.0.0.1:3737/api/auth/notion/callback
TOKEN_ENCRYPTION_KEY=
```

Generate the encryption key with:

```bash
openssl rand -hex 32
```

When the extension opens, click **Connect Notion**. The backend discovers the
workspace's databases and suggests mappings for Areas, Projects, Topics, and
Resources. Exact conventional names can be mapped automatically; otherwise the
user confirms them during setup.

To offer a duplicable Second Brain before authorization, publish the Notion
template with duplication enabled and set `NOTION_TEMPLATE_URL`.

See [docs/SHARING.md](docs/SHARING.md) for public integration setup, hosting,
persistent storage, extension configuration, and privacy considerations.

### Single-user local mode

The original internal-integration setup remains available for local development
only. It is disabled by default so a sessionless request cannot accidentally
write into the server owner's workspace.

```bash
ALLOW_LOCAL_ENV_FALLBACK=true
NOTION_API_KEY=your_internal_integration_token
NOTION_AREAS_DATA_SOURCE_ID=
NOTION_TOPICS_DATA_SOURCE_ID=
NOTION_PROJECTS_DATA_SOURCE_ID=
NOTION_RESOURCES_DATA_SOURCE_ID=
```

Do not enable `ALLOW_LOCAL_ENV_FALLBACK` on a shared server.

## Suggestion Behavior

- Confidence of `0.90` or higher is selected automatically.
- Confidence from `0.70` through `0.89` is shown as an unchecked suggestion.
- Lower-confidence matches are omitted from the initial result.
- Empty matches are valid; the user can add any existing taxonomy item manually.
- **Why Saved** is required and remains human-authored.
- Duplicate detection and source identity checks run before a write.

The taxonomy cache defaults to ten minutes. Override it with
`NOTION_TAXONOMY_CACHE_TTL_MS`; set the value to `0` to disable caching.

## Development Commands

```bash
npm run build          # compile TypeScript
npm test               # compile and run the test suite
npm run server         # compile and start the API on port 3737
npm run evaluate       # evaluate the legacy gold dataset
npm run evaluate:notion
```

## Project Structure

```text
backend/src/v1/       current analyze, classify, save, and correction flow
backend/src/auth/     Notion OAuth connections and encrypted token storage
backend/src/notion/   Notion taxonomy reads and writes
backend/src/server/   HTTP API and onboarding pages
extension/            unpacked Chrome extension
shared/               capture adapters, schemas, and shared types
tests/                unit and integration-style tests
docs/                 architecture, decisions, philosophy, and sharing guide
```

## Legacy V0

The earlier classifier and CLI pipeline remains available for experiments and
evaluation. It is not the path used by the current extension.

```bash
npm run taxonomy:notion
npm run classify:notion -- tests/gold-dataset/thirty-days-of-python.json
npm run save:notion -- tests/fixtures/save-resource.json
npm run save:notion -- tests/fixtures/save-resource.json --confirm-write
```

For implementation boundaries and the legacy module map, see
[docs/architecture.md](docs/architecture.md).
