/**
 * Bug 743 —— 侧车 quickfix 的 edit **退化成头插**（`0:0 → 0:0`）⇒ 落盘后侧车
 * 出现重复 `export const <fn>` ⇒ 侧车整体 SyntaxError ⇒ 侧车里**所有**契约
 * 一起失效（`nudo:interface-load`）⇒ 门禁从「有诊断」变成「装载失败」。
 *
 * 根因与 Bug 735 同源：`agentToolDeps` 被提前捕获（挂载期还是 `undefined`）
 * ⇒ 侧车文本读不到 ⇒ `scSource` 退化成 `""` ⇒ edit 范围只剩头插一行。
 *
 * 钉：
 * 1. 侧车 edit 必须**覆盖既有侧车全文**（追加语义：既有导出仍在）；
 * 2. 落盘后的侧车**可加载**（无重复 export ⇒ 语法合法）；
 * 3. 会写出**重复 export** 的计划**不下发**（宁可少一个 action）。
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { parse } from "@nudojs/parser";
import { checkSource } from "@nudojs/core";
import { defaultLoadModule } from "@nudojs/service";
import {
  applyEdits,
  codeActionParams,
  entryMayThrowDiag,
  mountCodeActions,
  sidecarEdits,
} from "./lsp-bug-r90a-harness.ts";
import { withTempDir } from "./helpers.ts";

const LIB_JS = `export function alpha(x) {
  return x.toFixed(2);
}

export function beta(y) {
  return y + 1;
}
`;
/** 侧车里**已有** alpha 契约 ⇒ 追加同名导出会重复 */
const LIB_SC_WITH_ALPHA = `import { fn, any, number, string, shape } from "@nudojs/core";

export const alpha = fn({ x: any() }, any());
export const beta = fn({ y: string() }, number());
`;
/** 侧车里**没有** alpha 契约 ⇒ 追加是合法的 */
const LIB_SC_WITHOUT_ALPHA = `import { fn, any, number, string, shape } from "@nudojs/core";

export const beta = fn({ y: string() }, number());
`;

describe("Bug 743 · 侧车 quickfix 不得把侧车写成重复 export", () => {
  it("侧车已有该 fn 的契约 ⇒ 不下发会写坏侧车的计划", () => {
    withTempDir("nudo-lsp-743-", (dir) => {
      writeFileSync(join(dir, "lib.js"), LIB_JS, "utf-8");
      writeFileSync(join(dir, "lib.nudo.js"), LIB_SC_WITH_ALPHA, "utf-8");
      const uri = `file://${join(dir, "lib.js")}`;
      const handler = mountCodeActions(uri, LIB_JS);
      const actions = handler(
        codeActionParams(uri, 0, [entryMayThrowDiag(0, 7, { fn: "alpha" })]),
      );
      expect(sidecarEdits(actions, uri)).toHaveLength(0);
    });
  });

  it("侧车缺该 fn 的契约 ⇒ edit 覆盖既有侧车全文，既有导出仍在且可加载", () => {
    withTempDir("nudo-lsp-743b-", (dir) => {
      const libPath = join(dir, "lib.js");
      writeFileSync(libPath, LIB_JS, "utf-8");
      writeFileSync(join(dir, "lib.nudo.js"), LIB_SC_WITHOUT_ALPHA, "utf-8");
      const uri = `file://${libPath}`;
      const handler = mountCodeActions(uri, LIB_JS);
      const actions = handler(
        codeActionParams(uri, 0, [entryMayThrowDiag(0, 7, { fn: "alpha" })]),
      );
      const edits = sidecarEdits(actions, uri);
      expect(edits.length).toBe(1);
      const e = edits[0]!;
      // 覆盖既有侧车全文（不是 0:0 → 0:0 的头插）
      expect(e.range.start).toEqual({ line: 0, character: 0 });
      expect(e.range.end.line).toBeGreaterThan(0);
      // 既有导出仍在（追加语义）
      expect(e.newText).toContain("export const beta = fn({ y: string() }, number());");
      const landed = applyEdits(LIB_SC_WITHOUT_ALPHA, edits);
      expect(landed).toContain("export const beta");
      expect(landed).toContain("export const alpha");
      // 没有重复 export ⇒ 语法合法（可加载）
      expect(() => parse(landed)).not.toThrow();
      // 语义面：侧车装载失败会报 nudo:interface-load ⇒ 这里不得出现
      writeFileSync(join(dir, "lib.nudo.js"), landed, "utf-8");
      const report = checkSource(libPath, LIB_JS, undefined, {
        loadModule: defaultLoadModule,
      });
      expect(report.issues.map((i) => i.code)).not.toContain("nudo:interface-load");
    });
  });
});
