const apiBaseUrl = "http://127.0.0.1:3737";

const state = {
  page: null,
  classification: null,
  taxonomy: null
};

const elements = {
  pageHost: document.querySelector("#pageHost"),
  serverState: document.querySelector("#serverState"),
  resourceTitle: document.querySelector("#resourceTitle"),
  resourceUrl: document.querySelector("#resourceUrl"),
  resourceType: document.querySelector("#resourceType"),
  classifyButton: document.querySelector("#classifyButton"),
  enhanceButton: document.querySelector("#enhanceButton"),
  saveButton: document.querySelector("#saveButton"),
  status: document.querySelector("#status"),
  summarySection: document.querySelector("#summarySection"),
  engineBadge: document.querySelector("#engineBadge"),
  summary: document.querySelector("#summary"),
  relationsSection: document.querySelector("#relationsSection"),
  saveIntent: document.querySelector("#saveIntent"),
  whySaved: document.querySelector("#whySaved"),
  areasList: document.querySelector("#areasList"),
  areaPicker: document.querySelector("#areaPicker"),
  addAreaButton: document.querySelector("#addAreaButton"),
  topicsList: document.querySelector("#topicsList"),
  topicPicker: document.querySelector("#topicPicker"),
  addTopicButton: document.querySelector("#addTopicButton"),
  newTopicsGroup: document.querySelector("#newTopicsGroup"),
  newTopicsList: document.querySelector("#newTopicsList"),
  projectsList: document.querySelector("#projectsList"),
  projectPicker: document.querySelector("#projectPicker"),
  addProjectButton: document.querySelector("#addProjectButton")
};

document.addEventListener("DOMContentLoaded", async () => {
  await hydrateCurrentPage();
  elements.classifyButton.addEventListener("click", classifyCurrentPage);
  elements.enhanceButton.addEventListener("click", enhanceCurrentPage);
  elements.saveButton.addEventListener("click", saveCurrentPage);
  elements.addAreaButton.addEventListener("click", () => addPickedRelation("areas"));
  elements.addTopicButton.addEventListener("click", () => addPickedRelation("topics"));
  elements.addProjectButton.addEventListener("click", () => addPickedRelation("projects"));
  checkServer();
  loadTaxonomyPickers();
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
    elements.resourceType.value = resourceTypeLabel(inferResourceType(state.page.url));
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

async function loadTaxonomyPickers() {
  setPickerLoading(true);

  try {
    const response = await postJson("/api/taxonomy", undefined, "GET");
    state.taxonomy = response.taxonomy;
    renderPicker(elements.areaPicker, state.taxonomy.areas, "Choose Area");
    renderPicker(elements.topicPicker, state.taxonomy.topics, "Choose Topic");
    renderPicker(
      elements.projectPicker,
      state.taxonomy.projects.filter((project) => (project.status ?? "active") === "active"),
      "Choose Project"
    );
  } catch (error) {
    setStatus(`Could not load manual pickers: ${error.message}`, true);
  } finally {
    setPickerLoading(false);
  }
}

function setPickerLoading(isLoading) {
  for (const element of [
    elements.areaPicker,
    elements.topicPicker,
    elements.projectPicker,
    elements.addAreaButton,
    elements.addTopicButton,
    elements.addProjectButton
  ]) {
    element.disabled = isLoading;
  }
}

function renderPicker(select, items, placeholder) {
  select.replaceChildren();

  const option = document.createElement("option");
  option.value = "";
  option.textContent = placeholder;
  select.append(option);

  for (const item of [...items].sort((a, b) => a.name.localeCompare(b.name))) {
    const itemOption = document.createElement("option");
    itemOption.value = item.id;
    itemOption.textContent = item.name;
    select.append(itemOption);
  }
}

async function classifyCurrentPage() {
  setBusy(true);
  setStatus("Matching with your Notion taxonomy...");

  try {
    const resource = buildTrustedResource();
    const response = await postJson("/api/classify", { resource });
    state.classification = response.classification;
    renderClassification(response.classification);
    elements.enhanceButton.disabled = false;
    elements.saveButton.disabled = false;
    setStatus("Fast local match ready. Use AI Enhance only if needed.");
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function enhanceCurrentPage() {
  setBusy(true);
  setStatus("Enhancing with AI...");

  try {
    const resource = buildTrustedResource();
    const response = await postJson("/api/enhance", { resource });
    state.classification = mergePreservingManualSelections(response.classification);
    renderClassification(state.classification);
    elements.saveButton.disabled = false;
    setStatus(
      response.fallback
        ? "AI was unavailable, so local matching was used."
        : "AI enhanced. Review, then save."
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
  const url = elements.resourceUrl.value.trim();
  const type = inferResourceType(url);
  elements.resourceType.value = resourceTypeLabel(type);

  return {
    url,
    type,
    title: elements.resourceTitle.value.trim(),
    description: state.page?.description ?? "",
    visibleText: state.page?.visibleText ?? ""
  };
}

function buildConfirmedResource() {
  const type = inferResourceType(elements.resourceUrl.value);
  elements.resourceType.value = resourceTypeLabel(type);

  return {
    name: elements.resourceTitle.value.trim(),
    url: elements.resourceUrl.value.trim(),
    resourceType: type,
    summary: state.classification.summary,
    areaIds: selectedIds("areas"),
    topicIds: selectedIds("topics"),
    projectIds: selectedIds("projects"),
    saveIntent: elements.saveIntent.value,
    whySaved: elements.whySaved.value.trim() || undefined
  };
}

function mergePreservingManualSelections(nextClassification) {
  if (!state.classification) return nextClassification;

  return {
    ...nextClassification,
    areas: preserveSelectedRelations(nextClassification.areas, "areas"),
    topics: preserveSelectedRelations(nextClassification.topics, "topics"),
    projects: preserveSelectedRelations(nextClassification.projects, "projects")
  };
}

function preserveSelectedRelations(nextRelations, kind) {
  const selected = new Set(selectedIds(kind));
  const preserved = nextRelations.map((relation) =>
    selected.has(relation.entityId) ? { ...relation, state: "preselected" } : relation
  );

  for (const relation of state.classification?.[kind] ?? []) {
    if (selected.has(relation.entityId) && !preserved.some((item) => item.entityId === relation.entityId)) {
      preserved.push({ ...relation, state: "preselected" });
    }
  }

  return preserved.sort(
    (a, b) => b.confidence - a.confidence || a.entityName.localeCompare(b.entityName)
  );
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

function addPickedRelation(kind) {
  ensureClassification();

  const selectByKind = {
    areas: elements.areaPicker,
    topics: elements.topicPicker,
    projects: elements.projectPicker
  };

  const collectionByKind = {
    areas: state.taxonomy?.areas ?? [],
    topics: state.taxonomy?.topics ?? [],
    projects: state.taxonomy?.projects ?? []
  };

  const select = selectByKind[kind];
  const entity = collectionByKind[kind].find((item) => item.id === select.value);
  if (!entity) return;

  state.classification[kind] = upsertManualRelation(state.classification[kind], {
    entityId: entity.id,
    entityName: entity.name,
    confidence: 100,
    reason: "Manually selected from your Notion database.",
    state: "preselected"
  });

  renderRelations(listElementForKind(kind), kind, state.classification[kind]);
  select.value = "";
  setStatus(`${entity.name} selected.`);
}

function ensureClassification() {
  if (state.classification) return;

  state.classification = {
    engine: "local",
    summary: elements.resourceTitle.value.trim(),
    concepts: [],
    keywords: [],
    subjectMatter: [],
    areas: [],
    topics: [],
    projects: [],
    suggestedTopics: []
  };
  renderClassification(state.classification);
  elements.enhanceButton.disabled = false;
  elements.saveButton.disabled = false;
}

function upsertManualRelation(relations, relation) {
  const existing = relations.find((item) => item.entityId === relation.entityId);
  if (existing) {
    return relations.map((item) =>
      item.entityId === relation.entityId ? { ...item, state: "preselected" } : item
    );
  }

  return [...relations, relation].sort(
    (a, b) => b.confidence - a.confidence || a.entityName.localeCompare(b.entityName)
  );
}

function listElementForKind(kind) {
  return {
    areas: elements.areasList,
    topics: elements.topicsList,
    projects: elements.projectsList
  }[kind];
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
    const createStatus = document.createElement("span");
    createStatus.className = "inlineStatus";
    createButton.addEventListener("click", () =>
      createSuggestedTopic(suggestion, createButton, createStatus)
    );
    item.append(createButton);
    item.append(createStatus);

    elements.newTopicsList.append(item);
  }
}

async function createSuggestedTopic(suggestion, button, inlineStatus) {
  button.disabled = true;
  const previousText = button.textContent;
  button.textContent = "Creating...";
  inlineStatus.textContent = "Creating in Notion...";
  inlineStatus.dataset.state = "working";
  setStatus(`Creating Topic: ${suggestion.name}`);

  try {
    const response = await postJson("/api/topics", {
      name: suggestion.name,
      areaId: suggestion.areaId,
      areaName: suggestion.areaName
    });

    addCreatedTopic(response.topic);
    button.textContent = "Created";
    inlineStatus.textContent = "Created and selected.";
    inlineStatus.dataset.state = "success";
    setStatus("Topic created and selected.");
  } catch (error) {
    button.disabled = false;
    button.textContent = previousText;
    inlineStatus.textContent = error.message;
    inlineStatus.dataset.state = "error";
    setStatus(error.message, true);
  }
}

function addCreatedTopic(topic) {
  if (!state.classification) {
    state.classification = emptyClassification();
  }

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

async function postJson(path, body, method = "POST") {
  let response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json"
      },
      body: method === "GET" ? undefined : JSON.stringify(body)
    });
  } catch {
    throw new Error("Local server is offline. Run npm run server, then reload the extension.");
  }

  const payload = await response.json().catch(() => undefined);
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
  elements.enhanceButton.disabled = isBusy || !state.classification;
  elements.saveButton.disabled = isBusy || !state.classification;
}

function setStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.style.color = isError ? "#b91c1c" : "#64748b";
}

function resourceTypeLabel(type) {
  switch (type) {
    case "youtube_channel":
      return "YouTube Channel";
    case "youtube_video":
      return "YouTube Video";
    case "article":
      return "Article";
    default:
      return "Webpage";
  }
}
