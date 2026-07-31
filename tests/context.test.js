import test from "node:test";
import assert from "node:assert/strict";

import {
  compileCharacterContext,
  compileReferenceContext,
  compileWorldContext,
  extractCharacterCardJsonFromPng,
  parseCharacterCardJson,
  parseWorldBookJson,
  worldEntryMatches,
} from "../context.js";

const cardObject = {
  spec: "chara_card_v2",
  data: {
    name: "沈砚",
    description: "黑衣剑客，与 {{user}} 同行。",
    personality: "寡言，但很可靠。",
    scenario: "二人正在云梦泽。",
    first_mes: "夜色已深。",
    system_prompt: "继续扮演角色。",
    character_book: {
      entries: [
        {
          id: 1,
          keys: ["云梦泽"],
          content: "云梦泽终年多雾。",
          enabled: true,
          constant: false,
        },
      ],
    },
    extensions: {
      regex_scripts: [
        {
          id: "clean",
          scriptName: "清理标签",
          findRegex: "/<tag>[\\s\\S]*?<\\/tag>/g",
          replaceString: "",
          placement: [2],
          disabled: false,
          promptOnly: true,
        },
      ],
    },
  },
};

test("parses V2 character cards with selectable sections and embedded data", () => {
  const card = parseCharacterCardJson(JSON.stringify(cardObject), "沈砚.json");
  assert.equal(card.name, "沈砚");
  assert.equal(card.sections.find((section) => section.id === "description").selected, true);
  assert.equal(card.sections.find((section) => section.id === "system_prompt").selected, false);
  assert.equal(card.worldBook.entries.length, 1);
  assert.equal(card.regexScripts[0].category, "active");
  assert.match(
    compileCharacterContext(card, { userName: "旅人" }),
    /黑衣剑客，与 旅人 同行/,
  );
});

test("extracts ccv3 or chara metadata from PNG tEXt chunks", () => {
  const json = JSON.stringify(cardObject);
  const keyword = Buffer.from("chara\0", "latin1");
  const payload = Buffer.from(json, "utf8").toString("base64");
  const data = Buffer.concat([keyword, Buffer.from(payload, "latin1")]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    length,
    Buffer.from("tEXt"),
    data,
    Buffer.alloc(4),
    Buffer.alloc(4),
    Buffer.from("IEND"),
    Buffer.alloc(4),
  ]);
  assert.equal(extractCharacterCardJsonFromPng(png), json);
});

test("activates world book entries by constants, primary and secondary keys", () => {
  const book = parseWorldBookJson(
    JSON.stringify({
      name: "云梦设定",
      entries: {
        0: { comment: "常识", content: "月亮从东方升起。", constant: true },
        1: { comment: "云梦泽", key: ["云梦泽"], content: "终年多雾。" },
        2: {
          comment: "神殿",
          key: ["神殿"],
          keysecondary: ["祭典", "巫祝"],
          selective: true,
          selectiveLogic: 3,
          content: "祭典在神殿举行。",
        },
      },
    }),
    "云梦设定.json",
  );
  assert.equal(worldEntryMatches(book.entries[0], "无关文本"), true);
  assert.equal(worldEntryMatches(book.entries[1], "回到云梦泽"), true);
  assert.equal(worldEntryMatches(book.entries[2], "神殿与祭典"), false);
  assert.equal(worldEntryMatches(book.entries[2], "巫祝在神殿举行祭典"), true);
  const compiled = compileWorldContext([book], "巫祝回到云梦泽的神殿举行祭典");
  assert.match(compiled, /月亮从东方升起/);
  assert.match(compiled, /终年多雾/);
  assert.match(compiled, /祭典在神殿举行/);
});

test("combines character and triggered world context without executing it", () => {
  const card = parseCharacterCardJson(JSON.stringify(cardObject), "沈砚.json");
  const reference = compileReferenceContext({
    card,
    worldBooks: [card.worldBook],
    text: "二人进入云梦泽。",
    userName: "旅人",
    characterName: "沈砚",
  });
  assert.match(reference, /寡言，但很可靠/);
  assert.match(reference, /云梦泽终年多雾/);
});
