# Decisions

## MVP vertical slice

- Understanding and classification are two separate AI calls. A single call that
  does both lets the model shape its summary toward the answer it wants to give.
- The classifier may only return IDs that exist in the taxonomy. This is enforced
  in code, not by prompt instruction, and the entity name is read from the
  taxonomy rather than from the model's output.
- Confidence is 0–1 in the slice, 0–100 in the legacy pipeline. They are separate
  scales in separate modules; do not mix them.
- Selection state is computed on the backend and obeyed by the popup, so the
  0.90/0.70 thresholds have exactly one definition.
- The MVP extension cannot create Areas, Projects, or Topics. Only existing
  entities can be selected.
- Why Saved is never AI-generated in the slice.
- The slice does not write `Save Intent`. It does write Status, Archive, and
  Favorite defaults, because every existing row in the Resources database has
  them and new rows would otherwise look broken beside old ones.
- Transcripts are not fetched. Title, channel, and description carry the
  classification for now; a transcript source can be added behind
  `understandResource` without touching the classifier.
- Correction records live in `correction-logs/corrections.jsonl`, never in Notion.

## Legacy V0

- Keep V0 as a plain TypeScript monorepo.
- AI never invents or suggests a new Project — Projects it proposes are always existing active work. The user can still manually create a new Project from the picker, same as Area/Topic, since only the AI-suggestion path is restricted.
- Do not create Areas or Topics automatically — a suggested Area or Topic is only created in Notion after the user explicitly accepts it in the extension.
- Allow multiple strong relationships.
- Allow empty relationship arrays.
- Keep confidence thresholds in configuration.
- Do not generate Why Saved without a human in the loop — AI Enhance may suggest one, but the user reviews and confirms it before saving.
