/**
 * Bug 424 —— 函数级指令 scope **按名字查找 + 文档序首个命中**
 * ⇒ **遮蔽函数**偷走导出函数的 `@nudo:throws` ⇒ **L2 门禁假绿**。
 *
 * 根因（`directive-scan.ts` 的 `findFnDirectiveScope`）：scope 名**不唯一**
 * （同名遮蔽函数 / 嵌套同名函数），而消费口只按名字 + 文档序首个命中查找
 * ⇒ 内层 `f` 的 `@nudo:throws *` 被套到导出的 `f` 上 ⇒ 导出 `f` 的
 * `throw` 不再报 `nudo:entry-may-throw`（**假绿**）。
 *
 * 修法：scope 记**词法嵌套深度**（`depth`：顶层函数 / 类成员 = 0，每进入
 * 一层函数体 +1）；按名查找取**最浅**（depth 最小）的那个 ⇒ 与分析面
 * （顶层函数先登记、嵌套同名者跳过）的口径一致。
 */
import { describe, it, expect } from "vitest";
import {
  extractDeclaredThrows,
  findFnDirectiveScope,
  listFnDirectiveScopes,
  parseSource,
} from "../index.ts";
import { issuesOf, l2Count } from "./nudo-constraints.ts";

const SHADOW = `export function h() {
  /**
   * @nudo:throws *
   */
  function f() { return 1; }
  return f();
}

export function f() {
  throw new Error("boom");
}
`;

const CONTROL = `export function f() {
  throw new Error("boom");
}
`;

const SUPPRESSED = `/**
 * @nudo:throws *
 */
export function f() {
  throw new Error("boom");
}
`;

function scopesOf(src: string) {
  return listFnDirectiveScopes(parseSource(src));
}

describe("Bug 424 — 同名遮蔽：按名查找取最浅的 scope", () => {
  it("按名查找命中的是导出的 f（不是内层遮蔽的 f）", () => {
    const scope = findFnDirectiveScope(parseSource(SHADOW), "f");
    expect(scope?.commentLines ?? []).not.toContain("@nudo:throws *");
    // 导出的 f 在文件末尾（行号更大），内层遮蔽的 f 在前面
    const inner = scopesOf(SHADOW).filter((s) => s.name === "f");
    expect(inner.length).toBe(2);
    expect(inner[0].depth).toBe(1);
    expect(inner[1].depth).toBe(0);
    expect(scope?.startLine).toBe(inner[1].startLine);
  });

  it("内层遮蔽函数自己的 throws 仍在（只是不再顶替导出函数）", () => {
    const inner = scopesOf(SHADOW).filter((s) => s.name === "f");
    expect(inner[0].commentLines).toContain("@nudo:throws *");
  });

  it("导出 f 的 throws 声明为空（内层的不再顶替）", () => {
    expect(extractDeclaredThrows(SHADOW, "f")).toBeUndefined();
  });

  it("L2 门禁：导出 f 的 throw 重新被报出来（不再假绿）", () => {
    expect(l2Count(issuesOf(SHADOW, "/t/b424/shadow.js"), "f")).toBe(1);
  });

  it("对照：无遮蔽时行为不变（仍报 may-throw）", () => {
    expect(l2Count(issuesOf(CONTROL, "/t/b424/ctrl.js"), "f")).toBe(1);
  });

  it("对照：导出 f 自己声明 @nudo:throws * 时不报（抑制仍生效）", () => {
    expect(l2Count(issuesOf(SUPPRESSED, "/t/b424/sup.js"), "f")).toBe(0);
  });
});
