/**
 * BUG-138：`nudo:entry-may-throw` 的 ReferenceError 建议**无条件**断言
 * 「re-export `export { x } from` 不是局部绑定」，且标识符 `x` 是**硬编码**的：
 * - 对「未定义全局 / env 缺项 / 拼写错误」指错方向（文件里根本没有 re-export）；
 * - 即便真是 re-export 形态，点名的也未必是用户 re-export 的那个名字。
 *
 * 钉：建议点名**真实**的 re-export 本地名（`y`），且在**没有** re-export 的
 * 文件里**不**说 re-export；可执行半边（`@nudo:throws ReferenceError`）保留。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { resetCheckSourceMemo } from "../check.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { takeInterfaceDiags } from "../interface.ts";
import { takeRefineDiags } from "../refine.ts";

function suggestionOf(src: string): string {
  const r = checkSource("/t/r.js", src, pTrue, {});
  const issue = r.issues.find((i) => i.code === "nudo:entry-may-throw");
  expect(issue).toBeDefined();
  return issue!.suggestion ?? "";
}

describe("BUG-138 ReferenceError 建议的真实归因", () => {
  beforeEach(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeInterfaceDiags();
    takeRefineDiags();
  });

  it("文件里的 re-export 是 y ⇒ 建议点名 y（不再硬编码 x）", () => {
    const s = suggestionOf(`
export { y } from "./other.js";
export function f() {
  return y + 1;
}
`);
    expect(s).toContain("export { y } from");
    expect(s).toContain("import { y }");
    expect(s).not.toContain("import { x }");
  });

  it("没有 re-export 的文件（未定义全局）⇒ 不说 re-export", () => {
    const s = suggestionOf(`
export function f() {
  return totallyUndefinedGlobal(1);
}
`);
    expect(s).not.toContain("re-export");
    expect(s).not.toContain("import { x }");
    // 可执行半边仍在
    expect(s).toContain("@nudo:throws ReferenceError");
    expect(s).toContain("not bound");
  });

  it("两个文件的建议不同（旧口径逐字相同）", () => {
    const withReexport = suggestionOf(`
export { y } from "./other.js";
export function f() {
  return y + 1;
}
`);
    const undef = suggestionOf(`
export function f() {
  return totallyUndefinedGlobal(1);
}
`);
    expect(withReexport).not.toBe(undef);
  });
});
