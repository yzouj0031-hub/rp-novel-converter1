const OOC_LINE_PATTERNS = [
  /^\s*(?:\[\s*ooc\s*\]|【\s*ooc\s*】|（\s*ooc\s*[：:]|\(\s*ooc\s*[：:]|ooc\s*[：:]).*$/i,
  /^\s*\(\(.*\)\)\s*$/s,
  /^\s*\/\/\s*(?:ooc\b)?.*$/i,
];

function firstString(...values) {
  return values.find((value) => {
    if (typeof value !== "string" || !value.trim()) return false;
    return !/^(?:unused|unknown|null|undefined|n\/a)$/i.test(value.trim());
  })?.trim() || "";
}

function contentToString(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item.text === "string") return item.text;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function extractMessageText(record) {
  const direct = firstString(
    record?.mes,
    record?.message,
    contentToString(record?.content),
    record?.text,
  );
  if (direct) return direct;

  if (Array.isArray(record?.swipes) && record.swipes.length) {
    const index = Number.isInteger(record.swipe_id) ? record.swipe_id : 0;
    return firstString(record.swipes[index], record.swipes[0]);
  }
  return "";
}

function looksLikeMessage(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return false;
  if (!extractMessageText(record)) return false;
  return (
    "mes" in record ||
    "message" in record ||
    "content" in record ||
    "text" in record ||
    "is_user" in record ||
    "role" in record ||
    "name" in record
  );
}

function findRecordArray(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];

  for (const key of ["messages", "chat", "history", "data", "items"]) {
    if (Array.isArray(data[key])) return data[key];
  }

  if (data.chat && typeof data.chat === "object") {
    for (const key of ["messages", "history", "items"]) {
      if (Array.isArray(data.chat[key])) return data.chat[key];
    }
  }

  return looksLikeMessage(data) ? [data] : [];
}

function collectMetadata(data, records) {
  const candidates = [
    data && !Array.isArray(data) ? data : null,
    ...records.filter((record) => record && typeof record === "object" && !looksLikeMessage(record)),
  ].filter(Boolean);

  const metadata = candidates.reduce((merged, candidate) => ({ ...merged, ...candidate }), {});
  return {
    userName: firstString(metadata.user_name, metadata.userName, metadata.persona_name),
    characterName: firstString(
      metadata.character_name,
      metadata.characterName,
      metadata.char_name,
      metadata.name,
    ),
    createDate: firstString(metadata.create_date, metadata.createDate, metadata.date),
  };
}

function parseJsonLines(rawText) {
  const records = [];
  const failures = [];

  rawText.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    try {
      records.push(JSON.parse(line));
    } catch {
      failures.push(index + 1);
    }
  });

  if (!records.length) {
    throw new Error("没有找到可读取的 JSON 内容，请确认文件是酒馆导出的 JSONL 或 JSON。");
  }
  if (failures.length) {
    throw new Error(`文件第 ${failures.slice(0, 4).join("、")} 行不是有效 JSON。`);
  }
  return records;
}

export function parseChatExport(rawText, fileName = "chat.jsonl") {
  if (!rawText || !rawText.trim()) {
    throw new Error("这个文件是空的。");
  }

  let source;
  try {
    source = JSON.parse(rawText);
  } catch {
    source = parseJsonLines(rawText);
  }

  const records = findRecordArray(source);
  const metadata = collectMetadata(source, records);
  let fallbackUser = metadata.userName;
  let fallbackCharacter = metadata.characterName;

  const messages = records
    .filter(looksLikeMessage)
    .map((record, index) => {
      const role = String(record.role || "").toLowerCase();
      const isUser =
        typeof record.is_user === "boolean" ? record.is_user : role === "user" || role === "human";
      const isSystem =
        record.is_system === true || role === "system" || String(record.name || "").toLowerCase() === "system";

      const inferredName = firstString(record.name, record.speaker, record.author);
      if (isUser && inferredName && !fallbackUser) fallbackUser = inferredName;
      if (!isUser && !isSystem && inferredName && !fallbackCharacter) fallbackCharacter = inferredName;

      return {
        id: firstString(String(record.id ?? ""), String(index)),
        index,
        role: isSystem ? "system" : isUser ? "user" : "character",
        speaker:
          inferredName ||
          (isSystem
            ? "系统"
            : isUser
              ? metadata.userName || "玩家"
              : fallbackCharacter || "角色"),
        text: extractMessageText(record),
        timestamp: firstString(record.send_date, record.timestamp, record.date, record.created_at),
      };
    })
    .filter((message) => message.text.trim());

  if (!messages.length) {
    throw new Error("文件可以读取，但没有找到聊天消息。");
  }

  return {
    fileName,
    title: fileName.replace(/\.(jsonl?|ndjson)$/i, ""),
    metadata: {
      ...metadata,
      userName: metadata.userName || fallbackUser,
      characterName: metadata.characterName || fallbackCharacter,
    },
    messages,
  };
}

export function removeOoc(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => !OOC_LINE_PATTERNS.some((pattern) => pattern.test(line)))
    .join("\n")
    .replace(/\s*(?:\(\s*ooc\s*[：:][^)]*\)|（\s*ooc\s*[：:][^）]*）)/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function cleanText(text, options = {}) {
  let output = String(text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();

  if (options.removeOoc) output = removeOoc(output);
  return output;
}

function formatTimestamp(value) {
  if (!value) return "";
  const numeric = Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 1e12 ? numeric * 1000 : numeric)
    : new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function resolveSpeaker(message, chat, options) {
  if (message.role === "user" && options.userAlias?.trim()) return options.userAlias.trim();
  if (message.role === "character" && options.characterAlias?.trim()) {
    return options.characterAlias.trim();
  }
  if (message.role === "user") return message.speaker || chat.metadata.userName || "玩家";
  if (message.role === "character") {
    return message.speaker || chat.metadata.characterName || "角色";
  }
  return message.speaker || "系统";
}

function stripOuterEmphasis(paragraph) {
  const trimmed = paragraph.trim();
  const match = trimmed.match(/^(?:\*{1,2}|_{1,2})([\s\S]+?)(?:\*{1,2}|_{1,2})$/);
  return match ? match[1].trim() : "";
}

function isNarrativeParagraph(paragraph) {
  if (stripOuterEmphasis(paragraph)) return true;
  if (paragraph.length > 88) return true;
  if (/^[“"'「『].*[”"'」』][。！？!?]?$/.test(paragraph.trim())) return false;
  return /[。！？!?][^”"」』]*[。！？!?]/.test(paragraph);
}

function formatNovelMessage(text, speaker) {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => {
      const action = stripOuterEmphasis(paragraph);
      if (action) return action;
      if (isNarrativeParagraph(paragraph) || /[“”「」『』]/.test(paragraph)) return paragraph;
      const unquoted = paragraph.replace(/^["“「『]|["”」』]$/g, "");
      return `${speaker}：“${unquoted}”`;
    })
    .join("\n\n");
}

export function renderChat(chat, options = {}) {
  const settings = {
    mode: "faithful",
    removeTimestamps: true,
    removeOoc: true,
    title: chat.title,
    userAlias: "",
    characterAlias: "",
    ...options,
  };

  const cleanedMessages = chat.messages
    .map((message) => ({
      ...message,
      text: cleanText(message.text, { removeOoc: settings.removeOoc }),
      speaker: resolveSpeaker(message, chat, settings),
    }))
    .filter((message) => message.text);

  const title = settings.title?.trim() || chat.title || "未命名故事";
  let body;

  if (settings.mode === "novel") {
    body = cleanedMessages
      .filter((message) => message.role !== "system")
      .map((message) => formatNovelMessage(message.text, message.speaker))
      .join("\n\n");
  } else {
    body = cleanedMessages
      .map((message) => {
        const time = settings.removeTimestamps ? "" : `  ·  ${formatTimestamp(message.timestamp)}`;
        return `【${message.speaker}${time}】\n${message.text}`;
      })
      .join("\n\n");
  }

  return {
    title,
    body,
    text: `${title}\n${"—".repeat(Math.min(12, Math.max(4, title.length)))}\n\n${body}`.trim(),
    markdown:
      settings.mode === "novel"
        ? `# ${title}\n\n${body}\n`
        : `# ${title}\n\n${body
            .split(/\n\n(?=【)/)
            .map((block) => block.replace(/^【(.+?)】\n/, "## $1\n\n"))
            .join("\n\n")}\n`,
    messageCount: cleanedMessages.length,
    characterCount: body.length,
  };
}
