/**
 * Bug 436：同一条「缺字段」违例被**上报两次**（`checkShapeReqs` + `checkReqs`
 * 两条并行通道各发一份）⇒ `nudo check` 的错误计数翻倍。
 *
 * 修法：「投影失败 → missing field」的报告**收敛到一处**——`checkReqs`
 * 独占（它对每条 req 都跑，`checkShapeReqs` 的闸门会跳过部分条目），
 * `checkShapeReqs` 的投影失败分支只 `continue`（不再自己发一份）。
 * 诊断文本不变（仍是 `missing field b`）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import type { CheckIssue } from "../check-report.ts";
import { sidecarOpts } from "./nudo-constraints.ts";

const NUDO_SRC = `
import { fn, number } from "@nudojs/core";
export const fObj = fn({ a: number(), b: number() }, number());
`;

const opts = sidecarOpts("core-bug-436.nudo.js", NUDO_SRC, "/t/core-bug-436.js");

function check(src: string) {
  return checkSource("/t/core-bug-436.js", src, pTrue, opts);
}

function violated(r: { issues: CheckIssue[] }) {
  return r.issues.filter((i) => i.code === "nudo:constraint-violated");
}

const DECL = `
export function fObj({ a, b }) {
  return a + b;
}
`;

describe("Bug 436：缺字段违例只报一次", () => {
  it("缺字段只产出 1 条诊断（不是 2 条）", () => {
    const r = check(`${DECL}\nfObj({ a: 1 });\n`);
    const v = violated(r);
    expect(v).toHaveLength(1);
    expect(String(v[0]!.expected)).toContain("missing field b");
  });

  it("诊断文本与去重前一致（missing field b）", () => {
    const r = check(`${DECL}\nfObj({ a: 1 });\n`);
    const v = violated(r);
    expect(v[0]!.message).toContain("fObj");
    expect(String(v[0]!.expected)).toBe("missing field b");
  });

  it("两条**不同**的违例各报一次（缺字段 + 类型违例）", () => {
    const r = check(`${DECL}\nfObj({ a: "x" });\n`);
    const texts = violated(r).map((i) => String(i.expected));
    // 缺字段：恰好一条（去重的核心断言）
    expect(texts.filter((t) => t.includes("missing field b"))).toHaveLength(1);
    // 字段类型违例：恰好一条（与缺字段是**不同**的违例，不该被合并）
    expect(texts.filter((t) => t.includes('typeof a = "number"'))).toHaveLength(1);
  });

  it("合规实参零诊断（去重没有把合法调用打成红）", () => {
    const r = check(`${DECL}\nfObj({ a: 1, b: 2 });\n`);
    expect(violated(r)).toEqual([]);
  });
});
