// Popup for the YouTube-only MVP. It extracts deterministic facts, asks the
// backend to analyze them, and lets the user correct the result before saving.
//
// It never creates new taxonomy - every Area, Project, and Topic offered here
// already exists in Notion. Notion credentials stay in the backend; this file
// only ever talks to the local API.
//
// selection state (auto_selected / suggested / unselected) is computed by the
// backend so the confidence thresholds live in exactly one place. This file
// renders what it is told and does not re-derive them.

const apiBaseUrl = "http://127.0.0.1:3737";

const state = {
  resource: null,
  classification: null,
  taxonomy: { areas: [], projects: [], topics: [] },
  selected: { areas: new Map(), projects: new Map(), topics: new Map() }
};

const kinds = ["areas", "projects", "topics"];

const elements = {
  serverState: document.getElementById("server-state"),
  video: document.getElementById("video"),
  videoTitle: document.getElementById("video-title"),
  videoCreator: document.getElementById("video-creator"),
  status: document.getElementById("status"),
  results: document.getElementById("results"),
  whySaved: document.getElementById("why-saved"),
  analyze: document.getElementById("analyze"),
  save: document.getElementById("save")
};

document.addEventListener("DOMContentLoaded", () => {
  elements.analyze.addEventListener("click", analyze);
  elements.save.addEventListener("click", save);

  for (const kind of kinds) {
    document
      .querySelector(`[data-add="${kind}"]`)
      .addEventListener("click", () => addFromPicker(kind));
    document
      .querySelector(`[data-input="${kind}"]`)
      .addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          addFromPicker(kind);
        }
      });
  }

  checkServer();
  capture();
});

async function checkServer() {
  try {
    const response = await fetch(`${apiBaseUrl}/health`);
    setServerState(response.ok ? "Ready" : "Offline", response.ok);
  } catch {
    setServerState("Offline", false);
  }
}

async function capture() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab found.");

    const videoId = parseYouTubeVideoId(tab.url ?? "");
    if (!videoId) {
      showStatus("Open a YouTube video to save it.", true);
      elements.analyze.disabled = true;
      return;
    }

    // MAIN world: YouTube's own player payload is a page global, invisible to
    // an isolated content script. Reading it beats scraping rendered DOM,
    // which changes shape with every YouTube redesign.
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: extractYouTubeVideo
    });

    const extracted = result?.result;
    if (!extracted?.sourceId) {
      showStatus("Could not read this video. Let the page finish loading and reopen.", true);
      elements.analyze.disabled = true;
      return;
    }

    state.resource = { ...extracted, url: tab.url ?? extracted.url };
    renderVideo();
    showStatus("Ready to analyze.");
  } catch (error) {
    showStatus(error.message, true);
    elements.analyze.disabled = true;
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
    publishedAt:
      microformat?.publishDate || meta('meta[itemprop="datePublished"]') || null,
    thumbnailUrl: thumbnails?.[thumbnails.length - 1]?.url || meta('meta[property="og:image"]')
  };
}

// Mirrors shared/capture/youtube.ts. Kept in sync by hand - the extension has
// no build step and cannot import the TypeScript module.
function parseYouTubeVideoId(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const path = parsed.pathname;
  const valid = (candidate) => (/^[A-Za-z0-9_-]{11}$/.test(candidate || "") ? candidate : null);

  if (host === "youtu.be") return valid(path.slice(1).split("/")[0]);
  if (host !== "youtube.com" && !host.endsWith(".youtube.com")) return null;
  if (path === "/watch") return valid(parsed.searchParams.get("v"));

  const segments = path.split("/").filter(Boolean);
  if (segments.length >= 2 && (segments[0] === "shorts" || segments[0] === "live")) {
    return valid(segments[1]);
  }

  return null;
}

async function analyze() {
  if (!state.resource) return;

  setBusy(true);
  showStatus("Analyzing…");

  try {
    const response = await postJson("/api/resource/analyze", { resource: state.resource });

    state.resource = response.resource;
    state.classification = response.classification;
    state.taxonomy = response.taxonomy;

    seedSelection(response.classification);
    renderVideo();
    renderOptions();
    renderAll();

    elements.results.hidden = false;
    elements.save.disabled = false;
    showStatus(summarizeAnalysis(response.classification));
  } catch (error) {
    showStatus(error.message, true);
  } finally {
    setBusy(false);
  }
}

function summarizeAnalysis(classification) {
  const total =
    classification.areas.length + classification.projects.length + classification.topics.length;

  return total === 0
    ? "No confident matches. Add anything that fits, or save with none."
    : "Review the suggestions, then save.";
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
  elements.videoCreator.textContent = state.resource.creator ?? "";
}

function renderOptions() {
  const datalists = {
    areas: document.getElementById("area-options"),
    projects: document.getElementById("project-options"),
    topics: document.getElementById("topic-options")
  };

  for (const kind of kinds) {
    const entities = state.taxonomy[kind] ?? [];
    datalists[kind].replaceChildren(
      ...entities.map((entity) => {
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
  const suggestions = (state.classification?.[kind] ?? []).filter(
    (candidate) => candidate.state !== "unselected"
  );

  const rows = [];

  for (const [id, name] of selected) {
    const candidate = suggestions.find((item) => item.id === id);
    rows.push(buildRow(kind, { id, name, confidence: candidate?.confidence ?? null }, true));
  }

  for (const candidate of suggestions) {
    if (selected.has(candidate.id)) continue;
    rows.push(buildRow(kind, candidate, false));
  }

  if (rows.length === 0) {
    const empty = document.createElement("li");
    empty.className = "row row--empty";
    empty.textContent = "Nothing selected";
    rows.push(empty);
  }

  list.replaceChildren(...rows);
}

function buildRow(kind, candidate, isSelected) {
  const row = document.createElement("li");
  row.className = `row${isSelected ? " row--selected" : ""}`;

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

  if (typeof candidate.confidence === "number") {
    const score = document.createElement("span");
    score.className = "row__score";
    score.textContent = candidate.confidence.toFixed(2);
    if (candidate.reason) score.title = candidate.reason;
    row.append(score);
  } else {
    const added = document.createElement("span");
    added.className = "row__score row__score--manual";
    added.textContent = "added";
    row.append(added);
  }

  return row;
}

function addFromPicker(kind) {
  const input = document.querySelector(`[data-input="${kind}"]`);
  const typed = input.value.trim().toLowerCase();
  if (!typed) return;

  const match = (state.taxonomy[kind] ?? []).find(
    (entity) => entity.name.toLowerCase() === typed
  );

  if (!match) {
    showStatus(`"${input.value.trim()}" is not an existing ${labelFor(kind)}.`, true);
    return;
  }

  state.selected[kind].set(match.id, match.name);
  input.value = "";
  renderGroup(kind);
  showStatus("");
}

function labelFor(kind) {
  return { areas: "Area", projects: "Project", topics: "Topic" }[kind];
}

async function save() {
  if (!state.resource) return;

  setBusy(true);
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
      whySaved: elements.whySaved.value.trim() || undefined
    });

    if (result.status === "duplicate") {
      showStatus("Already in your Second Brain.", true);
      return;
    }

    showStatus("Saved to your Second Brain.");
    elements.save.disabled = true;
  } catch (error) {
    showStatus(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function postJson(path, body) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Request failed (${response.status}).`);
  }

  return payload;
}

function setServerState(text, isReady) {
  elements.serverState.textContent = text;
  elements.serverState.className = `pill ${isReady ? "pill--ready" : "pill--error"}`;
}

function setBusy(isBusy) {
  elements.analyze.disabled = isBusy;
  elements.save.disabled = isBusy || !state.classification;
}

function showStatus(message, isError = false) {
  elements.status.hidden = !message;
  elements.status.textContent = message;
  elements.status.className = `status${isError ? " status--error" : ""}`;
}
