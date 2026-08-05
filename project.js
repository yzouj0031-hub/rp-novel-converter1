const PROJECT_VERSION = 1;

function cleanOutput(output) {
  return {
    body: String(output?.body || "").trim(),
    messageCount: Math.max(0, Number(output?.messageCount) || 0),
    characterCount: Math.max(0, Number(output?.characterCount) || String(output?.body || "").length),
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
