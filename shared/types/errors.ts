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

