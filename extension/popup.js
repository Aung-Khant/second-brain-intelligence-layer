// The capture popup. It extracts deterministic facts from the current page,
// asks the backend to analyze them, and lets the user correct the result
// before saving.
//
// Which extractor runs is decided by detectSource, mirroring the registry in
// shared/capture/source.ts. Supported: YouTube videos and channels, GitHub
// repositories, research papers, articles, and general web pages.
//
// It never creates taxonomy on its own - the AI may propose new Areas and
// Topics, but only a human click creates one. Notion credentials stay in the
// backend; this file only ever talks to the local API.
//
// Analysis starts automatically on open, so the common path is: open, glance,
// save. Selection state (auto_selected / suggested) is computed by the backend
// so the confidence thresholds live in exactly one place; this file renders
// what it is told and does not re-derive them.

const apiBaseUrl = "http://127.0.0.1:3737";

const state = {
  sessionToken: undefined,
  resource: null,
  understanding: null,
  classification: null,
  taxonomy: { areas: [], projects: [], topics: [] },
  selected: { areas: new Map(), projects: new Map(), topics: new Map() }
};

const kinds = ["areas", "projects", "topics"];

const elements = {
  video: document.getElementById("video"),
  videoTitle: document.getElementById("video-title"),
  videoCreator: document.getElementById("video-creator"),
  videoSummary: document.getElementById("video-summary"),
  status: document.getElementById("status"),
  results: document.getElementById("results"),
  whySaved: document.getElementById("why-saved"),
  whyRequired: document.querySelector(".why__required"),
  save: document.getElementById("save"),
  connect: document.getElementById("connect")
};

document.addEventListener("DOMContentLoaded", () => {
  elements.save.addEventListener("click", save);
  elements.whySaved.addEventListener("input", updateSaveState);

  for (const kind of kinds) {
    document
      .querySelector(`[data-reveal="${kind}"]`)
      .addEventListener("click", () => revealAdder(kind));

    const input = document.querySelector(`[data-input="${kind}"]`);
    input.addEventListener("input", () => renderPickerOptions(kind));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        hideAdder(kind);
        return;
      }
      // Enter is a shortcut for the first result, never a requirement -
      // clicking an option selects it outright.
      if (event.key === "Enter") {
        event.preventDefault();
        document.querySelector(`[data-options="${kind}"] .picker__option`)?.click();
      }
    });
  }

  // A click inside the popup that isn't on a picker closes any open one.
  document.addEventListener("mousedown", (event) => {
    for (const kind of kinds) {
      const picker = document.querySelector(`[data-picker="${kind}"]`);
      const addButton = document.querySelector(`[data-reveal="${kind}"]`);
      if (picker.hidden) continue;
      if (!picker.contains(event.target) && event.target !== addButton) hideAdder(kind);
    }
  });

  start();
});

async function start() {
  state.sessionToken = await readSessionToken();

  let status;
  try {
    status = await getJson("/api/auth/status");
  } catch (error) {
    showStatus(error.message, true);
    return;
  }

  // localFallback is the single-user .env path, kept working for local
  // development. Anyone else has to connect their own workspace.
  if (!status.connected && !status.localFallback) {
    showConnect(status);
    return;
  }

  if (status.needsDatabaseSetup) {
    showStatus("Finish choosing your databases to start saving.", true);
    elements.connect.hidden = false;
    elements.connect.textContent = "Choose databases";
    elements.connect.onclick = () => openSetup();
    return;
  }

  const captured = await capture();
  if (captured) await analyze();
}

function showConnect(status) {
  elements.connect.hidden = false;
  elements.connect.textContent = "Connect Notion";
  elements.connect.onclick = connectNotion;

  showStatus(
    status.oauthAvailable
      ? "Connect your Notion workspace to start saving."
      : "This server has no Notion sign-in configured yet.",
    !status.oauthAvailable
  );
  elements.connect.disabled = !status.oauthAvailable;
}

// Opens Notion's own consent screen in a tab, then waits for the backend to
// finish the exchange. The extension only ever learns the session token.
async function connectNotion() {
  elements.connect.disabled = true;
  showStatus("Opening Notion…");

  try {
    const { authorizeUrl, state: handshakeState } = await postJson("/api/auth/notion/start", {});
    await chrome.tabs.create({ url: authorizeUrl });
    showStatus("Waiting for you to approve access in Notion…");

    const claimed = await pollForSession(handshakeState);
    if (!claimed) {
      showStatus("That took too long. Try connecting again.", true);
      elements.connect.disabled = false;
      return;
    }

    await writeSessionToken(claimed.sessionToken);
    showStatus(`Connected to ${claimed.workspaceName}.`);

    if (claimed.needsDatabaseSetup) {
      elements.connect.textContent = "Choose databases";
      elements.connect.onclick = () => openSetup();
      elements.connect.disabled = false;
      return;
    }

    elements.connect.hidden = true;
    const captured = await capture();
    if (captured) await analyze();
  } catch (error) {
    showStatus(error.message, true);
    elements.connect.disabled = false;
  }
}

async function pollForSession(handshakeState) {
  const deadline = Date.now() + 5 * 60 * 1000;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const result = await getJson(
      `/api/auth/notion/claim?state=${encodeURIComponent(handshakeState)}`
    );
    if (result.status === "connected") return result;
    if (result.status === "expired") return undefined;
  }

  return undefined;
}

function openSetup() {
  chrome.tabs.create({ url: `${apiBaseUrl}/setup?session=${encodeURIComponent(state.sessionToken ?? "")}` });
}

async function capture() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab found.");

    const target = detectSource(tab.url ?? "");
    if (!target) {
      showStatus("This page can't be saved. Open a normal web page and try again.", true);
      return false;
    }

    // MAIN world: YouTube's own payload is a page global, invisible to an
    // isolated content script. Reading it beats scraping rendered DOM, which
    // changes shape with every YouTube redesign.
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: extractors[target.sourceType]
    });

    const extracted = result?.result;
    if (extracted?.stale) {
      showStatus("This page's data is out of date. Reload the page, then reopen.", true);
      return false;
    }

    if (!extracted?.sourceId) {
      showStatus("Could not read this page. Let it finish loading and reopen.", true);
      return false;
    }

    state.resource = {
      ...extracted,
      url: tab.url ?? extracted.url,
      // Clean it here too, not just on the backend, so the title reads
      // correctly the instant the popup opens - and still reads correctly if
      // analysis fails before the normalized resource comes back.
      title: cleanYouTubeTitle(extracted.title)
    };
    renderVideo();
    return true;
  } catch (error) {
    showStatus(error.message, true);
    return false;
  }
}

// Runs in the page. Must be self-contained - no closure over popup scope.
function extractYouTubeVideo() {
  const player = window.ytInitialPlayerResponse;
  const details = player?.videoDetails;
  const microformat = player?.microformat?.playerMicroformatRenderer;

  const meta = (selector, attribute = "content") =>
    document.querySelector(selector)?.getAttribute(attribute) || null;

  const sourceId =
    details?.videoId ||
    meta('meta[itemprop="videoId"]') ||
    new URL(location.href).searchParams.get("v");

  const thumbnails = details?.thumbnail?.thumbnails;

  return {
    url: location.href,
    canonicalUrl: meta('link[rel="canonical"]', "href"),
    sourceType: "youtube_video",
    sourceId: sourceId || null,
    title: details?.title || meta('meta[name="title"]') || document.title || null,
    creator: details?.author || meta('link[itemprop="name"]', "content") || null,
    creatorId: details?.channelId || meta('meta[itemprop="channelId"]') || null,
    description:
      details?.shortDescription ||
      microformat?.description?.simpleText ||
      meta('meta[name="description"]') ||
      null,
    pageText: null,
    publishedAt: microformat?.publishDate || meta('meta[itemprop="datePublished"]') || null,
    thumbnailUrl: thumbnails?.[thumbnails.length - 1]?.url || meta('meta[property="og:image"]')
  };
}

// Runs in the page. Must be self-contained - no closure over popup scope.
//
// YouTube is a single-page app: navigating from one channel to another swaps
// the rendered DOM but leaves window.ytInitialData holding the FIRST channel
// loaded in that tab. Trusting it blindly attributes one channel's metadata to
// another's URL. So the URL is treated as the only authoritative identity, and
// page data is used only when it corroborates the URL.
function extractYouTubeChannel() {
  const meta = (selector, attribute = "content") =>
    document.querySelector(selector)?.getAttribute(attribute) || null;

  const segments = location.pathname.split("/").filter(Boolean);
  const urlHandle = segments.find((segment) => segment.startsWith("@")) || null;
  const urlChannelId = segments[0] === "channel" ? segments[1] : null;

  const metadata = window.ytInitialData?.metadata?.channelMetadataRenderer;
  const c4 = window.ytInitialData?.header?.c4TabbedHeaderRenderer;
  const externalId = metadata?.externalId || c4?.channelId || null;
  const dataHandle = (metadata?.vanityChannelUrl || "").match(/@[\w.-]+/)?.[0] || null;

  // Does the cached payload actually describe the channel in the address bar?
  const contradicted =
    (urlHandle && dataHandle && urlHandle.toLowerCase() !== dataHandle.toLowerCase()) ||
    (urlChannelId && externalId && urlChannelId !== externalId);
  const trusted = !contradicted;

  // The rendered header updates on navigation even when ytInitialData doesn't,
  // so it's the more reliable source for the visible name.
  const domName = [
    ".page-header-view-model-wiz__page-header-title",
    "#page-header h1",
    "#channel-header #channel-name #text",
    "ytd-channel-name#channel-name #text"
  ]
    .map((selector) => document.querySelector(selector)?.textContent?.trim())
    .find((text) => text);

  const name = domName || (trusted ? metadata?.title || c4?.title : null) || null;

  if (!name) {
    return { stale: true };
  }

  return {
    url: location.href,
    canonicalUrl: null,
    sourceType: "youtube_channel",
    // Prefer the URL's own identity so this can never disagree with the page.
    sourceId: urlChannelId || urlHandle || (trusted ? externalId : null),
    title: name,
    creator: name,
    creatorId: trusted ? externalId : null,
    // Only carry the description across if the payload is about this channel.
    // A wrong description would quietly produce a confident, wrong summary.
    description: trusted
      ? metadata?.description || meta('meta[property="og:description"]') || null
      : null,
    pageText: null,
    publishedAt: null,
    thumbnailUrl: trusted ? meta('meta[property="og:image"]') : null
  };
}

// Mirrors shared/capture/youtube.ts cleanYouTubeTitle.
function cleanYouTubeTitle(title) {
  if (typeof title !== "string") return null;
  const cleaned = title
    .replace(/^\(\d+\)\s*/, "")
    .replace(/\s*[-–]\s*YouTube\s*$/i, "")
    .trim();
  return cleaned || null;
}

// Runs in the page. Must be self-contained - no closure over popup scope.
//
// The DOM is only a fallback here: the backend re-fetches this repo from the
// GitHub API, which gives a description, topics, and language as real fields.
// This exists so a capture still works when the API is rate-limited.
function extractGitHubRepo() {
  const meta = (selector, attribute = "content") =>
    document.querySelector(selector)?.getAttribute(attribute) || null;

  const segments = location.pathname.split("/").filter(Boolean);
  const fullName = segments.slice(0, 2).join("/").replace(/\.git$/, "");

  const about =
    document.querySelector('[data-testid="repo-description"], .f4.my-3')?.textContent?.trim() ||
    meta('meta[property="og:description"]') ||
    null;

  const topics = [...document.querySelectorAll('a[data-ga-click*="topic"], .topic-tag')]
    .map((node) => node.textContent.trim())
    .filter(Boolean);

  return {
    url: location.href,
    canonicalUrl: null,
    sourceType: "github_repo",
    sourceId: fullName,
    title: fullName,
    creator: segments[0] || null,
    creatorId: null,
    description: [about, topics.length ? `Topics: ${topics.join(", ")}.` : null]
      .filter(Boolean)
      .join(" ") || null,
    pageText: null,
    publishedAt: null,
    thumbnailUrl: meta('meta[property="og:image"]')
  };
}

// Runs in the page. Must be self-contained - no closure over popup scope.
//
// Academic publishers almost universally emit Highwire Press citation_* tags,
// which makes this the most reliable extraction of any source: the abstract is
// a better summary input than anything on an ordinary web page.
function extractResearchPaper() {
  const meta = (selector, attribute = "content") =>
    document.querySelector(selector)?.getAttribute(attribute) || null;

  const all = (name) =>
    [...document.querySelectorAll(`meta[name="${name}"]`)]
      .map((node) => node.getAttribute("content"))
      .filter(Boolean);

  const authors = all("citation_author");
  const arxiv = location.pathname.match(/\/(?:abs|pdf)\/([\w.\/-]+?)(?:v\d+)?(?:\.pdf)?$/);

  const abstract =
    meta('meta[name="citation_abstract"]') ||
    meta('meta[name="description"]') ||
    document.querySelector(".abstract, #abstract, blockquote.abstract")?.textContent?.trim() ||
    null;

  return {
    url: location.href,
    canonicalUrl: meta('link[rel="canonical"]', "href"),
    sourceType: "research_paper",
    sourceId: arxiv ? `arxiv:${arxiv[1]}` : meta('meta[name="citation_doi"]') || location.href,
    title: meta('meta[name="citation_title"]') || document.title || null,
    creator: authors.length ? authors.slice(0, 6).join(", ") : null,
    creatorId: meta('meta[name="citation_doi"]'),
    description: abstract,
    pageText: null,
    publishedAt: meta('meta[name="citation_publication_date"]') || null,
    thumbnailUrl: null
  };
}

// Runs in the page. Must be self-contained - no closure over popup scope.
//
// The riskiest extractor by far: everything downstream rests on this returning
// real prose rather than navigation chrome. A page that extracts as a menu
// produces a confident, useless summary, and the confidence bands will not
// catch it, because the model is not uncertain there - only wrong.
//
// Deliberately a heuristic rather than a full readability implementation. It
// is behind the same interface, so it can be replaced without touching
// anything else once real use shows which pages it fails on.
function extractWebPage() {
  const meta = (selector, attribute = "content") =>
    document.querySelector(selector)?.getAttribute(attribute) || null;

  const jsonLd = (() => {
    for (const node of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const parsed = JSON.parse(node.textContent);
        const entries = Array.isArray(parsed) ? parsed : [parsed, ...(parsed["@graph"] ?? [])];
        for (const entry of entries) {
          if (entry && typeof entry["@type"] === "string") return entry;
        }
      } catch {
        // A malformed block is common and not worth failing over.
      }
    }
    return null;
  })();

  const ldType = String(jsonLd?.["@type"] ?? "");
  const ogType = meta('meta[property="og:type"]') ?? "";

  // Article vs website is a fact about the page, so code decides it, not the
  // model. Any one of these signals is enough.
  const isArticle =
    /article|blogposting|newsarticle|report/i.test(ldType) ||
    /article/i.test(ogType) ||
    Boolean(meta('meta[property="article:published_time"]')) ||
    Boolean(document.querySelector("article"));

  const author =
    meta('meta[name="author"]') ||
    meta('meta[property="article:author"]') ||
    (typeof jsonLd?.author === "object" ? jsonLd.author?.name : jsonLd?.author) ||
    null;

  // Prefer the semantic container; fall back to whichever block carries the
  // most paragraph text, which is a decent proxy for "the actual content".
  const candidates = [
    document.querySelector("article"),
    document.querySelector("main"),
    document.querySelector('[role="main"]'),
    ...document.querySelectorAll("#content, .post, .entry-content, .article-body")
  ].filter(Boolean);

  const score = (node) =>
    [...node.querySelectorAll("p")].reduce((total, p) => total + p.textContent.trim().length, 0);

  let best = candidates.sort((a, b) => score(b) - score(a))[0] ?? document.body;
  if (score(best) < 200) best = document.body;

  const clone = best.cloneNode(true);
  for (const node of clone.querySelectorAll(
    "nav, aside, footer, header, script, style, noscript, form, iframe, button, " +
      '[role="navigation"], [aria-hidden="true"], .comments, #comments, .sidebar, .related'
  )) {
    node.remove();
  }

  const pageText = clone.textContent.replace(/\s+/g, " ").trim().slice(0, 12000) || null;

  return {
    url: location.href,
    canonicalUrl: meta('link[rel="canonical"]', "href"),
    sourceType: isArticle ? "article" : "website",
    // A general page has no identifier of its own; its URL is its identity.
    sourceId: location.origin + location.pathname,
    title:
      meta('meta[property="og:title"]') ||
      document.querySelector("h1")?.textContent?.trim() ||
      document.title ||
      null,
    creator: author || location.hostname.replace(/^www\./, ""),
    creatorId: null,
    description:
      meta('meta[name="description"]') || meta('meta[property="og:description"]') || null,
    pageText,
    publishedAt:
      meta('meta[property="article:published_time"]') ||
      meta('meta[name="citation_publication_date"]') ||
      jsonLd?.datePublished ||
      null,
    thumbnailUrl: meta('meta[property="og:image"]')
  };
}

// Which in-page extractor runs for each source type. Adding a source type
// means adding a detector below and an entry here - nothing else in this file
// should need to know the difference.
const extractors = {
  youtube_video: extractYouTubeVideo,
  youtube_channel: extractYouTubeChannel,
  github_repo: extractGitHubRepo,
  research_paper: extractResearchPaper,
  website: extractWebPage
};

// Mirrors shared/capture/source.ts. Kept in sync by hand - the extension has
// no build step and cannot import the TypeScript modules. The backend
// re-validates everything this returns, so a drift here fails closed at the
// API rather than saving something wrong.
function detectSource(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  for (const detect of [
    detectYouTubeVideo,
    detectYouTubeChannel,
    detectGitHubRepo,
    detectResearchPaper,
    detectWebPage
  ]) {
    const detected = detect(parsed);
    if (detected) return detected;
  }

  return null;
}

const reservedGitHubPaths = new Set([
  "features", "pricing", "about", "topics", "collections", "trending",
  "marketplace", "sponsors", "settings", "notifications", "explore", "orgs",
  "organizations", "login", "join", "search", "apps", "codespaces", "issues",
  "pulls", "new"
]);

function detectGitHubRepo(parsed) {
  if (parsed.hostname.toLowerCase().replace(/^www\./, "") !== "github.com") return null;

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length < 2) return null;

  const [owner, repo] = segments;
  if (reservedGitHubPaths.has(owner.toLowerCase())) return null;
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) return null;

  return { sourceType: "github_repo", id: `${owner}/${repo.replace(/\.git$/, "")}` };
}

const paperHosts = [
  "arxiv.org", "doi.org", "dx.doi.org", "pubmed.ncbi.nlm.nih.gov",
  "ncbi.nlm.nih.gov", "biorxiv.org", "medrxiv.org", "dl.acm.org",
  "ieeexplore.ieee.org", "papers.ssrn.com", "semanticscholar.org",
  "openreview.net", "sciencedirect.com", "nature.com", "jstor.org"
];

function detectResearchPaper(parsed) {
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (!paperHosts.some((paperHost) => host === paperHost || host.endsWith(`.${paperHost}`))) {
    return null;
  }

  const arxiv = parsed.pathname.match(/\/(?:abs|pdf)\/([\w.\/-]+?)(?:v\d+)?(?:\.pdf)?$/);
  return { sourceType: "research_paper", id: arxiv ? `arxiv:${arxiv[1]}` : null };
}

function detectWebPage(parsed) {
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return null;
  if (!parsed.hostname.includes(".")) return null;

  return { sourceType: "website", id: null };
}

function detectYouTubeVideo(parsed) {
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const path = parsed.pathname;
  const valid = (candidate) =>
    /^[A-Za-z0-9_-]{11}$/.test(candidate || "")
      ? { sourceType: "youtube_video", id: candidate }
      : null;

  if (host === "youtu.be") return valid(path.slice(1).split("/")[0]);
  if (host !== "youtube.com" && !host.endsWith(".youtube.com")) return null;
  if (path === "/watch") return valid(parsed.searchParams.get("v"));

  const segments = path.split("/").filter(Boolean);
  if (segments.length >= 2 && (segments[0] === "shorts" || segments[0] === "live")) {
    return valid(segments[1]);
  }

  return null;
}

function detectYouTubeChannel(parsed) {
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "youtube.com" && !host.endsWith(".youtube.com")) return null;

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  const [first, second] = segments;
  if (first.startsWith("@") && first.length > 1) {
    return { sourceType: "youtube_channel", id: first };
  }
  if ((first === "channel" || first === "c" || first === "user") && second) {
    return { sourceType: "youtube_channel", id: second };
  }

  return null;
}

async function analyze() {
  showStatus("Analyzing…");

  try {
    const response = await postJson("/api/resource/analyze", { resource: state.resource });

    state.resource = response.resource;
    state.classification = response.classification;
    state.taxonomy = response.taxonomy;

    state.understanding = response.understanding;

    seedSelection(response.classification);
    renderVideo();
    renderAll();

    elements.results.hidden = false;
    showStatus(summarize(response.classification));
    updateSaveState();
    elements.whySaved.focus();
  } catch (error) {
    showStatus(error.message, true);
  }
}

function summarize(classification) {
  const total =
    classification.areas.length + classification.projects.length + classification.topics.length;

  return total === 0 ? "No confident matches — add anything that fits, or save as is." : "";
}

function seedSelection(classification) {
  for (const kind of kinds) {
    state.selected[kind].clear();
    for (const candidate of classification[kind]) {
      if (candidate.state === "auto_selected") {
        state.selected[kind].set(candidate.id, candidate.name);
      }
    }
  }
}

function renderVideo() {
  if (!state.resource) return;
  elements.video.hidden = false;
  elements.videoTitle.textContent = state.resource.title ?? "(untitled)";

  // Name the kind of thing when the creator would otherwise be redundant or
  // missing: a channel's creator IS its title, and a repo's owner is already
  // in its full name.
  const kindLabels = {
    youtube_channel: "YouTube channel",
    github_repo: "GitHub repository",
    research_paper: "Research paper",
    website: "Web page",
    article: "Article"
  };

  const creator = state.resource.creator ?? "";
  const kind = kindLabels[state.resource.sourceType];
  elements.videoCreator.textContent =
    state.resource.sourceType === "youtube_channel" || !creator
      ? (kind ?? "")
      : kind && kind !== "Web page" && kind !== "Article"
        ? `${creator} · ${kind}`
        : creator;

  const summary = state.understanding?.summary;
  elements.videoSummary.hidden = !summary;
  elements.videoSummary.textContent = summary ?? "";
}

// Why Saved is human-owned and required: it is the one field neither code nor
// a model can supply, and it is the reason the resource is worth keeping.
function updateSaveState() {
  const hasWhy = Boolean(elements.whySaved.value.trim());
  const ready = Boolean(state.classification) && hasWhy;

  elements.save.disabled = !ready;
  elements.whyRequired.textContent = hasWhy ? "" : "required";
  elements.whyRequired.className = `why__required${
    hasWhy ? "" : " why__required--unmet"
  }`;
}

function renderAll() {
  for (const kind of kinds) renderGroup(kind);
}

function renderGroup(kind) {
  const list = document.querySelector(`[data-list="${kind}"]`);
  const selected = state.selected[kind];
  const suggestions = state.classification?.[kind] ?? [];

  const rows = [];

  for (const [id, name] of selected) {
    const candidate = suggestions.find((item) => item.id === id);
    rows.push(buildRow(kind, { id, name, reason: candidate?.reason }, true));
  }

  for (const candidate of suggestions) {
    if (selected.has(candidate.id)) continue;
    rows.push(buildRow(kind, candidate, false));
  }

  // Proposed categories that don't exist yet. Never a checkbox: there is
  // nothing to select until the user creates it in Notion.
  for (const proposal of proposalsFor(kind)) {
    rows.push(buildProposalRow(kind, proposal));
  }

  if (rows.length === 0) {
    const empty = document.createElement("li");
    empty.className = "row row--empty";
    empty.textContent = "None";
    rows.push(empty);
  }

  list.replaceChildren(...rows);
}

function proposalsFor(kind) {
  const proposals = state.classification?.proposals;
  if (!proposals) return [];

  const pool = kind === "areas" ? proposals.areas : kind === "topics" ? proposals.topics : [];
  // Drop anything that now exists - the user may have just created it, or an
  // earlier proposal may have been accepted this session.
  return (pool ?? []).filter((proposal) => !findExisting(kind, proposal.name));
}

function buildProposalRow(kind, proposal) {
  const row = document.createElement("li");
  row.className = "row row--proposal";
  if (proposal.reason) row.title = proposal.reason;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "create create--inline";
  button.replaceChildren(
    Object.assign(document.createElement("span"), {
      className: "create__plus",
      textContent: "+"
    }),
    Object.assign(document.createElement("span"), {
      className: "create__name",
      textContent: proposal.name
    }),
    Object.assign(document.createElement("span"), {
      className: "create__tag",
      textContent: "new"
    })
  );
  button.onclick = () => createEntity(kind, proposal.name, button);

  row.append(button);
  return row;
}

function buildRow(kind, candidate, isSelected) {
  const row = document.createElement("li");
  row.className = "row";

  const label = document.createElement("label");
  label.className = "row__label";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = isSelected;
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) {
      state.selected[kind].set(candidate.id, candidate.name);
    } else {
      state.selected[kind].delete(candidate.id);
    }
    renderGroup(kind);
  });

  const name = document.createElement("span");
  name.className = "row__name";
  name.textContent = candidate.name;

  label.append(checkbox, name);
  row.append(label);
  if (candidate.reason) row.title = candidate.reason;

  // Only unselected suggestions carry a score: that is the one case where the
  // number helps the user decide. On a checked row it is redundant.
  if (!isSelected && typeof candidate.confidence === "number") {
    const score = document.createElement("span");
    score.className = "row__score";
    score.textContent = candidate.confidence.toFixed(2);
    row.append(score);
  }

  return row;
}

function revealAdder(kind) {
  const picker = document.querySelector(`[data-picker="${kind}"]`);
  const input = document.querySelector(`[data-input="${kind}"]`);

  picker.hidden = false;
  input.value = "";
  // Show the full list straight away. The common case is picking something
  // that exists, and that shouldn't require typing first.
  renderPickerOptions(kind);
  input.focus();
}

function hideAdder(kind) {
  const picker = document.querySelector(`[data-picker="${kind}"]`);
  document.querySelector(`[data-input="${kind}"]`).value = "";
  picker.hidden = true;
}

// The options list: everything not already selected, filtered by what's typed,
// plus a create row when the typed name doesn't exist.
function renderPickerOptions(kind) {
  const input = document.querySelector(`[data-input="${kind}"]`);
  const list = document.querySelector(`[data-options="${kind}"]`);
  const typed = input.value.trim().toLowerCase();

  const matches = (state.taxonomy[kind] ?? [])
    .filter((entity) => !state.selected[kind].has(entity.id))
    .filter((entity) => entity.name.toLowerCase().includes(typed));

  const rows = matches.map((entity) => {
    const item = document.createElement("li");
    const option = document.createElement("button");
    option.type = "button";
    option.className = "picker__option";
    option.textContent = entity.name;
    option.onclick = () => {
      state.selected[kind].set(entity.id, entity.name);
      hideAdder(kind);
      renderGroup(kind);
      showStatus("");
    };
    item.append(option);
    return item;
  });

  const exact = input.value.trim() && findExisting(kind, input.value.trim());
  if (input.value.trim() && !exact) {
    const item = document.createElement("li");
    const create = document.createElement("button");
    create.type = "button";
    create.className = "picker__option picker__option--create";
    create.replaceChildren(
      Object.assign(document.createElement("span"), {
        className: "create__plus",
        textContent: "+"
      }),
      Object.assign(document.createElement("span"), {
        className: "create__name",
        textContent: `Create ${labelFor(kind)} "${input.value.trim()}"`
      })
    );
    create.onclick = () => createEntity(kind, input.value.trim(), create);
    item.append(create);
    rows.push(item);
  }

  if (rows.length === 0) {
    const empty = document.createElement("li");
    empty.className = "picker__empty";
    empty.textContent = "Nothing left to add";
    rows.push(empty);
  }

  list.replaceChildren(...rows);
}

function findExisting(kind, typed) {
  return (state.taxonomy[kind] ?? []).find(
    (entity) => entity.name.toLowerCase() === typed.trim().toLowerCase()
  );
}

async function createEntity(kind, name, button) {
  button.disabled = true;
  button.querySelector(".create__name").textContent = `Creating "${name}"…`;

  try {
    const created = await postJson("/api/taxonomy/create", {
      entityType: singularFor(kind),
      name
    });

    // Add to the local taxonomy so it's immediately selectable without
    // needing to re-analyze.
    state.taxonomy[kind] = [...(state.taxonomy[kind] ?? []), { id: created.id, name: created.name }];
    state.selected[kind].set(created.id, created.name);

    // Once created it exists, so proposalsFor() will filter it out and the row
    // re-renders as a normal selected entity.
    hideAdder(kind);
    renderGroup(kind);
    showStatus(created.created ? `Created ${labelFor(kind)} "${created.name}".` : "");
  } catch (error) {
    showStatus(error.message, true);
    button.disabled = false;
  }
}

function labelFor(kind) {
  return { areas: "Area", projects: "Project", topics: "Topic" }[kind];
}

function singularFor(kind) {
  return { areas: "area", projects: "project", topics: "topic" }[kind];
}

async function save() {
  if (!state.resource) return;

  elements.save.disabled = true;
  showStatus("Saving…");

  try {
    const result = await postJson("/api/resource/save", {
      resource: state.resource,
      classification: state.classification ?? { areas: [], projects: [], topics: [] },
      selection: {
        areaIds: [...state.selected.areas.keys()],
        projectIds: [...state.selected.projects.keys()],
        topicIds: [...state.selected.topics.keys()]
      },
      whySaved: elements.whySaved.value.trim(),
      summary: state.understanding?.summary
    });

    if (result.status === "duplicate") {
      showStatus("Already in your Second Brain.", true);
      return;
    }

    showStatus("Saved.");
    setTimeout(() => window.close(), 700);
  } catch (error) {
    showStatus(error.message, true);
    updateSaveState();
  }
}

// The session token identifies which Notion workspace the backend should use.
// It is opaque - the extension never holds a Notion token itself, so nothing
// here can reach Notion directly even if the popup is compromised.
async function readSessionToken() {
  const stored = await chrome.storage.local.get("sessionToken");
  return stored.sessionToken ?? undefined;
}

async function writeSessionToken(sessionToken) {
  await chrome.storage.local.set({ sessionToken });
  state.sessionToken = sessionToken;
}

async function authHeaders() {
  const sessionToken = state.sessionToken ?? (await readSessionToken());
  return sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {};
}

async function getJson(path) {
  const response = await fetch(`${apiBaseUrl}${path}`, { headers: await authHeaders() });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Request failed (${response.status}).`);
  }
  return payload;
}

async function postJson(path, body) {
  let response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify(body)
    });
  } catch {
    throw new Error("Can't reach the local server. Is `npm run server` running?");
  }

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Request failed (${response.status}).`);
  }

  return payload;
}

function showStatus(message, isError = false) {
  elements.status.hidden = !message;
  elements.status.textContent = message;
  elements.status.className = `status${isError ? " status--error" : ""}`;
}
