import test from "node:test";
import assert from "node:assert/strict";

import {
  parseStoredProject,
  updateWritingProject,
  writingProjectToOutput,
} from "../project.js";

const first = {
  title: "云梦旧事",
  body: "第一章正文。",
  messageCount: 10,
  characterCount: 6,
};

test("creates, updates and appends local writing chapters", () => {
  const project = updateWritingProject(null, first, { updatedAt: "2026-08-05T00:00:00Z" });
  assert.equal(project.chapters.length, 1);

  const revised = updateWritingProject(project, { ...first, body: "修订后的第一章。" });
  assert.equal(revised.chapters.length, 1);
  assert.equal(revised.chapters[0].body, "修订后的第一章。");

  const continued = updateWritingProject(revised, {
    title: "不应覆盖书名",
    body: "第二章正文。",
    messageCount: 8,
  }, { append: true });
  assert.equal(continued.title, "云梦旧事");
  assert.equal(continued.chapters.length, 2);

  const output = writingProjectToOutput(continued);
  assert.match(output.body, /第1章/);
  assert.match(output.body, /第2章/);
  assert.match(output.markdown, /## 第2章/);
  assert.equal(output.messageCount, 18);
});

test("validates stored local projects", () => {
  const project = updateWritingProject(null, first);
  assert.deepEqual(parseStoredProject(JSON.stringify(project)), project);
  assert.equal(parseStoredProject("{broken"), null);
  assert.equal(parseStoredProject(JSON.stringify({ version: 1, chapters: [] })), null);
});
