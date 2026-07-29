import { parseChatExport, renderChat } from "./parser.js";

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

function convert() {
  if (!currentChat) return;
  showError();
  elements.convertButton.classList.add("is-working");
  elements.convertButton.querySelector("span").textContent = "正在整理";

  window.setTimeout(() => {
    currentOutput = renderChat(currentChat, {
      mode: currentMode(),
      removeTimestamps: elements.removeTimestamps.checked,
      removeOoc: elements.removeOoc.checked,
      title: elements.storyTitle.value,
      userAlias: elements.userAlias.value,
      characterAlias: elements.characterAlias.value,
    });

    elements.manuscriptTitle.textContent = currentOutput.title;
    elements.previewText.textContent = currentOutput.body;
    elements.previewEmpty.hidden = true;
    elements.manuscript.hidden = false;
    elements.previewActions.hidden = false;
    elements.outputStats.textContent =
      `${currentOutput.messageCount} 条消息 · ${currentOutput.characterCount.toLocaleString("zh-CN")} 字符`;
    elements.convertButton.classList.remove("is-working");
    elements.convertButton.querySelector("span").textContent = "重新转换";
    elements.manuscript.classList.remove("reveal");
    requestAnimationFrame(() => elements.manuscript.classList.add("reveal"));
  }, 180);
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
