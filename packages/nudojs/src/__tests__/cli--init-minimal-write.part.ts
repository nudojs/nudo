/**
 * Bug 681 — `nudo init` 整文件重写：**缩进被规范化成 2 空格**、**整数样键
 * 被重排**、**尾换行被强制添加** ⇒ 写盘保真度被破坏（非目标键的字节变了）。
 *
 * 改前：`JSON.parse` → 改对象 → `JSON.stringify(pkg, null, 2)` 整份重写。
 * 改后：**最小改动**——在原文本上定位顶层 `nudo` 键并插入/替换，其余字节
 * 逐字保留（缩进单位 / 冒号后空格 / 键序 / 换行风格 / 尾换行状态）。
 *
 * 反向闸：换回 HEAD 只读副本 ⇒ 「4 空格缩进逐字保留」「整数样键顺序不变」
 * 「尾换行状态不变」三条断言**必红**（HEAD 全部规范化成 2 空格 + 重排 +
 * 补尾换行）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../commands/init.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function pkgDir(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-cli-bug-681-"));
  dirs.push(dir);
  writeFileSync(join(dir, "package.json"), content, "utf-8");
  return dir;
}

const io = { out: () => {}, err: () => {} };

describe("Bug 681 — init 写盘只改目标键（最小改动）", () => {
  it("4 空格缩进 + 无尾换行 ⇒ 缩进与尾换行状态逐字保留，只多出 nudo 成员", () => {
    const before = '{\n    "name": "s1",\n    "version": "1.0.0"\n}';
    const dir = pkgDir(before);
    expect(runInit(dir, io)).toBe(0);
    const written = readFileSync(join(dir, "package.json"), "utf-8");
    expect(written).toBe(
      '{\n    "name": "s1",\n    "version": "1.0.0",\n    "nudo": {\n        "check": {\n            "profile": "adoption"\n        }\n    }\n}',
    );
    // 非目标键的字节逐字不变（把新插入的成员切掉 ⇒ 与原文件相同）
    expect(written.replace(/,\n {4}"nudo": \{[\s\S]*?\n {4}\}\n\}$/, "\n}")).toBe(before);
    expect(written.endsWith("\n")).toBe(false);
  });

  it("整数样键的相对顺序不变（JSON.parse 会把它们重排）", () => {
    const dir = pkgDir('{\n  "name": "s2",\n  "2": "two",\n  "1": "one",\n  "10": "ten",\n  "b": true\n}\n');
    expect(runInit(dir, io)).toBe(0);
    const written = readFileSync(join(dir, "package.json"), "utf-8");
    const order = written
      .split("\n")
      .filter((l) => /^ {2}"/.test(l))
      .map((l) => /^ {2}"([^"]+)"/.exec(l)![1]);
    expect(order).toEqual(["name", "2", "1", "10", "b", "nudo"]);
    // 原文件的键序字节不变
    expect(written.startsWith('{\n  "name": "s2",\n  "2": "two",\n  "1": "one",\n  "10": "ten",\n  "b": true,\n')).toBe(
      true,
    );
  });

  it("紧凑单行文件 ⇒ 保持紧凑（不引入换行）", () => {
    const dir = pkgDir('{"name":"up"}');
    expect(runInit(dir, io)).toBe(0);
    const written = readFileSync(join(dir, "package.json"), "utf-8");
    expect(written).toBe('{"name":"up","nudo":{"check":{"profile":"adoption"}}}');
  });

  it("已有 nudo 键（形状非法）⇒ 只替换它的值，其余字节不动", () => {
    const before = '{\n  "name": "x",\n  "nudo": null,\n  "version": "1.0.0"\n}\n';
    const dir = pkgDir(before);
    expect(runInit(dir, io)).toBe(0);
    const written = readFileSync(join(dir, "package.json"), "utf-8");
    expect(written).toBe(
      '{\n  "name": "x",\n  "nudo": {\n    "check": {\n      "profile": "adoption"\n    }\n  },\n  "version": "1.0.0"\n}\n',
    );
  });
});
