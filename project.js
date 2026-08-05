const PROJECT_VERSION = 1;

function cleanOutput(output) {
  return {
    body: String(output?.body || "").trim(),
    messageCount: Math.max(0, Number(output?.messageCount) || 0),
    characterCount: Math.max(0, Number(output?.characterCount) || String(output?.body || "").length),
  };
}

function normalizeMessage(message) {
  return [message?.role, message?.speaker, String(message?.text || "").replace(/\r\n?/g, "\n").trim()]
    .map((value) => String(value || ""))
    .join("\u241f");
}

function fnv1a64(value) {
  let hash = 0xcbf29ce484222325n;
  for (const character of value) {
    hash ^= BigInt(character.codePointAt(0));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

export function chatMessageFingerprints(chat) {
  return (chat?.messages || []).map((message) => fnv1a64(normalizeMessage(message)));
}

export function projectSourceFingerprints(project) {
  return (project?.chapters || []).flatMap((chapter) =>
    Array.isArray(chapter?.sourceFingerprints) ? chapter.sourceFingerprints : [],
  );
}

export function findHistoryOverlap(processed, incoming) {
  const limit = Math.min(processed?.length || 0, incoming?.length || 0);
  for (let size = limit; size > 0; size -= 1) {
    let matches = true;
    for (let index = 0; index < size; index += 1) {
      if (processed[processed.length - size + index] !== incoming[index]) {
        matches = false;
        break;
      }
    }
    if (matches) return size;
  }
  return 0;
}

export function sliceContinuationChat(chat, project) {
  const incoming = chatMessageFingerprints(chat);
  const processed = projectSourceFingerprints(project);
  const skipped = findHistoryOverlap(processed, incoming);
  return {
    chat: { ...chat, messages: chat.messages.slice(skipped) },
    fingerprints: incoming.slice(skipped),
    skipped,
    incomingCount: incoming.length,
  };
}

export function updateWritingProject(project, output, options = {}) {
  const cleaned = cleanOutput(output);
  if (!cleaned.body) throw new Error("没有可保存的正文。");

  const existing = project?.version === PROJECT_VERSION && Array.isArray(project.chapters)
    ? project
    : null;
  const append = options.append === true && existing?.chapters.length;
  const chapters = existing ? existing.chapters.map((chapter) => ({ ...chapter })) : [];
  const chapter = {
    number: append ? chapters.length + 1 : Math.max(1, chapters.length || 1),
    body: cleaned.body,
    messageCount: cleaned.messageCount,
    characterCount: cleaned.characterCount,
    sourceFingerprints: Array.isArray(options.sourceFingerprints)
      ? [...options.sourceFingerprints]
      : append
        ? []
        : chapters[chapters.length - 1]?.sourceFingerprints || [],
  };

  if (append) chapters.push(chapter);
  else if (chapters.length) chapters[chapters.length - 1] = { ...chapter, number: chapters.length };
  else chapters.push(chapter);

  return {
    version: PROJECT_VERSION,
    title: String(existing?.title || output?.title || "未命名故事").trim() || "未命名故事",
    chapters,
    updatedAt: options.updatedAt || new Date().toISOString(),
  };
}

export function writingProjectToOutput(project) {
  if (!project?.chapters?.length) return null;
  const title = String(project.title || "未命名故事").trim() || "未命名故事";
  const body = project.chapters
    .map((chapter, index) => `第${index + 1}章\n\n${String(chapter.body || "").trim()}`)
    .join("\n\n\n");
  const messageCount = project.chapters.reduce(
    (sum, chapter) => sum + (Number(chapter.messageCount) || 0),
    0,
  );
  return {
    title,
    body,
    text: `${title}\n${"—".repeat(Math.min(12, Math.max(4, title.length)))}\n\n${body}`,
    markdown: `# ${title}\n\n${project.chapters
      .map((chapter, index) => `## 第${index + 1}章\n\n${String(chapter.body || "").trim()}`)
      .join("\n\n")}\n`,
    messageCount,
    characterCount: body.length,
    chapterCount: project.chapters.length,
  };
}

export function parseStoredProject(value) {
  let project;
  try {
    project = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return null;
  }
  if (
    project?.version !== PROJECT_VERSION ||
    typeof project.title !== "string" ||
    !Array.isArray(project.chapters) ||
    !project.chapters.length ||
    project.chapters.some((chapter) => typeof chapter?.body !== "string" || !chapter.body.trim())
  ) {
    return null;
  }
  return project;
}
