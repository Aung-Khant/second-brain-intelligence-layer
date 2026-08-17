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
