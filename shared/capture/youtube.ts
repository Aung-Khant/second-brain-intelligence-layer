// Pure URL parsing for YouTube video links. No DOM, no network, no AI - a
// video ID either is or isn't in the URL. The extension's content script
// keeps a hand-mirrored copy of parseYouTubeVideoId (it's plain JS with no
// build step and can't import this module), so a change to the accepted URL
// shapes here must be mirrored in extension/popup.js.

const videoIdPattern = /^[A-Za-z0-9_-]{11}$/;

export function parseYouTubeVideoId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const path = parsed.pathname;

  if (host === "youtu.be") {
    return validVideoId(path.slice(1).split("/")[0]);
  }

  if (host !== "youtube.com" && !host.endsWith(".youtube.com")) {
    return null;
  }

  if (path === "/watch") {
    return validVideoId(parsed.searchParams.get("v") ?? "");
  }

  // /shorts/<id> and /live/<id> are the same video addressed differently.
  const segments = path.split("/").filter(Boolean);
  if (segments.length >= 2 && (segments[0] === "shorts" || segments[0] === "live")) {
    return validVideoId(segments[1]);
  }

  return null;
}

export function canonicalYouTubeUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function validVideoId(candidate: string): string | null {
  const trimmed = candidate.trim();
  return videoIdPattern.test(trimmed) ? trimmed : null;
}
