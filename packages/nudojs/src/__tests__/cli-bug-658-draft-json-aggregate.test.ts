/**
 * Bug 658 —— `nudo contract <目录> --draft --json` 的 stdout 是 **N 份 JSON 拼接**
 * （`JSON.parse` 抛 "Unexpected non-whitespace character after JSON"）。
 *
 * 根因：JSON 出口是**单文档**（每个 root 一次 `console.log`），而命令层对每个
 * root 各跑一次 ⇒ **没有跨文件聚合层**。
 *
 * 修法（族 20 · 片 A）：命令层加**跨文件聚合层** ⇒ 收集所有 root 的机器文档后
 * **一次**打印；**单文件也走同一路径** ⇒ 顶层恒为**数组**（单文件 = 单元素数组）。
 *
 * ⚠ 本钉同时锁住 **print 分支**（`nudo contract --json <目录>`）：改前它同样
 * 是多份 JSON 拼接（报告标题只写了 `--draft --json`，实测 print 分支也拼）。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliNode as runCli } from "./helpers/run-cli.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-658-"));
  writeFileSync(join(dir, "a.js"), "export function one() { return 1; }\n", "utf-8");
  writeFileSync(join(dir, "b.js"), "export function two() { return 2; }\n", "utf-8");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

type JsonEntry = {
  file?: string;
  entries?: { fn: string }[];
  draftPath?: string;
  draftSource?: string;
  diff?: string;
};

describe("Bug 658 —— contract --json 的 stdout 必须是**一份** JSON（跨文件聚合）", () => {
  it("目录 + --draft --json：stdout 可被 JSON.parse 解析（改前抛）", () => {
    const r = runCli(["contract", ".", "--draft", "--json"], { cwd: dir });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    let parsed: JsonEntry[];
    expect(() => {
      parsed = JSON.parse(r.stdout) as JsonEntry[];
    }).not.toThrow();
    const docs = parsed!;
    // 顶层恒为数组（形态恒定）
    expect(Array.isArray(docs)).toBe(true);
    expect(docs).toHaveLength(2);
    expect(docs.map((d) => d.file).sort()).toEqual(["a.js", "b.js"]);
    for (const d of docs) {
      expect(typeof d.draftSource).toBe("string");
      expect(typeof d.draftPath).toBe("string");
      expect(typeof d.diff).toBe("string");
      expect(Array.isArray(d.entries)).toBe(true);
    }
  });

  it("目录 + --json（print 分支）：同样是一份 JSON 数组（改前是多份拼接）", () => {
    const r = runCli(["contract", ".", "--json"], { cwd: dir });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    const docs = JSON.parse(r.stdout) as JsonEntry[];
    expect(Array.isArray(docs)).toBe(true);
    expect(docs).toHaveLength(2);
    expect(docs.map((d) => d.file).sort()).toEqual(["a.js", "b.js"]);
    expect(docs.map((d) => d.entries?.map((e) => e.fn)).flat().sort()).toEqual(["one", "two"]);
  });

  it("单文件 + --json：顶层仍是数组（单元素）⇒ 形态恒定", () => {
    const r = runCli(["contract", "a.js", "--json"], { cwd: dir });
    expect(r.status).toBe(0);
    const docs = JSON.parse(r.stdout) as JsonEntry[];
    expect(Array.isArray(docs)).toBe(true);
    expect(docs).toHaveLength(1);
    expect(docs[0].file).toBe("a.js");
    expect(docs[0].entries?.map((e) => e.fn)).toEqual(["one"]);
  });

  it("单文件 + --draft --json：顶层仍是数组（单元素）⇒ 形态恒定", () => {
    const r = runCli(["contract", "a.js", "--draft", "--json"], { cwd: dir });
    expect(r.status).toBe(0);
    const docs = JSON.parse(r.stdout) as JsonEntry[];
    expect(Array.isArray(docs)).toBe(true);
    expect(docs).toHaveLength(1);
    expect(docs[0].file).toBe("a.js");
    expect(docs[0].draftSource).toContain("// @nudo:draft");
  });

  it("非 --json 面不受影响（人类面仍是逐文件文本，不是 JSON）", () => {
    const r = runCli(["contract", "."], { cwd: dir });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("a.js");
    expect(r.stdout).toContain("one");
    expect(() => JSON.parse(r.stdout)).toThrow();
  });
});
