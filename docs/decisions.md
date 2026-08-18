# Decisions

- Keep V0 as a plain TypeScript monorepo.
- Do not create Projects during capture; Projects are always picked from existing Notion Projects.
- Do not create Areas or Topics automatically — a suggested Area or Topic is only created in Notion after the user explicitly accepts it in the extension.
- Allow multiple strong relationships.
- Allow empty relationship arrays.
- Keep confidence thresholds in configuration.
- Do not generate Why Saved without a human in the loop — AI Enhance may suggest one, but the user reviews and confirms it before saving.
