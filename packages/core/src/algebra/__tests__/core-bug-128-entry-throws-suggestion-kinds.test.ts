/**
 * BUG-128：`nudo:entry-may-throw` 的建议只点名剩余效果里的**第一条** kind
 * ⇒ 照建议声明（`@nudo:throws TypeError`）诊断原样保留（建议不可执行），
 * LSP `[silence]` 一键 quickfix 插入的正是这条无效声明（假修复按钮）。
 *
 * 门禁按**并集**判定（`gateDisplay` = `Error`），建议却只给 `TypeError`
 * ⇒ 同一诊断块内两行互相矛盾。
 *
 * 钉：建议里的 `@nudo:throws X` 必须**声明后诊断消失**（多 kind 场景给
 * `Error`——与门禁展示同口径）；单 kind 场景仍给具体 kind。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { resetCheckSourceMemo } from "../check.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { takeInterfaceDiags } from "../interface.ts";
import { takeRefineDiags } from "../refine.ts";

function check(src: string) {
  return checkSource("/t/risky.js", src, pTrue, {});
}

const BODY = `
export function risky(x) {
  if (x > 0) throw new Error("boom");
  return x;
}
`;

/** 建议行里给出的声明 kind（`@nudo:throws X`） */
function suggestedKind(suggestion: string | undefined): string | undefined {
  return suggestion?.match(/@nudo:throws\s+([A-Za-z][A-Za-z ,]*?)(?:\s{2,}|\s*\|)/)?.[1]?.trim();
}

describe("BUG-128 may-throw 建议必须与门禁判定同源", () => {
  beforeEach(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeInterfaceDiags();
    takeRefineDiags();
  });

  it("剩余效果 kind 不唯一 ⇒ 建议给门禁要求的族（Error），不是第一条 TypeError", () => {
    const r = check(BODY);
    const issue = r.issues.find((i) => i.code === "nudo:entry-may-throw");
    expect(issue).toBeDefined();
    expect(issue!.message).toContain("may throw Error");
    const kind = suggestedKind(issue!.suggestion);
    expect(kind).toBe("Error");
    // 与 actual: 行同口径（同一个 kind 集合）
    expect(issue!.actual).toContain("throws Error");
  });

  it("照建议声明 ⇒ 诊断消失（建议可执行）", () => {
    const r = check(`
/**
 * @nudo:throws Error
 */
export function risky(x) {
  if (x > 0) throw new Error("boom");
  return x;
}
`);
    expect(r.issues.filter((i) => i.code === "nudo:entry-may-throw")).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("单 kind 场景仍给具体 kind（不无脑折成 Error）", () => {
    const r = check(`
export function risky(x) {
  if (x > 0) throw new TypeError("boom");
  return x;
}
`);
    const issue = r.issues.find((i) => i.code === "nudo:entry-may-throw");
    expect(issue).toBeDefined();
    expect(suggestedKind(issue!.suggestion)).toBe("TypeError");
  });
});
