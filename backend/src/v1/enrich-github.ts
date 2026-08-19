// GitHub is the only source with a real API, so it is the only one that gets
// better data from the backend than from the page. The API gives a clean
// description, topic tags, and the primary language as structured fields -
// no scraping, no guessing at DOM shape that changes with every redesign.
//
// Enrichment is best-effort by design. The page extractor has already produced
// something usable, so a rate limit or an outage degrades the result rather
// than failing the save.
import type { CapturedResource } from "../../../shared/types/captured-resource.js";

type GitHubRepo = {
  full_name?: string;
  description?: string | null;
  topics?: string[];
  language?: string | null;
  stargazers_count?: number;
  pushed_at?: string;
  owner?: { login?: string };
  homepage?: string | null;
};

const timeoutMs = 4000;

export async function enrichGitHubRepo(resource: CapturedResource): Promise<CapturedResource> {
  if (resource.sourceType !== "github_repo" || !resource.sourceId) return resource;

  const repo = await fetchRepo(resource.sourceId);
  if (!repo) return resource;

  // The repo's own description is almost always a better one-liner than
  // anything scraped, but topics and language are what actually help
  // classification - they name the field in the project's own words.
  const facts = [
    repo.description?.trim() || null,
    repo.language ? `Primary language: ${repo.language}.` : null,
    repo.topics?.length ? `Topics: ${repo.topics.join(", ")}.` : null
  ].filter(Boolean);

  return {
    ...resource,
    creator: repo.owner?.login ?? resource.creator,
    description: facts.length ? facts.join(" ") : resource.description,
    publishedAt: repo.pushed_at ?? resource.publishedAt
  };
}

async function fetchRepo(fullName: string): Promise<GitHubRepo | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`https://api.github.com/repos/${fullName}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "second-brain-intelligence-layer"
      },
      signal: controller.signal
    });

    // 404 on a private repo, 403 once the unauthenticated hourly limit is hit.
    // Neither is worth failing the capture over.
    if (!response.ok) return null;

    return (await response.json()) as GitHubRepo;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
