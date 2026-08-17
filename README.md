# Second Brain Intelligence Layer V0

V0 tests one hypothesis: can AI-like classification organize a trusted web resource into an existing Second Brain while preserving human meaning?

This milestone intentionally implements only:

- shared internal schemas
- mock taxonomy
- resource understanding
- relationship classification
- structured output validation
- CLI/test harness
- Notion taxonomy reads
- confirmed Resource saves into Notion
- local Chrome extension MVP

## Setup

```bash
npm install
npm test
```

## Run The Classifier

```bash
npm run build
node dist/backend/src/cli/classify.js tests/fixtures/3blue1brown-channel.json
```

You can also pass JSON through stdin:

```bash
cat tests/fixtures/3blue1brown-channel.json | node dist/backend/src/cli/classify.js
```

## Evaluate Gold Dataset

```bash
npm run evaluate
```

## Use Real Notion Taxonomy

Create a local `.env` file with your Notion token:

```bash
NOTION_API_KEY=your_secret_token
```

Then fetch the current taxonomy from Notion:

```bash
npm run taxonomy:notion
```

Classify one fixture against real Notion Areas, Topics, and active Projects:

```bash
npm run classify:notion -- tests/gold-dataset/thirty-days-of-python.json
```

Evaluate the gold dataset against real Notion:

```bash
npm run evaluate:notion
```

If `evaluate:notion` fails, that usually means the gold fixture expectations and your real Notion taxonomy use different labels or the Notion entries need richer definitions.

## Save A Resource Into Notion

Dry-run a Resource save without creating a Notion page:

```bash
npm run save:notion -- tests/fixtures/save-resource.json
```

Create the Resource only after reviewing the payload:

```bash
npm run save:notion -- tests/fixtures/save-resource.json --confirm-write
```

## Run The Extension MVP

Start the local API server:

```bash
npm run server
```

Then load the extension in Chrome:

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Choose Load unpacked.
4. Select the `extension` folder in this repo.
5. Open a normal web page, click the extension, classify, review, and save.

The extension talks to `http://127.0.0.1:3737`, so keep `npm run server` running while using it.

The server caches your Notion Areas, Topics, and Projects in memory for 10 minutes. This makes repeated classification faster because Notion is not refetched on every click. Restarting the server clears the cache.

You can change or disable the cache with:

```bash
NOTION_TAXONOMY_CACHE_TTL_MS=600000
```

Use `0` to disable the cache while editing your taxonomy heavily.

## Enable AI Classification

By default, the local server uses the rule-based classifier so the extension works without any external AI call.

To enable OpenRouter classification, add these values to `.env`:

```bash
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=your_openrouter_api_key
OPENROUTER_MODEL=deepseek/deepseek-v4-flash
```

You can also use OpenAI directly:

```bash
AI_PROVIDER=openai
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-5-mini
```

Then restart the local API server:

```bash
npm run server
```

When AI is enabled, the extension shows an `AI` badge beside the summary. If the AI request fails, the server falls back to local matching and the popup tells you local matching was used.

AI can suggest new Topics when no existing Topic fits, but Phase 6 does not auto-create Topics. Treat those suggestions as review notes until the Topic creation approval flow is added.

Suggested Topics now have an explicit create action in the extension. Clicking `Create Topic` creates a Topic page in Notion with the default Topic template, links it to the suggested Area when available, clears the local taxonomy cache, and selects the new Topic for the Resource you are reviewing.
