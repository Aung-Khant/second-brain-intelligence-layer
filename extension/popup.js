const apiBaseUrl = "http://127.0.0.1:3737";

const state = {
  page: null,
  classification: null
};

const elements = {
  pageHost: document.querySelector("#pageHost"),
  serverState: document.querySelector("#serverState"),
  resourceTitle: document.querySelector("#resourceTitle"),
  resourceUrl: document.querySelector("#resourceUrl"),
  classifyButton: document.querySelector("#classifyButton"),
  saveButton: document.querySelector("#saveButton"),
  status: document.querySelector("#status"),
  summarySection: document.querySelector("#summarySection"),
  engineBadge: document.querySelector("#engineBadge"),
  summary: document.querySelector("#summary"),
  relationsSection: document.querySelector("#relationsSection"),
  saveIntent: document.querySelector("#saveIntent"),
  whySaved: document.querySelector("#whySaved"),
  areasList: document.querySelector("#areasList"),
  topicsList: document.querySelector("#topicsList"),
  newTopicsGroup: document.querySelector("#newTopicsGroup"),
  newTopicsList: document.querySelector("#newTopicsList"),
  projectsList: document.querySelector("#projectsList")
};

document.addEventListener("DOMContentLoaded", async () => {
  await hydrateCurrentPage();
  elements.classifyButton.addEventListener("click", classifyCurrentPage);
  elements.saveButton.addEventListener("click", saveCurrentPage);
  checkServer();
});

async function hydrateCurrentPage() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab found.");

    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPage
    });

    state.page = {
      ...(result?.result ?? {}),
      title: result?.result?.title || tab.title || "",
      url: result?.result?.url || tab.url || ""
    };

    elements.resourceTitle.value = state.page.title;
    elements.resourceUrl.value = state.page.url;
    elements.pageHost.textContent = hostFromUrl(state.page.url);
  } catch (error) {
    setStatus(error.message, true);
  }
}

function extractPage() {
  const description =
    document.querySelector('meta[name="description"]')?.content ||
    document.querySelector('meta[property="og:description"]')?.content ||
    "";

  return {
    title: document.title,
    url: location.href,
    description,
    visibleText: document.body?.innerText?.slice(0, 4000) ?? ""
  };
}

async function checkServer() {
  try {
    const response = await fetch(`${apiBaseUrl}/health`);
    elements.serverState.textContent = response.ok ? "Online" : "Offline";
  } catch {
    elements.serverState.textContent = "Offline";
  }
}

async function classifyCurrentPage() {
  setBusy(true);
  setStatus("Classifying with your Notion taxonomy...");

  try {
    const resource = buildTrustedResource();
    const response = await postJson("/api/classify", { resource });
    state.classification = response.classification;
    renderClassification(response.classification);
    elements.saveButton.disabled = false;
    setStatus(
      response.fallback
        ? "AI was unavailable, so local matching was used."
        : "Review the matches, then save."
    );
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function saveCurrentPage() {
  if (!state.classification) return;

  setBusy(true);
  setStatus("Saving to Notion...");

  try {
    const resource = buildConfirmedResource();
    const response = await postJson("/api/save", {
      resource,
      aiSuggestion: {
        areas: state.classification.areas.map((item) => item.entityId),
        topics: state.classification.topics.map((item) => item.entityId),
        projects: state.classification.projects.map((item) => item.entityId),
        model: state.classification.engine
      },
      confirmWrite: true
    });

    if (response.status === "duplicate") {
      setStatus("Already saved in Notion.");
    } else {
      setStatus("Saved to Notion.");
    }
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setBusy(false);
  }
}

function buildTrustedResource() {
  return {
    url: elements.resourceUrl.value.trim(),
    type: inferResourceType(elements.resourceUrl.value),
    title: elements.resourceTitle.value.trim(),
    description: state.page?.description ?? "",
    visibleText: state.page?.visibleText ?? ""
  };
}

function buildConfirmedResource() {
  return {
    name: elements.resourceTitle.value.trim(),
    url: elements.resourceUrl.value.trim(),
    resourceType: inferResourceType(elements.resourceUrl.value),
    summary: state.classification.summary,
    areaIds: selectedIds("areas"),
    topicIds: selectedIds("topics"),
    projectIds: selectedIds("projects"),
    saveIntent: elements.saveIntent.value,
    whySaved: elements.whySaved.value.trim() || undefined
  };
}

function selectedIds(kind) {
  return Array.from(document.querySelectorAll(`input[data-kind="${kind}"]:checked`)).map(
    (input) => input.value
  );
}

function renderClassification(classification) {
  elements.summary.textContent = classification.summary;
  elements.engineBadge.textContent = classification.engine === "local" ? "Local" : "AI";
  elements.summarySection.hidden = false;
  elements.relationsSection.hidden = false;

  if (classification.suggestedSaveIntent) {
    elements.saveIntent.value = classification.suggestedSaveIntent;
  }

  if (classification.suggestedWhySaved) {
    elements.whySaved.value = classification.suggestedWhySaved;
  }

  renderRelations(elements.areasList, "areas", classification.areas);
  renderRelations(elements.topicsList, "topics", classification.topics);
  renderSuggestedTopics(classification.suggestedTopics ?? []);
  renderRelations(elements.projectsList, "projects", classification.projects);
}

function renderRelations(container, kind, relations) {
  container.replaceChildren();

  if (relations.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No match";
    container.append(empty);
    return;
  }

  for (const relation of relations) {
    const label = document.createElement("label");
    label.className = "relationItem";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = relation.entityId;
    checkbox.dataset.kind = kind;
    checkbox.checked = relation.state === "preselected";

    const name = document.createElement("span");
    name.className = "relationName";
    name.textContent = relation.entityName;

    const confidence = document.createElement("span");
    confidence.className = "confidence";
    confidence.textContent = `${Math.round(relation.confidence)}%`;

    const reason = document.createElement("span");
    reason.className = "relationReason";
    reason.textContent = relation.reason;

    label.append(checkbox, name, confidence, reason);
    container.append(label);
  }
}

function renderSuggestedTopics(suggestedTopics) {
  elements.newTopicsList.replaceChildren();
  elements.newTopicsGroup.hidden = suggestedTopics.length === 0;

  for (const suggestion of suggestedTopics) {
    const item = document.createElement("div");
    item.className = "topicSuggestion";

    const header = document.createElement("div");
    header.className = "topicSuggestionHeader";

    const name = document.createElement("span");
    name.className = "relationName";
    name.textContent = suggestion.name;

    const confidence = document.createElement("span");
    confidence.className = "confidence";
    confidence.textContent = `${Math.round(suggestion.confidence)}%`;

    header.append(name, confidence);
    item.append(header);

    if (suggestion.areaName) {
      const area = document.createElement("span");
      area.className = "topicArea";
      area.textContent = suggestion.areaName;
      item.append(area);
    }

    const reason = document.createElement("span");
    reason.className = "relationReason";
    reason.textContent = suggestion.reason;
    item.append(reason);

    const createButton = document.createElement("button");
    createButton.type = "button";
    createButton.className = "smallButton";
    createButton.textContent = "Create Topic";
    createButton.addEventListener("click", () => createSuggestedTopic(suggestion, createButton));
    item.append(createButton);

    elements.newTopicsList.append(item);
  }
}

async function createSuggestedTopic(suggestion, button) {
  button.disabled = true;
  const previousText = button.textContent;
  button.textContent = "Creating...";
  setStatus(`Creating Topic: ${suggestion.name}`);

  try {
    const response = await postJson("/api/topics", {
      name: suggestion.name,
      areaId: suggestion.areaId,
      areaName: suggestion.areaName,
      reason: suggestion.reason
    });

    addCreatedTopic(response.topic);
    button.textContent = "Created";
    setStatus("Topic created and selected.");
  } catch (error) {
    button.disabled = false;
    button.textContent = previousText;
    setStatus(error.message, true);
  }
}

function addCreatedTopic(topic) {
  const existingTopics = state.classification?.topics ?? [];
  if (existingTopics.some((item) => item.entityId === topic.id)) return;

  const relation = {
    entityId: topic.id,
    entityName: topic.name,
    confidence: 100,
    reason: topic.areaName
      ? `Created from AI suggestion under ${topic.areaName}.`
      : "Created from AI suggestion.",
    state: "preselected"
  };

  state.classification.topics = [...existingTopics, relation];
  renderRelations(elements.topicsList, "topics", state.classification.topics);
}

async function postJson(path, body) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? "Request failed.");
  }

  return payload;
}

function inferResourceType(url) {
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

function hostFromUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "Ready";
  }
}

function setBusy(isBusy) {
  elements.classifyButton.disabled = isBusy;
  elements.saveButton.disabled = isBusy || !state.classification;
}

function setStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.style.color = isError ? "#b91c1c" : "#64748b";
}
