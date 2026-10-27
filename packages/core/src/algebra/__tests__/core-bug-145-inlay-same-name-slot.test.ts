/**
 * BUG-145 —— LSP `textDocument/inlayHint` 在**同名导出槽**下渲染**别的函数**
 * 的计算式（IDE 里显示文件里根本不存在的表达式）。
 *
 * 根因：`inlay.ts` 的 `listFunctions` 逐节点取锚点，取值却走
 * `generalizeFromAst(name, …)`（`env.fns` 按名唯一）⇒ 同名槽下标签与锚点
 * 来自不同函数。
 *
 * 本钉：同名槽**不产 inlay**（宁可少一条提示，也不渲染别人的计算式）；
 * 不同名的对照仍正常。
 */
import { describe, it, expect } from "vitest";
import { collectAbsInlays, type AbsInlay } from "../inlay.ts";

const CJS_SAME_NAME = `function f(a) {
  return a + 1;
}
exports.f = function (b) {
  return "S" + b;
};
`;

const CJS_DIFF_NAME = `function f(a) {
  return a + 1;
}
exports.g = function (b) {
  return "S" + b;
};
`;

const returnLabels = (inlays: AbsInlay[]): string[] =>
  inlays.filter((i) => i.kind === "type").map((i) => i.label);

describe("BUG-145 — 同名导出槽不得串位渲染", () => {
  it("同名槽（`function f` + `exports.f`）不产返回 inlay（不渲染别的函数计算式）", () => {
    const labels = returnLabels(collectAbsInlays(CJS_SAME_NAME));
    // 文件里只有 `a + 1` 与 `"S" + b` —— `b + 1` 不存在
    expect(labels.join("\n")).not.toContain("b + 1");
    expect(labels).toEqual([]);
  });

  it("对照：改导出名后两条 inlay 都在，且各自是本函数的计算式", () => {
    const labels = returnLabels(collectAbsInlays(CJS_DIFF_NAME));
    expect(labels.length).toBe(2);
    expect(labels.join("\n")).toContain("a + 1");
    expect(labels.join("\n")).not.toContain("b + 1");
  });

  it("类实例方法与静态方法同名 ⇒ 同样不产 inlay", () => {
    const src = `export class C {
  m(a: any) {
    return a + 1;
  }
  static m(b: any) {
    return b + 1;
  }
}
`;
    const labels = returnLabels(collectAbsInlays(src));
    expect(labels).toEqual([]);
  });
});
