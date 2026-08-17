# Second Brain Intelligence Layer V0

V0 tests one hypothesis: can AI-like classification organize a trusted web resource into an existing Second Brain while preserving human meaning?

This milestone intentionally implements only:

- shared internal schemas
- mock taxonomy
- resource understanding
- relationship classification
- structured output validation
- CLI/test harness

It does not include the Chrome extension or Notion writes yet.

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

