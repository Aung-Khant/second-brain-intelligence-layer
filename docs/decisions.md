# Decisions

- Keep V0 as a plain TypeScript monorepo.
- AI never invents or suggests a new Project — Projects it proposes are always existing active work. The user can still manually create a new Project from the picker, same as Area/Topic, since only the AI-suggestion path is restricted.
- Do not create Areas or Topics automatically — a suggested Area or Topic is only created in Notion after the user explicitly accepts it in the extension.
- Allow multiple strong relationships.
- Allow empty relationship arrays.
- Keep confidence thresholds in configuration.
- Do not generate Why Saved without a human in the loop — AI Enhance may suggest one, but the user reviews and confirms it before saving.
