import {
  buildNovelMessages,
  createTranscriptChunks,
  requestChatCompletion,
  requestModelList,
} from "./ai.js";
import { cleanText, parseChatExport, renderChat } from "./parser.js";
import {
  compileReferenceContext,
  parseCharacterCardFile,
  parseWorldBookJson,
} from "./context.js";
import {
  applyPresetRegex,
  compilePresetPrompt,
  parseSillyTavernPreset,
  presetEntrySummary,
  presetRegexSummary,
} from "./preset.js";

const API_SESSION_KEY = "rp-novel-converter-api-config";

const elements = {
  fileInput: document.querySelector("#file-input"),
  dropZone: document.querySelector("#drop-zone"),
  dropTitle: document.querySelector("#drop-title"),
  fileSummary: document.querySelector("#file-summary"),
  fileName: document.querySelector("#file-name"),
  messageCount: document.querySelector("#message-count"),
  replaceFile: document.querySelector("#replace-file"),
  removeTimestamps: document.querySelector("#remove-timestamps"),
  removeOoc: document.querySelector("#remove-ooc"),
  storyTitle: document.querySelector("#story-title"),
  userAlias: document.querySelector("#user-alias"),
  characterAlias: document.querySelector("#character-alias"),
  aiConfig: document.querySelector("#ai-config"),
  apiBaseUrl: document.querySelector("#api-base-url"),
  apiKey: document.querySelector("#api-key"),
  apiModel: document.querySelector("#api-model"),
  modelOptions: document.querySelector("#model-options"),
  fetchModels: document.querySelector("#fetch-models"),
  aiStyle: document.querySelector("#ai-style"),
  aiCustomPrompt: document.querySelector("#ai-custom-prompt"),
  presetInput: document.querySelector("#preset-input"),
  importPreset: document.querySelector("#import-preset"),
  presetSummary: document.querySelector("#preset-summary"),
  presetName: document.querySelector("#preset-name"),
  presetStats: document.querySelector("#preset-stats"),
  presetItems: document.querySelector("#preset-items"),
  presetRegexRow: document.querySelector("#preset-regex-row"),
  applyPresetRegexInput: document.querySelector("#apply-preset-regex"),
  removePreset: document.querySelector("#remove-preset"),
  characterInput: document.querySelector("#character-input"),
  importCharacter: document.querySelector("#import-character"),
  characterSummary: document.querySelector("#character-summary"),
  characterName: document.querySelector("#character-name"),
  characterStats: document.querySelector("#character-stats"),
  characterItems: document.querySelector("#character-items"),
  removeCharacter: document.querySelector("#remove-character"),
  worldInput: document.querySelector("#world-input"),
  importWorld: document.querySelector("#import-world"),
  worldSummary: document.querySelector("#world-summary"),
  worldName: document.querySelector("#world-name"),
  worldStats: document.querySelector("#world-stats"),
  worldItems: document.querySelector("#world-items"),
  clearWorld: document.querySelector("#clear-world"),
  rememberApiConfig: document.querySelector("#remember-api-config"),
  apiConsent: document.querySelector("#api-consent"),
  conversionProgress: document.querySelector("#conversion-progress"),
  progressLabel: document.querySelector("#progress-label"),
  progressDetail: document.querySelector("#progress-detail"),
  progressBar: document.querySelector("#progress-bar"),
  cancelConversion: document.querySelector("#cancel-conversion"),
  convertButton: document.querySelector("#convert-button"),
  errorMessage: document.querySelector("#error-message"),
  previewEmpty: document.querySelector("#preview-empty"),
  manuscript: document.querySelector("#manuscript"),
  manuscriptTitle: document.querySelector("#manuscript-title"),
  previewText: document.querySelector("#preview-text"),
  previewActions: document.querySelector("#preview-actions"),
  outputStats: document.querySelector("#output-stats"),
  copyButton: document.querySelector("#copy-button"),
  downloadTxt: document.querySelector("#download-txt"),
  downloadMd: document.querySelector("#download-md"),
  toast: document.querySelector("#toast"),
};

let currentChat = null;
let currentOutput = null;
let activeController = null;
let currentPreset = null;
let currentCharacterCard = null;
let worldBooks = [];

function showError(message = "") {
  elements.errorMessage.textContent = message;
  elements.errorMessage.hidden = !message;
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => {
    elements.toast.classList.remove("is-visible");
  }, 1800);
}

function currentMode() {
  return document.querySelector('input[name="mode"]:checked')?.value || "faithful";
}

function restoreApiConfig() {
  try {
    const stored = JSON.parse(sessionStorage.getItem(API_SESSION_KEY) || "null");
    if (!stored) return;
    elements.apiBaseUrl.value = stored.baseUrl || "";
    elements.apiKey.value = stored.apiKey || "";
    elements.apiModel.value = stored.model || "";
    elements.aiStyle.value = stored.style || "literary";
    elements.aiCustomPrompt.value = stored.customPrompt || "";
  } catch {
    sessionStorage.removeItem(API_SESSION_KEY);
  }
}

function apiConfig() {
  return {
    baseUrl: elements.apiBaseUrl.value.trim(),
    apiKey: elements.apiKey.value,
    model: elements.apiModel.value.trim(),
    style: elements.aiStyle.value,
    customPrompt: elements.aiCustomPrompt.value.trim(),
  };
}

function rememberApiConfig(config) {
  try {
    if (elements.rememberApiConfig.checked) {
      sessionStorage.setItem(API_SESSION_KEY, JSON.stringify(config));
    } else {
      sessionStorage.removeItem(API_SESSION_KEY);
    }
  } catch {
    // Private browsing modes may block session storage; conversion can continue.
  }
}

function syncModeUi() {
  const isAi = currentMode() === "ai";
  elements.aiConfig.hidden = !isAi;
  if (!elements.convertButton.classList.contains("is-working")) {
    elements.convertButton.querySelector("span").textContent = isAi
      ? "开始 AI 小说化"
      : currentOutput
        ? "重新转换"
        : "开始转换";
  }
}

function renderPresetSummary() {
  const preset = currentPreset;
  elements.presetSummary.hidden = !preset;
  if (!preset) return;

  elements.presetName.textContent = preset.name;
  const activeCount = preset.entries.filter((entry) => entry.selected).length;
  const activeRegexCount = preset.regexScripts.filter(
    (script) => script.category === "active" && script.selected,
  ).length;
  elements.presetStats.textContent =
    `${activeCount} 项已应用 · ${preset.blockedCount} 项已过滤` +
    (preset.incompatibleCount ? ` · ${preset.incompatibleCount} 项格式指令未采用` : "") +
    (preset.regexActiveCount
      ? ` · ${activeRegexCount}/${preset.regexActiveCount} 条文本正则已选择`
      : "");
  elements.presetRegexRow.hidden = !preset.regexActiveCount;

  const labels = {
    blocked: "已过滤",
    incompatible: "不适用",
    visual: "跳过美化",
    context: "跳过裁剪",
    invalid: "正则无效",
  };
  const items = [
    ...presetEntrySummary(preset),
    ...presetRegexSummary(preset),
  ];
  elements.presetItems.replaceChildren(
    ...items.map((item) => {
      const row = document.createElement("li");
      const control = document.createElement(item.selectable ? "label" : "span");
      control.className = "preset-item-control";
      if (item.selectable) {
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = item.selected === true;
        checkbox.dataset.presetType = item.type;
        checkbox.dataset.presetId = item.id;
        control.append(checkbox);
      }
      const name = document.createElement("span");
      const badge = document.createElement("span");
      name.textContent = item.name;
      badge.textContent = item.selectable
        ? item.selected
          ? item.type === "regex"
            ? "正则启用"
            : "已启用"
          : item.originalEnabled
            ? "已关闭"
            : "原预设关闭"
        : labels[item.category];
      badge.className = `preset-item-badge is-${item.category}`;
      control.append(name);
      row.append(control, badge);
      return row;
    }),
  );
}

async function loadPreset(file) {
  if (!file) return;
  if (!/\.json$/i.test(file.name)) {
    showError("请选择酒馆导出的 .json 预设文件。");
    return;
  }

  showError();
  elements.importPreset.disabled = true;
  elements.importPreset.textContent = "正在读取…";
  try {
    currentPreset = parseSillyTavernPreset(await file.text(), file.name);
    elements.applyPresetRegexInput.checked = currentPreset.regexActiveCount > 0;
    renderPresetSummary();
    showToast(`已导入预设：${currentPreset.name}`);
  } catch (error) {
    currentPreset = null;
    renderPresetSummary();
    showError(error instanceof Error ? `预设导入失败：${error.message}` : "预设导入失败。");
  } finally {
    elements.importPreset.disabled = false;
    elements.importPreset.textContent = "导入酒馆预设";
    elements.presetInput.value = "";
  }
}

function renderCharacterSummary() {
  const card = currentCharacterCard;
  elements.characterSummary.hidden = !card;
  if (!card) return;

  const selectedSections = card.sections.filter((section) => section.selected).length;
  const activeRegexes = card.regexScripts.filter(
    (script) => script.category === "active" && script.selected,
  ).length;
  elements.characterName.textContent = card.name;
  elements.characterStats.textContent =
    `${selectedSections}/${card.sections.length} 项资料已选择` +
    (card.worldBook ? ` · 内嵌世界书 ${card.worldBook.entries.length} 条` : "") +
    (card.regexScripts.length ? ` · ${activeRegexes} 条角色正则` : "");

  const items = [
    ...card.sections.map((section) => ({
      id: section.id,
      name: section.label,
      selected: section.selected,
      selectable: true,
      type: "section",
      badge: section.selected ? "已启用" : "未启用",
    })),
    ...presetRegexSummary(card).map((item) => ({
      ...item,
      type: "regex",
      badge: item.selectable
        ? item.selected
          ? "正则启用"
          : "正则未启用"
        : "正则跳过",
    })),
  ];

  elements.characterItems.replaceChildren(
    ...items.map((item) => {
      const row = document.createElement("li");
      const control = document.createElement(item.selectable ? "label" : "span");
      control.className = "preset-item-control";
      if (item.selectable) {
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = item.selected === true;
        checkbox.dataset.characterType = item.type;
        checkbox.dataset.characterId = item.id;
        control.append(checkbox);
      }
      const name = document.createElement("span");
      name.textContent = item.name;
      const badge = document.createElement("span");
      badge.textContent = item.badge;
      badge.className = `preset-item-badge is-${item.category || "safe"}`;
      control.append(name);
      row.append(control, badge);
      return row;
    }),
  );
}

function renderWorldSummary() {
  elements.worldSummary.hidden = !worldBooks.length;
  if (!worldBooks.length) return;
  const entries = worldBooks.flatMap((book, bookIndex) =>
    book.entries.map((entry) => ({ ...entry, bookIndex })),
  );
  const selected = entries.filter((entry) => entry.selected).length;
  elements.worldName.textContent =
    worldBooks.length === 1 ? worldBooks[0].name : `${worldBooks.length} 本世界书`;
  elements.worldStats.textContent =
    `${selected}/${entries.length} 条已选择 · 常驻条目始终生效，其余按关键词激活`;
  elements.worldItems.replaceChildren(
    ...entries.map((entry) => {
      const row = document.createElement("li");
      const control = document.createElement("label");
      control.className = "preset-item-control";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = entry.selected;
      checkbox.dataset.worldBook = String(entry.bookIndex);
      checkbox.dataset.worldEntry = entry.id;
      const name = document.createElement("span");
      name.textContent =
        worldBooks.length > 1 ? `${entry.bookName} · ${entry.name}` : entry.name;
      const badge = document.createElement("span");
      badge.textContent = entry.constant
        ? "常驻"
        : entry.keys.length
          ? entry.keys.slice(0, 2).join(" / ")
          : "无关键词";
      badge.className = "preset-item-badge is-safe";
      control.append(checkbox, name);
      row.append(control, badge);
      return row;
    }),
  );
}

async function loadCharacterCard(file) {
  if (!file) return;
  showError();
  elements.importCharacter.disabled = true;
  elements.importCharacter.textContent = "正在读取…";
  try {
    currentCharacterCard = await parseCharacterCardFile(file);
    worldBooks = worldBooks.filter((book) => !book.fromCharacterCard);
    if (currentCharacterCard.worldBook) {
      worldBooks.push({ ...currentCharacterCard.worldBook, fromCharacterCard: true });
    }
    renderCharacterSummary();
    renderWorldSummary();
    showToast(`已导入角色卡：${currentCharacterCard.name}`);
  } catch (error) {
    showError(error instanceof Error ? `角色卡导入失败：${error.message}` : "角色卡导入失败。");
  } finally {
    elements.importCharacter.disabled = false;
    elements.importCharacter.textContent = "导入角色卡";
    elements.characterInput.value = "";
  }
}

async function loadWorldBooks(files) {
  const list = [...(files || [])];
  if (!list.length) return;
  showError();
  elements.importWorld.disabled = true;
  elements.importWorld.textContent = "正在读取…";
  try {
    for (const file of list) {
      if (!/\.json$/i.test(file.name)) throw new Error(`${file.name} 不是 JSON 文件。`);
      worldBooks.push(parseWorldBookJson(await file.text(), file.name));
    }
    renderWorldSummary();
    showToast(`已导入 ${list.length} 本世界书`);
  } catch (error) {
    showError(error instanceof Error ? `世界书导入失败：${error.message}` : "世界书导入失败。");
  } finally {
    elements.importWorld.disabled = false;
    elements.importWorld.textContent = "导入世界书";
    elements.worldInput.value = "";
  }
}

async function fetchAvailableModels() {
  const config = apiConfig();
  if (!config.baseUrl) {
    showError("拉取模型失败：请先填写 API Base URL。");
    elements.apiBaseUrl.focus();
    return;
  }

  showError();
  elements.fetchModels.disabled = true;
  elements.fetchModels.textContent = "拉取中…";
  try {
    const models = await requestModelList(config);
    elements.modelOptions.replaceChildren(
      ...models.map((id) => {
        const option = document.createElement("option");
        option.value = id;
        return option;
      }),
    );
    if (!elements.apiModel.value && models.length === 1) {
      elements.apiModel.value = models[0];
    }
    rememberApiConfig(apiConfig());
    elements.apiModel.focus();
    showToast(`已拉取 ${models.length} 个模型，可输入或选择`);
  } catch (error) {
    showError(
      error instanceof Error
        ? `拉取模型失败：${error.message}`
        : "拉取模型失败，请检查接口设置。",
    );
  } finally {
    elements.fetchModels.disabled = false;
    elements.fetchModels.textContent = "拉取模型";
  }
}

async function loadFile(file) {
  if (!file) return;
  if (!/\.(jsonl?|ndjson)$/i.test(file.name)) {
    showError("请选择 .jsonl 或 .json 文件。");
    return;
  }

  showError();
  elements.dropZone.classList.add("is-loading");
  elements.dropTitle.textContent = "正在读取……";

  try {
    const text = await file.text();
    currentChat = parseChatExport(text, file.name);
    currentOutput = null;

    elements.fileName.textContent = file.name;
    elements.messageCount.textContent = `${currentChat.messages.length} 条消息`;
    elements.fileSummary.hidden = false;
    elements.dropZone.classList.add("has-file");
    elements.dropTitle.textContent = "文件读取完成";
    elements.storyTitle.placeholder = currentChat.title;
    elements.userAlias.placeholder = currentChat.metadata.userName || "沿用记录中的名字";
    elements.characterAlias.placeholder =
      currentChat.metadata.characterName || "沿用记录中的名字";
    elements.convertButton.disabled = false;
    elements.convertButton.focus();
  } catch (error) {
    currentChat = null;
    elements.convertButton.disabled = true;
    elements.dropTitle.textContent = "上传或拖放 .jsonl / .json 文件";
    showError(error instanceof Error ? error.message : "读取文件时发生错误。");
  } finally {
    elements.dropZone.classList.remove("is-loading");
  }
}

function displayOutput(output, message = "转换完成，结果已生成") {
  currentOutput = output;
  elements.manuscriptTitle.textContent = output.title;
  elements.previewText.textContent = output.body;
  elements.previewEmpty.hidden = true;
  elements.manuscript.hidden = false;
  elements.previewActions.hidden = false;
  elements.outputStats.textContent =
    `${output.messageCount} 条消息 · ${output.characterCount.toLocaleString("zh-CN")} 字符`;
  elements.manuscript.classList.remove("reveal");

  requestAnimationFrame(() => {
    elements.manuscript.classList.add("reveal");
    document.querySelector(".preview-card").scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "start",
    });
  });
  showToast(message);
}

function setProgress(current, total, label) {
  elements.progressLabel.textContent = label;
  elements.progressDetail.textContent = total ? `${current} / ${total}` : "";
  elements.progressBar.style.width = total ? `${Math.round((current / total) * 100)}%` : "0%";
}

function setWorking(working, label = "正在整理") {
  elements.convertButton.classList.toggle("is-working", working);
  elements.convertButton.disabled = working || !currentChat;
  elements.convertButton.querySelector("span").textContent = working
    ? label
    : currentMode() === "ai"
      ? "开始 AI 小说化"
      : currentOutput
        ? "重新转换"
        : "开始转换";
}

async function convertLocally() {
  setWorking(true);
  await new Promise((resolve) => window.setTimeout(resolve, 120));
  const output = renderChat(currentChat, {
    mode: currentMode(),
    removeTimestamps: elements.removeTimestamps.checked,
    removeOoc: elements.removeOoc.checked,
    title: elements.storyTitle.value,
    userAlias: elements.userAlias.value,
    characterAlias: elements.characterAlias.value,
  });
  displayOutput(output);
}

async function convertWithAi() {
  const config = apiConfig();
  if (!config.baseUrl) throw new Error("请填写 API Base URL。");
  if (!config.model) throw new Error("请填写模型名。");
  if (!elements.apiConsent.checked) {
    throw new Error("请先确认聊天正文将发送到你填写的接口。");
  }

  rememberApiConfig(config);
  const presetOptions = {
    enabled: elements.applyPresetRegexInput.checked,
    userName:
      elements.userAlias.value ||
      currentChat.metadata.userName,
    characterName:
      elements.characterAlias.value ||
      currentChat.metadata.characterName,
  };
  const applyImportedRegex = (text, options) => {
    let output = applyPresetRegex(text, currentPreset, options);
    output = applyPresetRegex(output, currentCharacterCard, {
      ...options,
      enabled: true,
    });
    return output;
  };
  const chunks = createTranscriptChunks(currentChat, {
    removeOoc: elements.removeOoc.checked,
    userAlias: elements.userAlias.value,
    characterAlias: elements.characterAlias.value,
    cleanText,
    transformMessage: (text, { message, depth }) =>
      applyImportedRegex(text, {
        ...presetOptions,
        placement: message.role === "user" ? 1 : 2,
        phase: "prompt",
        depth,
      }),
  });
  if (!chunks.length) throw new Error("没有可发送的聊天正文。");

  activeController = new AbortController();
  elements.conversionProgress.hidden = false;
  setProgress(0, chunks.length, "正在连接接口");
  setWorking(true, "AI 正在改写");

  const results = [];
  for (let index = 0; index < chunks.length; index += 1) {
    setProgress(index, chunks.length, `正在改写第 ${index + 1} 段`);
    const messages = buildNovelMessages({
      chunk: chunks[index],
      chunkIndex: index,
      chunkCount: chunks.length,
      style: config.style,
      customPrompt: config.customPrompt,
      presetPrompt: compilePresetPrompt(currentPreset, {
        userName:
          elements.userAlias.value ||
          currentChat.metadata.userName,
        characterName:
          elements.characterAlias.value ||
          currentChat.metadata.characterName,
      }),
      referencePrompt: compileReferenceContext({
        card: currentCharacterCard,
        worldBooks,
        text: chunks[index],
        userName:
          elements.userAlias.value ||
          currentChat.metadata.userName,
        characterName:
          elements.characterAlias.value ||
          currentCharacterCard?.name ||
          currentChat.metadata.characterName,
      }),
      continuity: results[index - 1]?.slice(-700) || "",
    });
    const rawText = await requestChatCompletion(config, messages, {
      signal: activeController.signal,
    });
    const text = applyImportedRegex(rawText, {
      ...presetOptions,
      placement: 2,
      phase: "output",
      depth: 0,
    }).trim();
    results.push(text);
    setProgress(index + 1, chunks.length, `第 ${index + 1} 段已完成`);
  }

  const title = elements.storyTitle.value.trim() || currentChat.title || "未命名故事";
  const body = results.join("\n\n");
  displayOutput(
    {
      title,
      body,
      text: `${title}\n${"—".repeat(Math.min(12, Math.max(4, title.length)))}\n\n${body}`,
      markdown: `# ${title}\n\n${body}\n`,
      messageCount: currentChat.messages.length,
      characterCount: body.length,
    },
    `AI 小说化完成，共处理 ${chunks.length} 段`,
  );
}

async function convert() {
  if (!currentChat || activeController) return;
  showError();

  try {
    if (currentMode() === "ai") {
      await convertWithAi();
    } else {
      await convertLocally();
    }
  } catch (error) {
    if (error?.name === "AbortError") {
      showToast("已取消 AI 改写");
    } else {
      showError(
        error instanceof Error
          ? `转换失败：${error.message}`
          : "转换失败，请检查接口设置后重试。",
      );
    }
  } finally {
    activeController = null;
    elements.conversionProgress.hidden = true;
    setWorking(false);
  }
}

function safeFileName(value) {
  const cleaned = value.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim();
  return cleaned || "chat-export";
}

function download(content, extension, mimeType) {
  if (!currentOutput) return;
  const blob = new Blob(["\uFEFF", content], { type: `${mimeType};charset=utf-8` });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${safeFileName(currentOutput.title)}.${extension}`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 500);
}

elements.fileInput.addEventListener("change", (event) => loadFile(event.target.files?.[0]));
elements.replaceFile.addEventListener("click", () => elements.fileInput.click());
elements.convertButton.addEventListener("click", convert);
elements.fetchModels.addEventListener("click", fetchAvailableModels);
elements.importPreset.addEventListener("click", () => elements.presetInput.click());
elements.presetInput.addEventListener("change", (event) =>
  loadPreset(event.target.files?.[0]),
);
elements.applyPresetRegexInput.addEventListener("change", renderPresetSummary);
elements.presetItems.addEventListener("change", (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !currentPreset) return;
  if (input.dataset.presetType === "prompt") {
    const entry = currentPreset.entries.find(
      (item) => item.identifier === input.dataset.presetId,
    );
    if (entry && ["safe", "sensitive"].includes(entry.category)) {
      entry.selected = input.checked;
    }
  }
  if (input.dataset.presetType === "regex") {
    const script = currentPreset.regexScripts.find(
      (item) => item.id === input.dataset.presetId,
    );
    if (script?.category === "active") script.selected = input.checked;
  }
  renderPresetSummary();
});
elements.removePreset.addEventListener("click", () => {
  currentPreset = null;
  elements.applyPresetRegexInput.checked = false;
  renderPresetSummary();
  showToast("已移除预设");
});
elements.importCharacter.addEventListener("click", () => elements.characterInput.click());
elements.characterInput.addEventListener("change", (event) =>
  loadCharacterCard(event.target.files?.[0]),
);
elements.characterItems.addEventListener("change", (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !currentCharacterCard) return;
  if (input.dataset.characterType === "section") {
    const section = currentCharacterCard.sections.find(
      (item) => item.id === input.dataset.characterId,
    );
    if (section) section.selected = input.checked;
  }
  if (input.dataset.characterType === "regex") {
    const script = currentCharacterCard.regexScripts.find(
      (item) => item.id === input.dataset.characterId,
    );
    if (script?.category === "active") script.selected = input.checked;
  }
  renderCharacterSummary();
});
elements.removeCharacter.addEventListener("click", () => {
  currentCharacterCard = null;
  worldBooks = worldBooks.filter((book) => !book.fromCharacterCard);
  renderCharacterSummary();
  renderWorldSummary();
  showToast("已移除角色卡");
});
elements.importWorld.addEventListener("click", () => elements.worldInput.click());
elements.worldInput.addEventListener("change", (event) =>
  loadWorldBooks(event.target.files),
);
elements.worldItems.addEventListener("change", (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  const book = worldBooks[Number(input.dataset.worldBook)];
  const entry = book?.entries.find((item) => item.id === input.dataset.worldEntry);
  if (entry) entry.selected = input.checked;
  renderWorldSummary();
});
elements.clearWorld.addEventListener("click", () => {
  worldBooks = worldBooks.filter((book) => book.fromCharacterCard);
  renderWorldSummary();
  showToast("已清空外部世界书");
});
elements.cancelConversion.addEventListener("click", () => activeController?.abort());
document.querySelectorAll('input[name="mode"]').forEach((input) => {
  input.addEventListener("change", syncModeUi);
});

["dragenter", "dragover"].forEach((eventName) => {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.add("is-dragging");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove("is-dragging");
  });
});

elements.dropZone.addEventListener("drop", (event) => loadFile(event.dataTransfer?.files?.[0]));

elements.copyButton.addEventListener("click", async () => {
  if (!currentOutput) return;
  try {
    await navigator.clipboard.writeText(currentOutput.text);
    showToast("已复制到剪贴板");
  } catch {
    showToast("复制失败，请手动选择文本");
  }
});

elements.downloadTxt.addEventListener("click", () =>
  download(currentOutput?.text || "", "txt", "text/plain"),
);
elements.downloadMd.addEventListener("click", () =>
  download(currentOutput?.markdown || "", "md", "text/markdown"),
);

restoreApiConfig();
syncModeUi();
