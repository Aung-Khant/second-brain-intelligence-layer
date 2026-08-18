// The one error type used across the whole backend. `code` lets the server
// (see server/dev-server.ts's toErrorResponse) map a failure to a clean HTTP
// error instead of a raw 500, and `cause` preserves the original underlying
// error (e.g. a real Notion API error body) for the detailed message shown
// to the user without changing the top-level error's type.
export type AppErrorCode =
  | "PAGE_EXTRACTION_FAILED"
  | "PAGE_IDENTITY_MISMATCH"
  | "UNSUPPORTED_RESOURCE"
  | "NOTION_AUTH_FAILED"
  | "NOTION_FETCH_FAILED"
  | "AI_REQUEST_FAILED"
  | "AI_INVALID_OUTPUT"
  | "DUPLICATE_RESOURCE"
  | "NOTION_SAVE_FAILED";

export class AppError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "AppError";
  }
}

