import {
  buildNovelMessages,
  createTranscriptChunks,
  requestChatCompletion,
  requestModelList,
} from "./ai.js";
import { cleanText, parseChatExport, renderChat } from "./parser.js";

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
  const chunks = createTranscriptChunks(currentChat, {
    removeOoc: elements.removeOoc.checked,
    userAlias: elements.userAlias.value,
    characterAlias: elements.characterAlias.value,
    cleanText,
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
      continuity: results[index - 1]?.slice(-700) || "",
    });
    const text = await requestChatCompletion(config, messages, {
      signal: activeController.signal,
    });
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
