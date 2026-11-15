/**
 * Bug 801 回归（harvester **草稿面**）：TypeScript 的 `null` 被映射成
 * `any()` ⇒ 契约**是空的** ⇒ **假绿**（tsc 报 TS2322，`nudo check` 却绿）。
 *
 * oracle（`tsc --strict`，tmp/probe/fix-r27/h8a/e2e/b801.ts ⇒ TS2322）：
 *   `function choose(flag: boolean): number | null { return "totally wrong"; }`
 *
 * 改前（git HEAD 的草稿面）：`null` → `any()` ⇒ 返回位无约束 ⇒ 绿。
 * 改后（tmp/probe/fix-r27/h8a/probe.ts）：
 *   `export const choose = fn({ flag: boolean() }, union(number(), null));`
 *
 * **两个产物面同口径**：收割面把 `null` 建成 `{shape: unknown, term: lit null}`
 * （真 null 面，渲染成 `number | null`）；草稿面的 `union(…, null)` 经 core 的
 * `asNestedConstraint` 落成 `litC(null)`（同一个 entry Abs）⇒ 同一答案。
 *
 * 附带钉：`null` / 字面量出现在**约束位**（导出顶层、fn 返回位）时必须是
 * `union(…)` 包裹的**真约束**——裸写 `export const x = null;` 抄进侧车后
 * 根本不是约束（装载报「not a Nudo contract」）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatShape, isNudoConstraint, literalMeetsConstraint } from "@nudojs/core";
import { dtsToContractDraft } from "../dts-contract-draft.ts";
import { harvestDts } from "../harvest-dts.ts";
import {
  asConstraint,
  fnReturns,
  loadDraftExports,
  makeWorkDir,
  removeWorkDir,
  runNudoCheck,
  writeSidecar,
} from "./harvest-bug-h8a-helpers.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeDts(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug801-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

describe("Bug 801 —— 草稿面：TS 的 null 是**真 null 面**（不是 any()）", () => {
  it("`number | null` 的草稿是 union(number(), null)，不是 any()", () => {
    const p = writeDts(
      "fx.d.ts",
      `export declare function choose(flag: boolean): number | null;
`,
    );
    const draft = dtsToContractDraft([p], "fx");
    expect(draft.draftSource).toContain("union(number(), null)");
    expect(draft.draftSource).not.toContain("any()");
    // 假绿根因：`any()` 会把整个返回位变成空约束
    expect(draft.draftSource).not.toMatch(/union\(number\(\), any\(\)\)/);
  });

  it("契约**真的**拒绝字符串（域隶属判定 = 假绿已消除）", () => {
    const p = writeDts(
      "fx.d.ts",
      `export declare function choose(flag: boolean): number | null;
`,
    );
    const draft = dtsToContractDraft([p], "fx");
    const exports = loadDraftExports(draft.draftSource);
    const ret = fnReturns(asConstraint(exports.choose));
    expect(literalMeetsConstraint("totally wrong", ret)).toBe(false);
    expect(literalMeetsConstraint(null, ret)).toBe(true);
    expect(literalMeetsConstraint(42, ret)).toBe(true);
  });

  it("产品面：草稿抄进侧车后 `nudo check` **红**（与 tsc 的 TS2322 同向）", () => {
    const p = writeDts(
      "fx.d.ts",
      `export declare function choose(flag: boolean): number | null;
`,
    );
    const draft = dtsToContractDraft([p], "fx");
    const dir = makeWorkDir("b801");
    const { target } = writeSidecar(
      dir,
      draft.draftSource,
      `export function choose(flag) { return "totally wrong"; }\n`,
    );
    const res = runNudoCheck(target);
    removeWorkDir(dir);
    expect(res.status).not.toBe(0);
    expect(res.stdout).toContain("constraint-violated");
  });

  it("收割面同口径：`null` 是真 null 面（渲染成 number | null）", () => {
    const p = writeDts(
      "fx.d.ts",
      `export declare function choose(flag: boolean): number | null;
`,
    );
    const env = harvestDts([p]);
    expect(formatShape(env.globals.choose!)).toBe("(boolean) => number | null");
  });

  it("约束位上的裸字面量是**真约束**（顶层 null 导出不是 `export const x = null`）", () => {
    const p = writeDts(
      "fx.d.ts",
      `export declare const x: null;
export declare const v: "1.0";
`,
    );
    const draft = dtsToContractDraft([p], "fx");
    expect(draft.draftSource).toContain("export const x = union(null)");
    expect(draft.draftSource).toContain('export const v = union("1.0")');
    const exports = loadDraftExports(draft.draftSource);
    expect(isNudoConstraint(exports.x)).toBe(true);
    expect(isNudoConstraint(exports.v)).toBe(true);
    expect(literalMeetsConstraint(null, asConstraint(exports.x))).toBe(true);
    expect(literalMeetsConstraint("other", asConstraint(exports.x))).toBe(false);
  });
});
