# Architecture

## MVP vertical slice (YouTube videos)

The current build is a single end-to-end path for YouTube videos, in
`backend/src/v1/` and the rewritten `extension/` popup:

1. The extension extracts deterministic facts from the video page — video ID,
   title, channel, description, publish date, thumbnail — reading YouTube's own
   player payload rather than scraping rendered DOM.
2. `shared/schemas/captured-resource.ts` validates those facts. A missing title,
   a non-video URL, or metadata belonging to a different video than the URL all
   fail loudly here, before any AI call.
3. `notion/taxonomy.ts` supplies the user's existing Areas, Projects, and Topics.
4. `v1/understand.ts` (AI pass 1) describes what the video is about. It never
   sees the taxonomy, so it cannot write a summary shaped toward an answer.
5. `v1/classify.ts` (AI pass 2) picks from existing entities only. IDs are
   checked against the taxonomy in code, so invented entities are dropped rather
   than trusted.
6. Confidence is 0–1. At or above 0.90 an entity is auto-selected, 0.70–0.89 is
   suggested, below 0.70 is not selected by default. `v1/api.ts` computes this so
   the thresholds live in one place and the popup just renders them.
7. The user edits the selection and writes Why Saved, which is never AI-generated.
8. `v1/save.ts` writes the Resource to Notion; `v1/corrections.ts` records one row
   per entity — accepted, rejected, or manually_added — in backend storage only.

Endpoints: `POST /api/resource/analyze` and `POST /api/resource/save`.

## Legacy V0 pipeline

The modules below predate the slice above and are not part of it: `backend/src/ai/`,
`backend/src/server/api.ts`, `backend/src/evaluation/`, and the `/api/classify`,
`/api/enhance`, `/api/topics`, `/api/areas`, `/api/projects` routes. They still
build and their tests still pass, but new work should not extend them. The Notion
client, config, taxonomy reader, and URL helpers are shared by both and are current.

V0 classifies a trusted web resource against an existing Second Brain taxonomy and saves it into Notion:

1. Accept trusted resource metadata (from a fixture, stdin, or the Chrome extension).
2. Understand the resource into summary, concepts, keywords, and subject matter.
3. Compare the resource with an existing taxonomy (mock, or read live from Notion).
4. Score each candidate relationship independently, using local rules by default or AI Enhance on request.
5. Validate structured output.
6. Let the user confirm Area, Topic, Project, Save Intent, and Why Saved before writing anything.
7. Save the confirmed Resource into Notion, creating a Topic or Area page only when the user explicitly approves the suggestion.

Local classification is deliberately fast and does not depend on an external AI call. AI Enhance is opt-in and falls back to local matching on failure. The Chrome extension in `extension/` talks to the local API server in `backend/src/server` over `http://127.0.0.1:3737`.

