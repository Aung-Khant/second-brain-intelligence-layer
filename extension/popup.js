// Popup for the YouTube-only MVP. It extracts deterministic facts, asks the
// backend to analyze them, and lets the user correct the result before saving.
//
// It never creates new taxonomy - every Area, Project, and Topic offered here
// already exists in Notion. Notion credentials stay in the backend; this file
// only ever talks to the local API.
//
// Analysis starts automatically on open, so the common path is: open, glance,
// save. Selection state (auto_selected / suggested) is computed by the backend
// so the confidence thresholds live in exactly one place; this file renders
// what it is told and does not re-derive them.

const apiBaseUrl = "http://127.0.0.1:3737";

const state = {
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
  save: document.getElementById("save")
};

document.addEventListener("DOMContentLoaded", () => {
  elements.save.addEventListener("click", save);
  elements.whySaved.addEventListener("input", updateSaveState);

  for (const kind of kinds) {
    document
      .querySelector(`[data-reveal="${kind}"]`)
      .addEventListener("click", () => revealAdder(kind));

    const input = document.querySelector(`[data-input="${kind}"]`);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        addFromPicker(kind);
      }
      if (event.key === "Escape") hideAdder(kind);
    });
    input.addEventListener("input", () => renderCreateOffer(kind));
  }

  start();
});

async function start() {
  const captured = await capture();
  if (captured) await analyze();
}

async function capture() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab found.");

    const target = parseYouTubeTarget(tab.url ?? "");
    if (!target) {
      showStatus("Open a YouTube video or channel to save it.", true);
      return false;
    }

    // MAIN world: YouTube's own payload is a page global, invisible to an
    // isolated content script. Reading it beats scraping rendered DOM, which
    // changes shape with every YouTube redesign.
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: target.kind === "video" ? extractYouTubeVideo : extractYouTubeChannel
    });

    const extracted = result?.result;
    if (extracted?.stale) {
      showStatus("This page's data is out of date. Reload the page, then reopen.", true);
      return false;
    }

    if (!extracted?.sourceId) {
      showStatus(`Could not read this ${target.kind}. Let the page load and reopen.`, true);
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

// Mirrors shared/capture/youtube.ts. Kept in sync by hand - the extension has
// no build step and cannot import the TypeScript module.
function parseYouTubeTarget(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const path = parsed.pathname;
  const isYouTube = host === "youtube.com" || host.endsWith(".youtube.com");
  const video = (candidate) =>
    /^[A-Za-z0-9_-]{11}$/.test(candidate || "") ? { kind: "video", id: candidate } : null;

  if (host === "youtu.be") return video(path.slice(1).split("/")[0]);
  if (!isYouTube) return null;
  if (path === "/watch") return video(parsed.searchParams.get("v"));

  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  const [first, second] = segments;
  if (first === "shorts" || first === "live") return second ? video(second) : null;
  if (first.startsWith("@") && first.length > 1) return { kind: "channel", id: first };
  if ((first === "channel" || first === "c" || first === "user") && second) {
    return { kind: "channel", id: second };
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
    renderOptions();
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

  // For a channel the creator IS the title, so repeating it is noise.
  const isChannel = state.resource.sourceType === "youtube_channel";
  elements.videoCreator.textContent = isChannel
    ? "YouTube channel"
    : (state.resource.creator ?? "");

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

function renderOptions() {
  const ids = { areas: "area-options", projects: "project-options", topics: "topic-options" };

  for (const kind of kinds) {
    document.getElementById(ids[kind]).replaceChildren(
      ...(state.taxonomy[kind] ?? []).map((entity) => {
        const option = document.createElement("option");
        option.value = entity.name;
        return option;
      })
    );
  }
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

  if (rows.length === 0) {
    const empty = document.createElement("li");
    empty.className = "row row--empty";
    empty.textContent = "None";
    rows.push(empty);
  }

  list.replaceChildren(...rows);
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
  const input = document.querySelector(`[data-input="${kind}"]`);
  input.hidden = false;
  input.focus();
}

function hideAdder(kind) {
  const input = document.querySelector(`[data-input="${kind}"]`);
  input.value = "";
  input.hidden = true;
  renderCreateOffer(kind);
}

function findExisting(kind, typed) {
  return (state.taxonomy[kind] ?? []).find(
    (entity) => entity.name.toLowerCase() === typed.trim().toLowerCase()
  );
}

function addFromPicker(kind) {
  const input = document.querySelector(`[data-input="${kind}"]`);
  const typed = input.value.trim();
  if (!typed) return;

  const match = findExisting(kind, typed);
  if (!match) {
    // Don't create on Enter. Surface the option and let the user commit to it
    // deliberately - new taxonomy should never appear by reflex.
    renderCreateOffer(kind);
    return;
  }

  state.selected[kind].set(match.id, match.name);
  hideAdder(kind);
  renderGroup(kind);
  showStatus("");
}

// Shows a "Create X" button under the input whenever the typed text names
// something that doesn't exist yet.
function renderCreateOffer(kind) {
  const input = document.querySelector(`[data-input="${kind}"]`);
  const group = document.querySelector(`[data-kind="${kind}"]`);
  const existingButton = group.querySelector(".create");
  const typed = input.hidden ? "" : input.value.trim();

  if (!typed || findExisting(kind, typed)) {
    existingButton?.remove();
    return;
  }

  const button = existingButton ?? document.createElement("button");
  button.className = "create";
  button.type = "button";
  button.disabled = false;
  button.replaceChildren(
    Object.assign(document.createElement("span"), {
      className: "create__plus",
      textContent: "+"
    }),
    Object.assign(document.createElement("span"), {
      className: "create__name",
      textContent: `Create ${labelFor(kind)} "${typed}"`
    })
  );
  button.onclick = () => createEntity(kind, typed, button);

  if (!existingButton) input.insertAdjacentElement("afterend", button);
}

async function createEntity(kind, name, button) {
  button.disabled = true;
  button.querySelector(".create__name").textContent = `Creating "${name}"…`;

  try {
    const created = await postJson("/api/taxonomy/create", {
      entityType: singularFor(kind),
      name
    });

    // Add to the local taxonomy so it's immediately selectable and shows up in
    // the datalist without needing to re-analyze.
    state.taxonomy[kind] = [...(state.taxonomy[kind] ?? []), { id: created.id, name: created.name }];
    state.selected[kind].set(created.id, created.name);

    hideAdder(kind);
    renderOptions();
    renderGroup(kind);
    showStatus(created.created ? `Created ${labelFor(kind)} "${created.name}".` : "");
  } catch (error) {
    showStatus(error.message, true);
    button.disabled = false;
    renderCreateOffer(kind);
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

async function postJson(path, body) {
  let response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
