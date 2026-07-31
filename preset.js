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

const INTERFACE_PATTERNS = [
  /(?:状态栏|待办事项|顶部标题|手记状态|文本双译|功能插件)/i,
  /(?:^|[\s🏷️])(?:信息|内容规范|前文|COT规范)(?:开始|结束)/i,
  /(?:意图分析|错误纠察|创作优化)/i,
  /(?:^|\s)用户\s*=\s*\{\{user\}\}/i,
  /<\s*(?:status|todo|title|details|potential_errors|character_settings|additional_info)\b/i,
  /(?:输出|生成|返回).{0,18}(?:状态栏|摘要栏|标题标签|HTML|XML标签)/i,
];

const REGEX_PLACEMENT = {
  USER_INPUT: 1,
  AI_OUTPUT: 2,
};

const HTML_REPLACEMENT_PATTERN =
  /<\s*(?:style|script|div|details|summary|span|table|iframe|img|link)\b/i;
const CONTEXT_REGEX_PATTERN =
  /隐藏历史|以前的|旧消息|旧回复|上下文裁剪|仅保留摘要|history|previous|[0-9一二三四五六七八九十]+楼/i;
const MAX_REGEX_LENGTH = 4000;
const MAX_REGEX_INPUT_LENGTH = 240000;

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
  if (INTERFACE_PATTERNS.some((pattern) => pattern.test(sample))) {
    return { category: "incompatible", reason: "酒馆界面或附加格式，不适用于小说正文" };
  }
  if (SENSITIVE_PATTERNS.some((pattern) => pattern.test(sample))) {
    return { category: "sensitive", reason: "成人向写作项" };
  }
  return { category: "safe", reason: "写作与叙事指令" };
}

function isRiskyRegex(pattern) {
  if (pattern.length > MAX_REGEX_LENGTH) return true;
  return /\((?:[^()\\]|\\.)*(?:\+|\*)(?:[^()\\]|\\.)*\)\s*(?:\+|\*|\{\d)/.test(
    pattern,
  );
}

function parseRegexLiteral(value, options = {}) {
  let source = String(value || "");
  if (options.substituteRegex) source = applyMacros(source, options);
  if (!source || isRiskyRegex(source)) return null;

  let pattern = source;
  let flags = "";
  if (source.startsWith("/")) {
    let slash = -1;
    for (let index = source.length - 1; index > 0; index -= 1) {
      if (source[index] !== "/") continue;
      let backslashes = 0;
      for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) {
        backslashes += 1;
      }
      if (backslashes % 2 === 0) {
        slash = index;
        break;
      }
    }
    if (slash > 0) {
      pattern = source.slice(1, slash);
      flags = source.slice(slash + 1);
    }
  }

  if (!/^[dgimsuvy]*$/.test(flags) || isRiskyRegex(pattern)) return null;
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

export function parseRegexScripts(data) {
  const embedded = data?.extensions?.regex_scripts;
  const source = Array.isArray(embedded)
    ? embedded
    : Array.isArray(data?.regex_scripts)
      ? data.regex_scripts
      : Array.isArray(data)
        ? data
        : [];

  return source.map((script, index) => {
    const name = cleanName(script?.scriptName || script?.name, `正则 ${index + 1}`);
    const findRegex = String(script?.findRegex || "");
    const replaceString = String(script?.replaceString || "");
    const placement = Array.isArray(script?.placement)
      ? script.placement.map(Number).filter(Number.isFinite)
      : [];
    const nullableNumber = (value) =>
      value === null || value === undefined || value === ""
        ? null
        : Number.isFinite(Number(value))
          ? Number(value)
          : null;
    const base = {
      id: String(script?.id || `regex-${index}`),
      name,
      findRegex,
      replaceString,
      trimStrings: Array.isArray(script?.trimStrings)
        ? script.trimStrings.map(String)
        : [],
      placement,
      disabled: script?.disabled === true,
      markdownOnly: script?.markdownOnly === true,
      promptOnly: script?.promptOnly === true,
      runOnEdit: script?.runOnEdit !== false,
      substituteRegex: Number(script?.substituteRegex) || 0,
      minDepth: nullableNumber(script?.minDepth),
      maxDepth: nullableNumber(script?.maxDepth),
      order: index,
    };

    if (
      !findRegex ||
      !placement.some((value) =>
        [REGEX_PLACEMENT.USER_INPUT, REGEX_PLACEMENT.AI_OUTPUT].includes(value),
      )
    ) {
      return {
        ...base,
        category: "invalid",
        reason: "不作用于玩家输入或 AI 输出",
        selected: false,
      };
    }
    if (!parseRegexLiteral(findRegex, { substituteRegex: base.substituteRegex })) {
      return {
        ...base,
        category: "invalid",
        reason: "正则无效或可能造成页面卡顿",
        selected: false,
      };
    }
    if (HTML_REPLACEMENT_PATTERN.test(replaceString)) {
      return {
        ...base,
        category: "visual",
        reason: "HTML 美化脚本不适用于纯文本输出",
        selected: false,
      };
    }
    if (
      CONTEXT_REGEX_PATTERN.test(name) ||
      (!replaceString && (base.minDepth !== null || base.maxDepth !== null))
    ) {
      return {
        ...base,
        category: "context",
        reason: "为避免丢失剧情，跳过上下文裁剪",
        selected: false,
      };
    }
    return {
      ...base,
      category: "active",
      reason: base.disabled ? "正则在原预设中未启用" : "文本正则已启用",
      selected: !base.disabled,
    };
  });
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
  if (!data || typeof data !== "object") {
    throw new Error("没有识别到有效的酒馆预设结构。");
  }

  const rawEntries = promptEntries(data);
  const parsedRegexScripts = parseRegexScripts(data);
  if (!rawEntries.length && !parsedRegexScripts.length) {
    throw new Error("没有找到可导入的提示词项目。");
  }

  const entries = rawEntries.map((entry) => {
    if (entry.marker || !entry.content) {
      return {
        ...entry,
        originalEnabled: entry.enabled,
        category: "marker",
        reason: "动态占位或空项目",
        selected: false,
      };
    }
    const classified = classifyPrompt(entry.name, entry.content);
    return {
      ...entry,
      originalEnabled: entry.enabled,
      ...classified,
      reason: entry.enabled ? classified.reason : `原预设关闭 · ${classified.reason}`,
      selected: entry.enabled && classified.category === "safe",
    };
  });

  return {
    name: cleanName(data.name || data.preset_name, fileBaseName(fileName)),
    fileName,
    entries,
    regexScripts: parsedRegexScripts,
    safeCount: entries.filter((entry) => entry.category === "safe").length,
    sensitiveCount: entries.filter((entry) => entry.category === "sensitive").length,
    blockedCount: entries.filter((entry) => entry.category === "blocked").length,
    incompatibleCount: entries.filter((entry) => entry.category === "incompatible").length,
    disabledCount: entries.filter((entry) => !entry.originalEnabled).length,
    regexActiveCount: parsedRegexScripts.filter((script) => script.category === "active")
      .length,
    regexSkippedCount: parsedRegexScripts.filter((script) =>
      ["visual", "context", "invalid"].includes(script.category),
    ).length,
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
      entry.selected === true ||
      (entry.selected === undefined &&
        (entry.category === "safe" ||
          (includeSensitive && entry.category === "sensitive"))),
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
    .filter((entry) =>
      ["safe", "sensitive", "blocked", "incompatible"].includes(entry.category),
    )
    .map(({ identifier, name, category, reason, selected, originalEnabled }) => ({
      id: identifier,
      name,
      category,
      reason,
      selected,
      originalEnabled,
      selectable: ["safe", "sensitive"].includes(category),
      type: "prompt",
    }));
}

export function presetRegexSummary(preset) {
  return (preset?.regexScripts || [])
    .filter((script) =>
      ["active", "visual", "context", "invalid"].includes(script.category),
    )
    .map(({ id, name, category, reason, selected, disabled }) => ({
      id,
      name,
      category,
      reason,
      selected,
      originalEnabled: !disabled,
      selectable: category === "active",
      type: "regex",
    }));
}

function depthAllowed(script, depth) {
  if (!Number.isFinite(depth)) return true;
  if (script.minDepth !== null && depth < script.minDepth) return false;
  if (script.maxDepth !== null && script.maxDepth >= 0 && depth > script.maxDepth) {
    return false;
  }
  return true;
}

function renderRegexReplacement(script, match, captures, groups, options) {
  const trimStrings = script.trimStrings.map((value) => applyMacros(value, options));
  const cleanCapture = (value) => {
    let result = String(value ?? "");
    trimStrings.forEach((trim) => {
      if (trim) result = result.split(trim).join("");
    });
    return result;
  };
  const token = "\u0000DOLLAR\u0000";
  return applyMacros(script.replaceString, options)
    .replace(/\{\{match\}\}/gi, "$0")
    .replace(/\$\$/g, token)
    .replace(/\$&|\$0|\$(\d+)|\$<([^>]+)>/g, (placeholder, number, groupName) => {
      if (placeholder === "$&" || placeholder === "$0") return cleanCapture(match);
      if (number) return cleanCapture(captures[Number(number) - 1]);
      return cleanCapture(groups?.[groupName]);
    })
    .replaceAll(token, "$");
}

export function applyPresetRegex(text, preset, options = {}) {
  if (!preset?.regexScripts || options.enabled === false) return String(text || "");
  let output = String(text || "");
  if (!output || output.length > MAX_REGEX_INPUT_LENGTH) return output;

  const placement = Number(options.placement);
  const phase = options.phase === "output" ? "output" : "prompt";
  for (const script of preset.regexScripts) {
    if (
      script.category !== "active" ||
      script.selected === false ||
      !script.placement.includes(placement)
    ) {
      continue;
    }
    if (!depthAllowed(script, Number(options.depth))) continue;
    const applies =
      phase === "prompt"
        ? script.promptOnly || (!script.promptOnly && !script.markdownOnly)
        : script.promptOnly || script.markdownOnly || (!script.promptOnly && !script.markdownOnly);
    if (!applies) continue;

    const regex = parseRegexLiteral(script.findRegex, {
      ...options,
      substituteRegex: script.substituteRegex,
    });
    if (!regex) continue;
    try {
      output = output.replace(regex, (match, ...args) => {
        const maybeGroups = args.at(-1);
        const groups =
          maybeGroups && typeof maybeGroups === "object" ? maybeGroups : undefined;
        const captures = args.slice(0, groups ? -3 : -2);
        return renderRegexReplacement(script, match, captures, groups, options);
      });
    } catch {
      // A malformed imported script should never stop the conversion.
    }
  }
  return output;
}
