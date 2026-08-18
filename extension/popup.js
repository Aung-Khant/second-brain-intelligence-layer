const apiBaseUrl = "http://127.0.0.1:3737";

const state = {
  page: null,
  classification: null,
  taxonomy: null,
  areaSelection: null,
  areaSkipped: false
};

const createNewAreaValue = "__create_new_area__";
const createNewTopicValue = "__create_new_topic__";

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
  areaSuggestionPanel: document.querySelector("#areaSuggestionPanel"),
  areaSuggestionEyebrow: document.querySelector("#areaSuggestionEyebrow"),
  areaSuggestionName: document.querySelector("#areaSuggestionName"),
  areaSuggestionConfidence: document.querySelector("#areaSuggestionConfidence"),
  areaSuggestionReason: document.querySelector("#areaSuggestionReason"),
  areaEmptyState: document.querySelector("#areaEmptyState"),
  acceptAreaSuggestionButton: document.querySelector("#acceptAreaSuggestionButton"),
  chooseAreaButton: document.querySelector("#chooseAreaButton"),
  showNewAreaButton: document.querySelector("#showNewAreaButton"),
  skipAreaButton: document.querySelector("#skipAreaButton"),
  areaManualGroup: document.querySelector("#areaManualGroup"),
  areasList: document.querySelector("#areasList"),
  areaPicker: document.querySelector("#areaPicker"),
  newAreaGroup: document.querySelector("#newAreaGroup"),
  newAreaName: document.querySelector("#newAreaName"),
  createAreaButton: document.querySelector("#createAreaButton"),
  topicsList: document.querySelector("#topicsList"),
  topicPicker: document.querySelector("#topicPicker"),
  newTopicGroup: document.querySelector("#newTopicGroup"),
  newTopicName: document.querySelector("#newTopicName"),
  createTopicButton: document.querySelector("#createTopicButton"),
  newTopicsGroup: document.querySelector("#newTopicsGroup"),
  newTopicsList: document.querySelector("#newTopicsList"),
  projectsList: document.querySelector("#projectsList"),
  projectPicker: document.querySelector("#projectPicker"),
};

document.addEventListener("DOMContentLoaded", async () => {
  await hydrateCurrentPage();
  elements.classifyButton.addEventListener("click", classifyCurrentPage);
  elements.enhanceButton.addEventListener("click", enhanceCurrentPage);
  elements.saveButton.addEventListener("click", saveCurrentPage);
  elements.acceptAreaSuggestionButton.addEventListener("click", acceptSuggestedArea);
  elements.chooseAreaButton.addEventListener("click", showManualAreaPicker);
  elements.showNewAreaButton.addEventListener("click", showNewAreaForm);
  elements.skipAreaButton.addEventListener("click", skipArea);
  elements.areaPicker.addEventListener("change", choosePickedArea);
  elements.createAreaButton.addEventListener("click", createNewArea);
  elements.topicPicker.addEventListener("change", () => addPickedRelation("topics"));
  elements.createTopicButton.addEventListener("click", createNewTopic);
  elements.projectPicker.addEventListener("change", () => addPickedRelation("projects"));
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
    renderPicker(elements.areaPicker, state.taxonomy.areas, "Choose Area", "+ New Area...", createNewAreaValue);
    renderPicker(elements.topicPicker, state.taxonomy.topics, "Choose Topic", "+ New Topic...", createNewTopicValue);
    renderPicker(
      elements.projectPicker,
      state.taxonomy.projects.filter((project) => (project.status ?? "active") === "active"),
      "Choose Project"
    );
  } catch (error) {
    state.taxonomy = null;
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
    elements.createTopicButton,
    elements.createAreaButton
  ]) {
    element.disabled = isLoading;
  }
}

function renderPicker(select, items, placeholder, createLabel, createValue) {
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

  if (createLabel && createValue) {
    const createOption = document.createElement("option");
    createOption.value = createValue;
    createOption.textContent = createLabel;
    select.append(createOption);
  }
}

async function classifyCurrentPage() {
  setBusy(true);
  setStatus("Matching with your Notion taxonomy...");

  try {
    const resource = buildTrustedResource();
    const response = await postJson("/api/classify", { resource });
    state.classification = response.classification;
    state.areaSelection = null;
    state.areaSkipped = false;
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
  const saveIntent = elements.saveIntent.value;
  if (!saveIntent) {
    elements.saveIntent.focus();
    throw new Error("Choose a Save Intent before saving to Notion.");
  }

  return {
    name: elements.resourceTitle.value.trim(),
    url: elements.resourceUrl.value.trim(),
    resourceType: type,
    summary: state.classification.summary,
    areaIds: selectedIds("areas"),
    topicIds: selectedIds("topics"),
    projectIds: selectedIds("projects"),
    saveIntent,
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
  if (kind === "areas") {
    return state.areaSelection ? [state.areaSelection.entityId] : [];
  }

  return Array.from(document.querySelectorAll(`input[data-kind="${kind}"]:checked`)).map(
    (input) => input.value
  );
}

function renderClassification(classification) {
  elements.summary.textContent = classification.summary;
  elements.engineBadge.textContent = classification.engine === "local" ? "Local" : "AI";
  elements.summarySection.hidden = false;
  elements.relationsSection.hidden = false;

  renderAreaFlow(classification);
  autoSelectPrimaryRelation(classification.topics);
  renderRelations(elements.topicsList, "topics", classification.topics);
  renderSuggestedTopics(classification.suggestedTopics ?? []);
  renderRelations(elements.projectsList, "projects", classification.projects);
}

function autoSelectPrimaryRelation(relations) {
  if (relations.length === 0 || relations.some((relation) => relation.state === "preselected")) {
    return;
  }

  relations.sort(
    (a, b) => b.confidence - a.confidence || a.entityName.localeCompare(b.entityName)
  )[0].state = "preselected";
}

function renderAreaFlow(classification) {
  const suggestion = areaSuggestion(classification);
  elements.areaSuggestionPanel.hidden = !suggestion;

  if (!state.areaSelection && !state.areaSkipped && suggestion?.kind === "existing") {
    state.areaSelection = {
      ...suggestion.relation,
      reason: "Auto-selected suggestion.",
      state: "preselected"
    };
  }

  if (suggestion) {
    const isSelectedSuggestion = isCurrentAreaSuggestion(suggestion);
    elements.areaSuggestionEyebrow.textContent =
      suggestion.kind === "existing"
        ? classification.engine === "local"
          ? "Suggested Area"
          : "AI Suggested Area"
        : "AI Suggested New Area";
    elements.acceptAreaSuggestionButton.textContent =
      suggestion.kind === "existing"
        ? isSelectedSuggestion
          ? "Selected"
          : "Accept suggestion"
        : "Create suggested Area";
    elements.acceptAreaSuggestionButton.disabled = isSelectedSuggestion;
    elements.areaSuggestionName.textContent = suggestion.name;
    elements.areaSuggestionConfidence.textContent = `${Math.round(suggestion.confidence)}%`;
    elements.areaSuggestionReason.textContent = suggestion.reason;
  } else {
    elements.areaSuggestionEyebrow.textContent = "Suggested Area";
    elements.acceptAreaSuggestionButton.textContent = "Accept suggestion";
    elements.acceptAreaSuggestionButton.disabled = true;
    elements.areaSuggestionName.textContent = "";
    elements.areaSuggestionConfidence.textContent = "";
    elements.areaSuggestionReason.textContent = "";
  }

  renderSelectedArea();
}

function isCurrentAreaSuggestion(suggestion) {
  return (
    suggestion.kind === "existing" &&
    state.areaSelection?.entityId === suggestion.id &&
    !state.areaSkipped
  );
}

function areaSuggestion(classification) {
  const existing = [...classification.areas].sort(
    (a, b) => b.confidence - a.confidence || a.entityName.localeCompare(b.entityName)
  )[0];
  if (existing) {
    return {
      kind: "existing",
      id: existing.entityId,
      name: existing.entityName,
      confidence: existing.confidence,
      reason: existing.reason,
      relation: existing
    };
  }

  const suggested = (classification.suggestedAreas ?? [])[0];
  if (!suggested) return undefined;

  return {
    kind: "new",
    name: suggested.name,
    confidence: suggested.confidence,
    reason: suggested.reason
  };
}

function renderSelectedArea() {
  elements.areasList.replaceChildren();

  if (!state.areaSelection) {
    elements.areaEmptyState.textContent = state.areaSkipped
      ? "Area skipped for this save."
      : "No Area selected yet.";
    elements.areaEmptyState.hidden = false;
    return;
  }

  elements.areaEmptyState.hidden = true;

  const item = document.createElement("div");
  item.className = "selectedAreaItem";

  const name = document.createElement("span");
  name.className = "relationName";
  name.textContent = state.areaSelection.entityName;

  const source = document.createElement("span");
  source.className = "selectedAreaSource";
  source.textContent = state.areaSelection.reason;

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "iconTextButton";
  removeButton.textContent = "Remove";
  removeButton.addEventListener("click", () => {
    state.areaSelection = null;
    state.areaSkipped = false;
    renderSelectedArea();
    setStatus("Area removed.");
  });

  item.append(name, source, removeButton);
  elements.areasList.append(item);
}

function acceptSuggestedArea() {
  ensureClassification();
  const suggestion = areaSuggestion(state.classification);
  if (!suggestion) {
    setStatus("No Area suggestion is available yet.", true);
    return;
  }

  if (suggestion.kind === "new") {
    createSuggestedArea(suggestion);
    return;
  }

  selectArea({
    ...suggestion.relation,
    reason: "Accepted AI suggestion.",
    state: "preselected"
  });
  setStatus(`${suggestion.name} selected.`);
}

function showManualAreaPicker() {
  elements.areaManualGroup.hidden = false;
  elements.newAreaGroup.hidden = true;
  elements.areaPicker.focus();
}

function showNewAreaForm() {
  elements.newAreaGroup.hidden = false;
  elements.areaManualGroup.hidden = true;
  elements.newAreaName.focus();
}

function skipArea() {
  ensureClassification();
  state.areaSelection = null;
  state.areaSkipped = true;
  renderSelectedArea();
  setStatus("Area skipped. This item can still be saved.");
}

async function choosePickedArea() {
  ensureClassification();

  if (!state.taxonomy) {
    setStatus("Loading your Notion Areas...");
    await loadTaxonomyPickers();
  }

  if (!state.taxonomy) {
    setStatus("Could not choose an Area because your Notion lists are not loaded.", true);
    return;
  }

  if (!elements.areaPicker.value) {
    return;
  }

  if (elements.areaPicker.value === createNewAreaValue) {
    showNewAreaForm();
    elements.areaPicker.value = "";
    return;
  }

  const area = state.taxonomy.areas.find((item) => item.id === elements.areaPicker.value);
  if (!area) {
    setStatus("That Area is not available anymore. Reload the extension and try again.", true);
    return;
  }

  selectArea({
    entityId: area.id,
    entityName: area.name,
    confidence: 100,
    reason: "Chosen from your Notion Areas.",
    state: "preselected"
  });
  elements.areaPicker.value = "";
  setStatus(`${area.name} selected.`);
}

async function createNewArea() {
  ensureClassification();
  const name = elements.newAreaName.value.trim();
  if (!name) {
    setStatus("Enter a name for the new Area.", true);
    return;
  }

  elements.createAreaButton.disabled = true;
  elements.createAreaButton.textContent = "Creating...";
  setStatus(`Creating Area: ${name}`);

  try {
    const response = await postJson("/api/areas", { name });
    const area = response.area;
    addAreaToTaxonomy(area);
    selectArea({
      entityId: area.id,
      entityName: area.name,
      confidence: 100,
      reason: "Created as a new Notion Area.",
      state: "preselected"
    });
    elements.newAreaName.value = "";
    elements.newAreaGroup.hidden = true;
    setStatus(`${area.name} created and selected.`);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    elements.createAreaButton.disabled = false;
    elements.createAreaButton.textContent = "Create";
  }
}

async function createSuggestedArea(suggestion) {
  elements.acceptAreaSuggestionButton.disabled = true;
  elements.acceptAreaSuggestionButton.textContent = "Creating...";
  setStatus(`Creating Area: ${suggestion.name}`);

  try {
    const response = await postJson("/api/areas", { name: suggestion.name });
    const area = response.area;
    addAreaToTaxonomy(area);
    selectArea({
      entityId: area.id,
      entityName: area.name,
      confidence: 100,
      reason: "Created from AI Area suggestion.",
      state: "preselected"
    });
    state.classification.suggestedAreas = [];
    renderAreaFlow(state.classification);
    setStatus(`${area.name} created and selected.`);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    elements.acceptAreaSuggestionButton.disabled = !areaSuggestion(state.classification);
    elements.acceptAreaSuggestionButton.textContent = areaSuggestion(state.classification)
      ? "Create suggested Area"
      : "Accept suggestion";
  }
}

function addAreaToTaxonomy(area) {
  if (!state.taxonomy) {
    state.taxonomy = {
      areas: [],
      topics: [],
      projects: []
    };
  }

  if (!state.taxonomy.areas.some((item) => item.id === area.id)) {
    state.taxonomy.areas = [...state.taxonomy.areas, area];
    renderPicker(elements.areaPicker, state.taxonomy.areas, "Choose Area", "+ New Area...", createNewAreaValue);
  }
}

function selectArea(relation) {
  state.areaSelection = relation;
  state.areaSkipped = false;
  renderSelectedArea();
}

async function addPickedRelation(kind) {
  ensureClassification();

  const selectByKind = {
    areas: elements.areaPicker,
    topics: elements.topicPicker,
    projects: elements.projectPicker
  };

  const select = selectByKind[kind];
  const label = relationKindLabel(kind);

  if (!state.taxonomy) {
    setStatus("Loading your Notion lists...");
    await loadTaxonomyPickers();
  }

  if (!state.taxonomy) {
    setStatus("Could not add yet because your Notion lists are not loaded.", true);
    return;
  }

  if (!select.value) {
    return;
  }

  if (kind === "topics" && select.value === createNewTopicValue) {
    showNewTopicForm();
    select.value = "";
    return;
  }

  const collectionByKind = {
    areas: state.taxonomy.areas,
    topics: state.taxonomy.topics,
    projects: state.taxonomy.projects
  };

  const entity = collectionByKind[kind].find((item) => item.id === select.value);
  if (!entity) {
    setStatus(`That ${label} is not available anymore. Reload the extension and try again.`, true);
    return;
  }

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

function showNewTopicForm() {
  elements.newTopicGroup.hidden = false;
  elements.newTopicName.focus();
}

async function createNewTopic() {
  ensureClassification();
  const name = elements.newTopicName.value.trim();
  if (!name) {
    setStatus("Enter a name for the new Topic.", true);
    return;
  }

  elements.createTopicButton.disabled = true;
  elements.createTopicButton.textContent = "Creating...";
  setStatus(`Creating Topic: ${name}`);

  try {
    const response = await postJson("/api/topics", { name });
    addTopicToTaxonomy(response.topic);
    addCreatedTopic(response.topic);
    elements.newTopicName.value = "";
    elements.newTopicGroup.hidden = true;
    setStatus(`${response.topic.name} created and selected.`);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    elements.createTopicButton.disabled = false;
    elements.createTopicButton.textContent = "Create";
  }
}

function addTopicToTaxonomy(topic) {
  if (!state.taxonomy) {
    state.taxonomy = {
      areas: [],
      topics: [],
      projects: []
    };
  }

  if (!state.taxonomy.topics.some((item) => item.id === topic.id)) {
    state.taxonomy.topics = [...state.taxonomy.topics, topic];
    renderPicker(elements.topicPicker, state.taxonomy.topics, "Choose Topic", "+ New Topic...", createNewTopicValue);
  }
}

function relationKindLabel(kind) {
  return {
    areas: "Area",
    topics: "Topic",
    projects: "Project"
  }[kind];
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
    suggestedAreas: [],
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
    addTopicToTaxonomy(response.topic);
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
    ensureClassification();
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
  const currentSuggestion = state.classification ? areaSuggestion(state.classification) : undefined;
  elements.acceptAreaSuggestionButton.disabled =
    isBusy || !currentSuggestion || isCurrentAreaSuggestion(currentSuggestion);
  elements.chooseAreaButton.disabled = isBusy;
  elements.showNewAreaButton.disabled = isBusy;
  elements.skipAreaButton.disabled = isBusy;
  elements.createAreaButton.disabled = isBusy;
  elements.createTopicButton.disabled = isBusy;
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
