/**
 * Bug 655 —— LSP agent 工具 `nudo/suggestCase` 的建议：**名字**与**期望**。
 *
 * 报告原文：`nudo/suggestCase` 把**合成 case 的原名**（`call@L<n>`）原样写进
 * 建议文本 ⇒ ① 建议落进引擎的「合成 / 固化」名字空间（`call@` / `entry@`）；
 * ② 用户照建议原样贴回源码 ⇒ 与 `--freeze` 固化的见证**重复**（同一个调用点
 * 留下两条见证）。
 *
 * ⚠ 勘误：报告断言的「贴回后零断言、期望永不被判定」**已不复现** —— 引擎侧
 * 的「按名字前缀降级」已被族 14/15（Bug 651）修掉（判据改成**来源**
 * `c.source !== "directive"`）⇒ 贴回后是**声明 case**（进断言面、但没写
 * `=> expected` ⇒ `unchecked`）。**本钉只钉工具侧这一面**：
 * ① 建议里的 case 名**不在** `call@` / `entry@` 合成 / 冻结名字空间；
 * ② 建议**带** `=> expected` ⇒ 贴回后真的产生断言（进断言面、不是 `unchecked`）。
 *
 * 夹具走**内存源码**（`params.source`）——与同族 `lsp-bug-759-*` 钉同款；
 * `helpers.ts` 的 tmpdir 脚手架对本钉无用（不需要落盘），故不复制脚手架。
 */
import { describe, it, expect } from "vitest";
import { analyzeFileAsync, buildTestReport } from "@nudojs/service";
import { suggestCase } from "../agent-tools.ts";

/** 夹具：顶层调用点 ⇒ 分析器合成一条 `call@L<n>` 见证。 */
const SRC = [
  "export function greet(name) {",
  '  return "hi " + name;',
  "}",
  'const r = greet("bob");',
  "console.log(r);",
  "",
].join("\n");

const FILE = "/t/bug-655-greet.js";

/** 合成 / 固化见证的名字空间前缀（`call@` = service 侧 `GENERATED_PREFIX`；
 *  `entry@` = 入口兜底见证）——手写见证名一律避开。 */
const SYNTHETIC_PREFIXES = ["call@", "entry@"];

/** 建议文本里的 case 名（`@nudo:case "<name>" (…)`）。 */
function suggestedNames(text: string): string[] {
  return [...text.matchAll(/@nudo:case "([^"]+)"/g)].map((m) => m[1]!);
}

/** 建议文本里的指令行（`@nudo:case "…" (…) [=> expected]`）。 */
function suggestedDirectives(text: string): string[] {
  return text
    .split("\n")
    .filter((l) => l.trim().startsWith("* @nudo:case"))
    .map((l) => l.trim().replace(/^\*\s*/, ""));
}

/** 建议文本里的 JSDoc 块（`/** … *\/`）——可直接贴回源码。 */
function suggestedBlock(text: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.trim() === "/**");
  const end = lines.findIndex((l, i) => i > start && l.trim() === "*/");
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return lines.slice(start, end + 1).join("\n");
}

async function suggestText(): Promise<string> {
  const r = await suggestCase(
    { file: FILE, functionName: "greet", source: SRC },
    { readFile: () => SRC },
  );
  return r.content[0]!.text;
}

describe("Bug 655 · suggestCase 建议的名字与期望", () => {
  it("建议里的 case 名不落在合成 / 冻结名字空间（改前是 call@L<n>）", async () => {
    const text = await suggestText();
    const names = suggestedNames(text);
    expect(names.length).toBe(1);
    for (const name of names) {
      for (const prefix of SYNTHETIC_PREFIXES) {
        expect(name.startsWith(prefix)).toBe(false);
      }
    }
    // 合成 case 的原名不得泄漏进建议（改前：`* @nudo:case "call@L4" ("bob")`）
    expect(text).not.toContain("call@L");
    for (const directive of suggestedDirectives(text)) {
      expect(directive).not.toContain("call@");
      expect(directive).not.toContain("entry@");
    }
  });

  it("建议带 `=> expected`（观测值）⇒ 贴回后真的产生断言，而不是 unchecked", async () => {
    const text = await suggestText();
    const directives = suggestedDirectives(text);
    expect(directives.length).toBe(1);
    expect(directives[0]).toMatch(/^@nudo:case "[^"]+" \(.*\) => .+$/);
  });

  it("把建议原样贴回源码 ⇒ 声明 case 进断言面并判 ok（passed 1 / failed 0 / unchecked 0）", async () => {
    const text = await suggestText();
    const pasted = `${suggestedBlock(text)}\n${SRC}`;
    const result = await analyzeFileAsync(FILE, pasted, undefined, undefined, undefined, "all");
    const report = buildTestReport(FILE, result);
    expect(report.passed).toBe(1);
    expect(report.failed).toBe(0);
    expect(report.unchecked).toBe(0);
    // 贴回的是**声明** case（不是合成观察）⇒ 不带 call@ / entry@ 前缀
    const declared = report.outcomes.filter((o) => !o.synthetic);
    expect(declared.length).toBe(1);
    expect(declared[0]!.caseName.startsWith("call@")).toBe(false);
    expect(declared[0]!.caseName.startsWith("entry@")).toBe(false);
    expect(declared[0]!.expected).toBeDefined();
  });

  it("同一份源码的建议名稳定（可重复贴回，不会每次换名）", async () => {
    const first = suggestedNames(await suggestText());
    const second = suggestedNames(await suggestText());
    expect(second).toEqual(first);
  });
});
