/**
 * Bug 730 —— A6「Add missing field 'X' to call」把**待填占位符** `undefined`
 * 当成合法值写进调用点（` ${field}: undefined `）。
 *
 * 占位符不是值：它被写进用户的源码后，「字段缺失」这条违规要么被整条跳过
 * （假绿），要么被换成一条别的诊断（用户拿到的是 `undefined` 而不是自己写的
 * 值）。⇒ 钉：
 * 1. 调用点的插入文本**不得**是 `undefined`；
 * 2. 应用 quickfix 后，**该违规仍被报出**（门禁不许被这个 quickfix 变绿）。
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { checkSource } from "@nudojs/core";
import { defaultLoadModule } from "@nudojs/service";
import {
  applyEdits,
  codeActionParams,
  docEdits,
  missingFieldDiag,
  mountCodeActions,
} from "./lsp-bug-r90a-harness.ts";
import { withTempDir } from "./helpers.ts";

const GREET_JS = `export function greet(u) {
  return u.name + "!";
}

greet({ id: 2 });
`;
const GREET_SC = `import { fn, shape, string } from "@nudojs/core";

export const greet = fn({ u: shape({ name: string() }) }, string());
`;

describe("Bug 730 · 补字段 quickfix 不得把 undefined 当值写进调用点", () => {
  it("插入文本不是 undefined（占位不是值）", () => {
    withTempDir("nudo-lsp-730-", (dir) => {
      writeFileSync(join(dir, "greet.js"), GREET_JS, "utf-8");
      writeFileSync(join(dir, "greet.nudo.js"), GREET_SC, "utf-8");
      const uri = `file://${join(dir, "greet.js")}`;
      const handler = mountCodeActions(uri, GREET_JS);
      const actions = handler(codeActionParams(uri, 4, [missingFieldDiag(4)]));
      const edits = docEdits(actions, uri);
      expect(edits.length).toBeGreaterThan(0);
      for (const e of edits) {
        expect(e.newText).not.toContain("undefined");
        expect(e.newText).toContain("name:");
      }
    });
  });

  it("应用后源码可编译，且该违规仍被报出（门禁不被 quickfix 变绿）", () => {
    withTempDir("nudo-lsp-730b-", (dir) => {
      const srcPath = join(dir, "greet.js");
      writeFileSync(srcPath, GREET_JS, "utf-8");
      writeFileSync(join(dir, "greet.nudo.js"), GREET_SC, "utf-8");
      const uri = `file://${srcPath}`;
      const handler = mountCodeActions(uri, GREET_JS);
      const actions = handler(codeActionParams(uri, 4, [missingFieldDiag(4)]));
      const applied = applyEdits(GREET_JS, docEdits(actions, uri));
      writeFileSync(srcPath, applied, "utf-8");
      // 落盘文本里不得出现 undefined 占位
      expect(applied).not.toContain("undefined");
      expect(applied).toContain("name:");
      // 语义面：违规仍在（不是假绿）
      const report = checkSource(srcPath, applied, undefined, {
        loadModule: defaultLoadModule,
      });
      const violated = report.issues.filter((i) => i.code === "nudo:constraint-violated");
      expect(violated.length).toBeGreaterThan(0);
    });
  });
});
