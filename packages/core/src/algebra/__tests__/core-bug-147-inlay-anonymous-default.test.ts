/**
 * BUG-147 —— LSP `textDocument/inlayHint` 对**匿名 default 导出**
 * （`export default (a) => …`）整段消失，而同文件 codeLens 却有类型 ⇒ inlay
 * 面自述的「枚举必须与导出面同口径」不变量被破。
 *
 * 根因：`inlay.ts` 的 `visitDecl` 只认 FunctionDeclaration / ClassDeclaration /
 * VariableDeclaration ⇒ 裸 ArrowFunctionExpression / FunctionExpression 全都
 * 不匹配 ⇒ 被丢弃。
 *
 * 本钉：匿名 default 形态也要有返回 inlay。
 */
import { describe, it, expect } from "vitest";
import { collectAbsInlays } from "../inlay.ts";

const returnInlays = (src: string) =>
  collectAbsInlays(src, { fromFile: "/test/file.js" }).filter((i) => i.kind === "type");

describe("BUG-147 — 匿名 default 导出的返回 inlay 不得消失", () => {
  it("`export default (a) => a + 1` 有返回 inlay", () => {
    const inlays = returnInlays(`export default (a) => a + 1;\n`);
    expect(inlays.length).toBe(1);
    expect(inlays[0]!.label).toContain("a + 1");
  });

  it("`export default function (a) { … }`（匿名函数表达式）有返回 inlay", () => {
    const inlays = returnInlays(`export default function (a) {\n  return a + 1;\n}\n`);
    expect(inlays.length).toBe(1);
    expect(inlays[0]!.label).toContain("a + 1");
  });

  it("对照：具名 default 导出仍有一条 inlay（不回退）", () => {
    const inlays = returnInlays(`export default function named(a) {\n  return a + 1;\n}\n`);
    expect(inlays.length).toBe(1);
    expect(inlays[0]!.label).toContain("a + 1");
  });
});
