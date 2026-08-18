# Architecture

V0 classifies a trusted web resource against an existing Second Brain taxonomy and saves it into Notion:

1. Accept trusted resource metadata (from a fixture, stdin, or the Chrome extension).
2. Understand the resource into summary, concepts, keywords, and subject matter.
3. Compare the resource with an existing taxonomy (mock, or read live from Notion).
4. Score each candidate relationship independently, using local rules by default or AI Enhance on request.
5. Validate structured output.
6. Let the user confirm Area, Topic, Project, Save Intent, and Why Saved before writing anything.
7. Save the confirmed Resource into Notion, creating a Topic or Area page only when the user explicitly approves the suggestion.

Local classification is deliberately fast and does not depend on an external AI call. AI Enhance is opt-in and falls back to local matching on failure. The Chrome extension in `extension/` talks to the local API server in `backend/src/server` over `http://127.0.0.1:3737`.

