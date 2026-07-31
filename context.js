import { parseRegexScripts } from "./preset.js";

const MAX_REFERENCE_CHARS = 18000;

const CARD_SECTION_FIELDS = [
  ["description", "角色描述", true],
  ["personality", "性格", true],
  ["scenario", "背景与场景", true],
  ["mes_example", "对白示例", true],
  ["first_mes", "开场白", false],
  ["creator_notes", "作者备注", false],
  ["system_prompt", "角色系统提示", false],
  ["post_history_instructions", "历史后置指令", false],
];

function baseName(fileName = "") {
  return String(fileName || "未命名")
    .replace(/\.[^.]+$/, "")
    .trim() || "未命名";
}

function textValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function toArray(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value === "string") {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function replaceMacros(text, options = {}) {
  const userName = options.userName?.trim() || "玩家";
  const characterName = options.characterName?.trim() || "角色";
  return String(text || "")
    .replace(/\{\{\s*user\s*\}\}/gi, userName)
    .replace(/\{\{\s*char(?:acter)?\s*\}\}/gi, characterName);
}

function decodeBase64Utf8(value) {
  let binary;
  try {
    binary = atob(String(value || "").replace(/\s+/g, ""));
  } catch {
    throw new Error("角色卡 PNG 中的元数据不是有效 Base64。");
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function extractCharacterCardJsonFromPng(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 12 || signature.some((value, index) => bytes[index] !== value)) {
    throw new Error("文件不是有效的 PNG 角色卡。");
  }

  const decoder = new TextDecoder("latin1");
  let offset = 8;
  const metadata = new Map();
  while (offset + 12 <= bytes.length) {
    const length =
      ((bytes[offset] << 24) |
        (bytes[offset + 1] << 16) |
        (bytes[offset + 2] << 8) |
        bytes[offset + 3]) >>> 0;
    if (offset + 12 + length > bytes.length) break;
    const type = decoder.decode(bytes.slice(offset + 4, offset + 8));
    const data = bytes.slice(offset + 8, offset + 8 + length);
    if (type === "tEXt") {
      const separator = data.indexOf(0);
      if (separator > 0) {
        const keyword = decoder.decode(data.slice(0, separator)).toLowerCase();
        const value = decoder.decode(data.slice(separator + 1));
        if (keyword === "chara" || keyword === "ccv3") metadata.set(keyword, value);
      }
    }
    offset += 12 + length;
    if (type === "IEND") break;
  }

  const encoded = metadata.get("ccv3") || metadata.get("chara");
  if (!encoded) throw new Error("PNG 中没有找到 chara 或 ccv3 角色卡数据。");
  return decodeBase64Utf8(encoded);
}

export function parseCharacterCardJson(text, fileName = "character.json") {
  let raw;
  try {
    raw = JSON.parse(String(text || ""));
  } catch {
    throw new Error("角色卡不是有效 JSON。");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("没有识别到角色卡结构。");
  }

  const data = raw.data && typeof raw.data === "object" ? raw.data : raw;
  const name = textValue(data.name || raw.name) || baseName(fileName);
  const sections = CARD_SECTION_FIELDS.map(([id, label, defaultSelected]) => {
    const content = textValue(
      data[id] ??
        (id === "creator_notes" ? data.creatorcomment || raw.creatorcomment : ""),
    );
    return {
      id,
      label,
      content,
      selected: Boolean(content && defaultSelected),
      available: Boolean(content),
    };
  }).filter((section) => section.available);

  if (!sections.length && !data.character_book) {
    throw new Error("角色卡中没有可用的角色描述或世界书。");
  }

  return {
    name,
    fileName,
    spec: textValue(raw.spec) || (raw.data ? "chara_card_v2" : "legacy"),
    sections,
    worldBook: data.character_book
      ? parseWorldBookData(data.character_book, `${name} · 角色世界书`)
      : null,
    regexScripts: parseRegexScripts({
      extensions: { regex_scripts: data.extensions?.regex_scripts || [] },
    }),
  };
}

export async function parseCharacterCardFile(file) {
  if (!file) throw new Error("没有选择角色卡文件。");
  if (/\.png$/i.test(file.name)) {
    const json = extractCharacterCardJsonFromPng(await file.arrayBuffer());
    return parseCharacterCardJson(json, file.name);
  }
  if (/\.json$/i.test(file.name)) {
    return parseCharacterCardJson(await file.text(), file.name);
  }
  throw new Error("角色卡仅支持 .png 或 .json。");
}

export function compileCharacterContext(card, options = {}) {
  if (!card?.sections) return "";
  return card.sections
    .filter((section) => section.selected && section.content)
    .map(
      (section) =>
        `【${card.name} · ${section.label}】\n${replaceMacros(section.content, {
          ...options,
          characterName: options.characterName || card.name,
        })}`,
    )
    .join("\n\n");
}

function normalizeWorldEntry(entry, index, bookName) {
  const extensions = entry?.extensions || {};
  const keys = toArray(entry?.keys ?? entry?.key ?? entry?.keywords);
  const secondaryKeys = toArray(
    entry?.secondary_keys ?? entry?.keysecondary ?? entry?.secondaryKeys,
  );
  const content = textValue(entry?.content ?? entry?.entry ?? entry?.text);
  const enabled = entry?.enabled !== false && entry?.disable !== true;
  return {
    id: String(entry?.id ?? entry?.uid ?? index),
    name:
      textValue(entry?.comment || entry?.name || entry?.displayName) ||
      keys.join("、") ||
      `条目 ${index + 1}`,
    bookName,
    content,
    keys,
    secondaryKeys,
    constant: Boolean(entry?.constant ?? entry?.alwaysActive),
    selective: Boolean(entry?.selective) && secondaryKeys.length > 0,
    selectiveLogic: Number(
      extensions.selectiveLogic ?? entry?.selectiveLogic ?? 0,
    ),
    order: Number(entry?.order ?? entry?.insertorder ?? 100) || 0,
    caseSensitive: Boolean(extensions.case_sensitive ?? entry?.caseSensitive),
    matchWholeWords: Boolean(
      extensions.match_whole_words ?? entry?.matchWholeWords,
    ),
    selected: enabled && Boolean(content),
    originalEnabled: enabled,
  };
}

export function parseWorldBookData(raw, name = "世界书") {
  if (!raw || typeof raw !== "object") throw new Error("没有识别到世界书结构。");
  const sourceEntries = Array.isArray(raw.entries)
    ? raw.entries
    : raw.entries && typeof raw.entries === "object"
      ? Object.values(raw.entries)
      : Array.isArray(raw.data)
        ? raw.data
        : [];
  const entries = sourceEntries
    .map((entry, index) => normalizeWorldEntry(entry, index, name))
    .filter((entry) => entry.content);
  if (!entries.length) throw new Error("世界书中没有可用条目。");
  return { name, entries };
}

export function parseWorldBookJson(text, fileName = "worldbook.json") {
  let raw;
  try {
    raw = JSON.parse(String(text || ""));
  } catch {
    throw new Error("世界书不是有效 JSON。");
  }
  return parseWorldBookData(raw, textValue(raw?.name) || baseName(fileName));
}

function keywordMatches(text, keyword, entry) {
  if (!keyword) return false;
  const haystack = entry.caseSensitive ? text : text.toLocaleLowerCase("zh-CN");
  const needle = entry.caseSensitive
    ? keyword
    : keyword.toLocaleLowerCase("zh-CN");
  if (!entry.matchWholeWords) return haystack.includes(needle);
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  try {
    return new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`, "u").test(
      haystack,
    );
  } catch {
    return haystack.includes(needle);
  }
}

export function worldEntryMatches(entry, text) {
  if (!entry?.selected || !entry.content) return false;
  if (entry.constant) return true;
  const primaryMatch = entry.keys.some((key) => keywordMatches(text, key, entry));
  if (!primaryMatch) return false;
  if (!entry.selective || !entry.secondaryKeys.length) return true;

  const matches = entry.secondaryKeys.map((key) => keywordMatches(text, key, entry));
  switch (entry.selectiveLogic) {
    case 1:
      return !matches.every(Boolean);
    case 2:
      return !matches.some(Boolean);
    case 3:
      return matches.every(Boolean);
    case 0:
    default:
      return matches.some(Boolean);
  }
}

export function compileWorldContext(worldBooks, text, options = {}) {
  const entries = (worldBooks || [])
    .flatMap((book) => book?.entries || [])
    .filter((entry) => worldEntryMatches(entry, text))
    .sort((a, b) => b.order - a.order);
  const maxChars = Math.max(2000, options.maxChars || MAX_REFERENCE_CHARS);
  const sections = [];
  let length = 0;
  for (const entry of entries) {
    const section = `【${entry.bookName} · ${entry.name}】\n${replaceMacros(
      entry.content,
      options,
    )}`;
    if (length && length + section.length + 2 > maxChars) break;
    if (!length && section.length > maxChars) {
      sections.push(section.slice(0, maxChars));
      break;
    }
    sections.push(section);
    length += section.length + (length ? 2 : 0);
  }
  return sections.join("\n\n");
}

export function compileReferenceContext({
  card,
  worldBooks = [],
  text = "",
  userName = "",
  characterName = "",
}) {
  return [
    compileCharacterContext(card, { userName, characterName }),
    compileWorldContext(worldBooks, text, { userName, characterName }),
  ]
    .filter(Boolean)
    .join("\n\n");
}
