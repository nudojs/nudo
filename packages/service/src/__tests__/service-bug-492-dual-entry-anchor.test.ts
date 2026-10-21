/**
 * Bug 492：nudo:dual-entry 的位置硬编码 line: 0 / column: 0。
 *
 * 后果（产品面）：
 * - `nudo check --json` → `"line": 0`
 * - `nudo check --gitlab` → `"lines": {"begin": 0}`（GitLab 要求 ≥ 1）
 * - `nudo check --gha` → 注解 `line=0`（GHA 要求 ≥ 1）
 * - 人面 → `[INFO L0]`
 *
 * 修法（service 侧）：dual-entry 是**包级事实**，观察单位是「这个入口文件整体」，
 * 锚点落在被分析入口文件的**首行**（1 基行号 / 0 基列号，与 CheckIssue 的 Babel
 * 口径一致）。下游 `i.line ?? 1` 的文件级兜底同口径，不需再换算。
 *
 * 负控制：单入口包 / 非入口文件仍然零 issue（位置修复不得放宽触发面）。
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { entryVariantIssueForFile } from "../entry-variants.ts";
import { analyzeFile } from "../analyzer.ts";
import { tmpProject } from "./tmp-project.ts";

const DUAL = {
  name: "dual-anchor",
  exports: {
    ".": {
      browser: "./browser.js",
      node: "./node.js",
      default: "./node.js",
    },
  },
};
const SRC = `export function id(x) { return x; }\n`;

describe("Bug 492 — dual-entry issue anchor is a legal, real position", () => {
  it("anchors the dual-entry issue on line 1 (not the line-0 placeholder)", () => {
    const dir = tmpProject("nudo-bug492-", {
      "package.json": JSON.stringify(DUAL),
      "browser.js": SRC,
      "node.js": SRC,
    });
    const issue = entryVariantIssueForFile(join(dir, "browser.js"));
    expect(issue).not.toBeNull();
    expect(issue!.line).toBe(1);
    expect(issue!.line).toBeGreaterThanOrEqual(1);
    expect(issue!.column).toBeGreaterThanOrEqual(0);
    expect(issue!.code).toBe("nudo:dual-entry");
  });

  it("anchors the node face on line 1 too (both variants)", () => {
    const dir = tmpProject("nudo-bug492-", {
      "package.json": JSON.stringify(DUAL),
      "browser.js": SRC,
      "node.js": SRC,
    });
    const issue = entryVariantIssueForFile(join(dir, "node.js"));
    expect(issue).not.toBeNull();
    expect(issue!.line).toBe(1);
    expect(issue!.message).toContain("node");
  });

  it("keeps the legacy browser-field package shape anchored", () => {
    const dir = tmpProject("nudo-bug492-", {
      "package.json": JSON.stringify({
        name: "legacy-anchor",
        main: "./node.js",
        browser: "./browser.js",
      }),
      "browser.js": SRC,
      "node.js": SRC,
    });
    const issue = entryVariantIssueForFile(join(dir, "browser.js"));
    expect(issue).not.toBeNull();
    expect(issue!.line).toBe(1);
  });

  it("negative control: single-entry package still yields no issue at all", () => {
    const dir = tmpProject("nudo-bug492-", {
      "package.json": JSON.stringify({ name: "single-anchor", main: "./index.js" }),
      "index.js": SRC,
    });
    expect(entryVariantIssueForFile(join(dir, "index.js"))).toBeNull();
  });

  it("negative control: non-entry helper inside a dual package yields no issue", () => {
    const dir = tmpProject("nudo-bug492-", {
      "package.json": JSON.stringify(DUAL),
      "browser.js": SRC,
      "node.js": SRC,
      "lib/helper.js": SRC,
    });
    expect(entryVariantIssueForFile(join(dir, "lib", "helper.js"))).toBeNull();
  });
});

describe("Bug 492 — eval 通道（analyzer 诊断面）也必须是合法行号", () => {
  it("analyzeFile 的 dual-entry 诊断落在第 1 行（不是 line 0 占位）", () => {
    const dir = tmpProject("nudo-bug492-eval-", {
      "package.json": JSON.stringify(DUAL),
      "browser.js": SRC,
      "node.js": SRC,
    });
    const r = analyzeFile(join(dir, "browser.js"), SRC);
    const d = r.diagnostics.find((x) => x.code === "nudo:dual-entry");
    expect(d).toBeDefined();
    expect(d!.range.start.line).toBeGreaterThanOrEqual(1);
    expect(d!.range.start.line).toBe(1);
    expect(d!.range.start.column).toBeGreaterThanOrEqual(0);
  });
});
