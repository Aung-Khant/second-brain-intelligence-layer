// Infers ResourceType purely from a URL's host/path shape (youtube.com/watch
// etc.) - no page content involved. The extension's popup.js keeps its own
// copy of this exact logic (it's plain JS with no build step and can't
// import this shared TS module), so a change here needs to be mirrored in
// extension/popup.js's inferResourceType by hand.
import type { ResourceType } from "./types/resource.js";

export function inferResourceTypeFromUrl(url: string): ResourceType {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const pathname = parsed.pathname.toLowerCase();

    if (host === "youtu.be") {
      return "youtube_video";
    }

    if (host === "youtube.com" || host.endsWith(".youtube.com")) {
      if (
        pathname === "/watch" ||
        pathname.startsWith("/shorts/") ||
        pathname.startsWith("/live/")
      ) {
        return "youtube_video";
      }

      if (
        pathname.startsWith("/@") ||
        pathname.startsWith("/channel/") ||
        pathname.startsWith("/c/") ||
        pathname.startsWith("/user/")
      ) {
        return "youtube_channel";
      }
    }
  } catch {
    return "webpage";
  }

  return "webpage";
}
