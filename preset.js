const MAX_PRESET_CHARS = 16000;

const BYPASS_PATTERNS = [
  /jailbreak/i,
  /越狱|破限|反过滤|反系统|反审核|绕过.{0,8}(?:限制|审查|规则)/i,
  /ignore (?:all |any )?(?:previous|prior|system|developer) (?:instructions?|messages?)/i,
  /disregard (?:all |any )?(?:previous|prior|system|developer)/i,
  /(?:不要|不得|禁止).{0,10}(?:拒绝|审查|过滤)/i,
  /(?:无视|忽略).{0,12}(?:系统|开发者|安全|政策|规则|指令)/i,
  /(?:bypass|disable|evade).{0,12}(?:safety|filter|policy|moderation)/i,
  /(?:uncensored|unfiltered).{0,12}(?:mode|response|output)/i,
  /overrides? all other (?:rules|instructions)/i,
  /exempt from.{0,24}(?:ethics|rules|restrictions)/i,
  /discard.{0,16}(?:moral|ethical).{0,8}(?:chains|limits|rules)/i,
  /(?:sensitive|harmful).{0,40}(?:no concern|irrelevant|does not matter)/i,
  /(?:道德|伦理).{0,12}(?:不适用|无关|束缚|枷锁)/i,
  /(?:敏感|有害).{0,20}(?:无需|不必|无须).{0,8}(?:在意|考虑)/i,
  /(?:begin|start).{0,20}(?:roleplay|role-play).{0,20}(?:without|no).{0,12}(?:limit|restriction)/i,
];

const REASONING_PATTERNS = [
  /(?:^|[^a-z])cot(?:[^a-z]|$)/i,
  /chain[- ]of[- ]thought/i,
  /show[_ -]?thoughts?/i,
  /思维链|思考过程|推理过程|内部推理|隐藏推理/i,
];

const PROHIBITED_PATTERNS = [
  /未成年.{0,12}(?:性|色情|裸|成人)/i,
  /(?:儿童|幼童).{0,12}(?:性|色情|裸|成人)/i,
  /(?:underage|minor|child).{0,16}(?:sexual|sex|explicit|porn)/i,
];

const SENSITIVE_PATTERNS = [
  /nsfw/i,
  /成人向|色情|性爱|性行为|露骨|情色|官能/i,
  /(?:sexual|sexually explicit|erotic|pornographic)/i,
];

const TEXT_FIELDS = [
  ["system_prompt", "System Prompt"],
  ["main_prompt", "Main Prompt"],
  ["story_string", "Story String"],
  ["context", "Context"],
  ["prompt", "Prompt"],
  ["wi_format", "World Info Format"],
  ["personality_format", "Personality Format"],
  ["scenario_format", "Scenario Format"],
  ["new_chat_prompt", "New Chat Prompt"],
];

function cleanName(value, fallback) {
  const text = String(value || "").trim();
  return text || fallback;
}

function fileBaseName(fileName = "") {
  return String(fileName || "未命名预设")
    .replace(/\.[^.]+$/, "")
    .trim() || "未命名预设";
}

function promptContent(prompt) {
  for (const key of ["content", "prompt", "text"]) {
    if (typeof prompt?.[key] === "string" && prompt[key].trim()) {
      return prompt[key].trim();
    }
  }
  return "";
}

function classifyPrompt(name, content) {
  const sample = `${name}\n${content}`;
  if (PROHIBITED_PATTERNS.some((pattern) => pattern.test(sample))) {
    return { category: "blocked", reason: "不适合导入的内容" };
  }
  if (BYPASS_PATTERNS.some((pattern) => pattern.test(sample))) {
    return { category: "blocked", reason: "破限或反系统指令" };
  }
  if (REASONING_PATTERNS.some((pattern) => pattern.test(sample))) {
    return { category: "blocked", reason: "思维链或内部推理指令" };
  }
  if (SENSITIVE_PATTERNS.some((pattern) => pattern.test(sample))) {
    return { category: "sensitive", reason: "成人向写作项" };
  }
  return { category: "safe", reason: "写作与叙事指令" };
}

function getOrderMap(data) {
  const groups = Array.isArray(data?.prompt_order) ? data.prompt_order : [];
  const group = groups.find((item) => Array.isArray(item?.order));
  if (!group) return null;
  return new Map(
    group.order
      .filter((item) => typeof item?.identifier === "string")
      .map((item, index) => [
        item.identifier,
        { enabled: item.enabled !== false, index },
      ]),
  );
}

function promptEntries(data) {
  if (Array.isArray(data?.prompts)) {
    const orderMap = getOrderMap(data);
    return data.prompts
      .map((prompt, sourceIndex) => {
        const identifier = String(prompt?.identifier || `prompt-${sourceIndex}`);
        const order = orderMap?.get(identifier);
        const enabled = orderMap
          ? Boolean(order?.enabled)
          : prompt?.enabled !== false;
        return {
          identifier,
          name: cleanName(prompt?.name, `提示项 ${sourceIndex + 1}`),
          content: promptContent(prompt),
          enabled,
          marker: prompt?.marker === true,
          order: order?.index ?? sourceIndex + 10000,
        };
      })
      .sort((a, b) => a.order - b.order);
  }

  return TEXT_FIELDS
    .filter(([key]) => typeof data?.[key] === "string" && data[key].trim())
    .map(([key, name], index) => ({
      identifier: key,
      name,
      content: data[key].trim(),
      enabled: key !== "jailbreak_prompt",
      marker: false,
      order: index,
    }));
}

export function parseSillyTavernPreset(text, fileName = "preset.json") {
  let data;
  try {
    data = JSON.parse(String(text || ""));
  } catch {
    throw new Error("预设不是有效的 JSON 文件。");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("没有识别到有效的酒馆预设结构。");
  }

  const rawEntries = promptEntries(data);
  if (!rawEntries.length) {
    throw new Error("没有找到可导入的提示词项目。");
  }

  const entries = rawEntries.map((entry) => {
    if (!entry.enabled) {
      return { ...entry, category: "disabled", reason: "预设中未启用" };
    }
    if (entry.marker || !entry.content) {
      return { ...entry, category: "marker", reason: "动态占位或空项目" };
    }
    return { ...entry, ...classifyPrompt(entry.name, entry.content) };
  });

  return {
    name: cleanName(data.name || data.preset_name, fileBaseName(fileName)),
    fileName,
    entries,
    safeCount: entries.filter((entry) => entry.category === "safe").length,
    sensitiveCount: entries.filter((entry) => entry.category === "sensitive").length,
    blockedCount: entries.filter((entry) => entry.category === "blocked").length,
    disabledCount: entries.filter((entry) => entry.category === "disabled").length,
  };
}

function applyMacros(text, options) {
  const userName = options.userName?.trim() || "玩家";
  const characterName = options.characterName?.trim() || "角色";
  return text
    .replace(/\{\{\s*user\s*\}\}/gi, userName)
    .replace(/\{\{\s*char(?:acter)?\s*\}\}/gi, characterName);
}

export function compilePresetPrompt(preset, options = {}) {
  if (!preset?.entries) return "";
  const includeSensitive = options.includeSensitive === true;
  const maxChars = Math.max(
    2000,
    Number.isFinite(options.maxChars) ? options.maxChars : MAX_PRESET_CHARS,
  );
  const allowed = preset.entries.filter(
    (entry) =>
      entry.category === "safe" ||
      (includeSensitive && entry.category === "sensitive"),
  );

  const sections = [];
  let length = 0;
  for (const entry of allowed) {
    const content = applyMacros(entry.content, options).trim();
    if (!content) continue;
    const section = `【${entry.name}】\n${content}`;
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

export function presetEntrySummary(preset) {
  return preset.entries
    .filter((entry) => ["safe", "sensitive", "blocked"].includes(entry.category))
    .map(({ name, category, reason }) => ({ name, category, reason }));
}
