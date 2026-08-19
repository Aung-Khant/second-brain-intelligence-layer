// Pure URL parsing and title cleanup for YouTube. No DOM, no network, no AI -
// a video ID either is or isn't in the URL, and a tab-title prefix either is
// or isn't noise. This is the "code handles facts" layer.
//
// The extension's popup keeps a hand-mirrored copy of the parsing helpers
// (it's plain JS with no build step and can't import this module), so a change
// to the accepted URL shapes here must be mirrored in extension/popup.js.

const videoIdPattern = /^[A-Za-z0-9_-]{11}$/;
const channelIdPattern = /^UC[A-Za-z0-9_-]{22}$/;

export type YouTubeTarget =
  | { kind: "video"; id: string }
  | { kind: "channel"; id: string };

export function parseYouTubeVideoId(url: string): string | null {
  const parsed = safeUrl(url);
  if (!parsed) return null;

  const host = hostOf(parsed);
  const path = parsed.pathname;

  if (host === "youtu.be") {
    return valid(path.slice(1).split("/")[0], videoIdPattern);
  }

  if (!isYouTubeHost(host)) return null;
  if (path === "/watch") return valid(parsed.searchParams.get("v") ?? "", videoIdPattern);

  // /shorts/<id> and /live/<id> are the same video addressed differently.
  const segments = path.split("/").filter(Boolean);
  if (segments.length >= 2 && (segments[0] === "shorts" || segments[0] === "live")) {
    return valid(segments[1], videoIdPattern);
  }

  return null;
}

// Channels are addressed four different ways and only /channel/ carries the
// stable UC id. The others yield a handle or vanity name, which is still a
// usable identity for our purposes but is not interchangeable with a UC id.
export function parseYouTubeChannelId(url: string): string | null {
  const parsed = safeUrl(url);
  if (!parsed) return null;
  if (!isYouTubeHost(hostOf(parsed))) return null;

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  const [first, second] = segments;

  if (first.startsWith("@") && first.length > 1) return first;
  if ((first === "channel" || first === "c" || first === "user") && second) {
    return second;
  }

  return null;
}

export function parseYouTubeTarget(url: string): YouTubeTarget | null {
  const videoId = parseYouTubeVideoId(url);
  if (videoId) return { kind: "video", id: videoId };

  const channelId = parseYouTubeChannelId(url);
  if (channelId) return { kind: "channel", id: channelId };

  return null;
}

export function canonicalYouTubeUrl(target: YouTubeTarget): string {
  if (target.kind === "video") {
    return `https://www.youtube.com/watch?v=${target.id}`;
  }

  if (target.id.startsWith("@")) {
    return `https://www.youtube.com/${target.id}`;
  }

  return channelIdPattern.test(target.id)
    ? `https://www.youtube.com/channel/${target.id}`
    : `https://www.youtube.com/c/${target.id}`;
}

// A browser tab title carries noise the video's real title does not: an unread
// notification count YouTube prepends ("(87) Real Title") and its own " -
// YouTube" suffix. Both are artifacts of reading document.title as a fallback,
// and neither belongs in Notion.
export function cleanYouTubeTitle(title: string | null): string | null {
  if (typeof title !== "string") return null;

  const cleaned = title
    .replace(/^\(\d+\)\s*/, "")
    .replace(/\s*[-–]\s*YouTube\s*$/i, "")
    .trim();

  return cleaned || null;
}

function valid(candidate: string, pattern: RegExp): string | null {
  const trimmed = candidate.trim();
  return pattern.test(trimmed) ? trimmed : null;
}

function safeUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function hostOf(parsed: URL): string {
  return parsed.hostname.toLowerCase().replace(/^www\./, "");
}

function isYouTubeHost(host: string): boolean {
  return host === "youtube.com" || host.endsWith(".youtube.com");
}
