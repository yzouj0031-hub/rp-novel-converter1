import test from "node:test";
import assert from "node:assert/strict";

import { parseChatExport, removeOoc, renderChat } from "../parser.js";

const jsonl = [
  JSON.stringify({
    user_name: "林",
    character_name: "沈砚",
    create_date: "2026-01-02",
    chat_metadata: {},
  }),
  JSON.stringify({
    name: "林",
    is_user: true,
    send_date: "2026-01-02T10:00:00Z",
    mes: "*推开门。*\n\n你在这里吗？",
  }),
  JSON.stringify({
    name: "沈砚",
    is_user: false,
    send_date: "2026-01-02T10:01:00Z",
    mes: "“一直都在。”\n(OOC: 这里先暂停)",
    swipes: ["旧回复", "“一直都在。”"],
    swipe_id: 1,
  }),
].join("\n");

test("parses SillyTavern JSONL metadata and messages", () => {
  const chat = parseChatExport(jsonl, "雨夜.jsonl");
  assert.equal(chat.messages.length, 2);
  assert.equal(chat.metadata.userName, "林");
  assert.equal(chat.metadata.characterName, "沈砚");
  assert.equal(chat.title, "雨夜");
  assert.equal(chat.messages[1].text, "“一直都在。”\n(OOC: 这里先暂停)");
});

test("filters common OOC forms conservatively", () => {
  const text = "正文\n(OOC: 备注)\n【OOC】测试\n((幕后交流))\n仍是正文";
  assert.equal(removeOoc(text), "正文\n仍是正文");
});

test("renders faithful transcript with aliases and optional timestamps", () => {
  const chat = parseChatExport(jsonl, "雨夜.jsonl");
  const output = renderChat(chat, {
    mode: "faithful",
    removeTimestamps: true,
    removeOoc: true,
    userAlias: "旅人",
  });
  assert.match(output.body, /【旅人】/);
  assert.match(output.body, /【沈砚】/);
  assert.doesNotMatch(output.body, /OOC/);
  assert.equal(output.messageCount, 2);
});

test("renders rule-based novel layout", () => {
  const chat = parseChatExport(jsonl, "雨夜.jsonl");
  const output = renderChat(chat, {
    mode: "novel",
    removeOoc: true,
    title: "港口雨夜",
  });
  assert.equal(output.title, "港口雨夜");
  assert.match(output.body, /^推开门。/);
  assert.match(output.body, /林：“你在这里吗？”/);
  assert.match(output.markdown, /^# 港口雨夜/);
});

test("parses wrapped JSON message arrays and OpenAI roles", () => {
  const input = JSON.stringify({
    messages: [
      { role: "user", content: "你好" },
      { role: "assistant", name: "阿澈", content: [{ type: "text", text: "晚上好。" }] },
    ],
  });
  const chat = parseChatExport(input, "chat.json");
  assert.equal(chat.messages.length, 2);
  assert.equal(chat.messages[0].role, "user");
  assert.equal(chat.messages[1].speaker, "阿澈");
});

test("reports invalid or empty exports", () => {
  assert.throws(() => parseChatExport("", "empty.json"), /空/);
  assert.throws(() => parseChatExport("{not json}", "bad.json"), /没有找到|不是有效/);
});

test("ignores placeholder metadata names and infers speakers", () => {
  const output = parseChatExport([
    JSON.stringify({ user_name: "unused", character_name: "unused" }),
    JSON.stringify({ name: "旅人", is_user: true, mes: "你好" }),
    JSON.stringify({ name: "沈砚", is_user: false, mes: "久等了" }),
  ].join("\n"));
  assert.equal(output.metadata.userName, "旅人");
  assert.equal(output.metadata.characterName, "沈砚");
});
