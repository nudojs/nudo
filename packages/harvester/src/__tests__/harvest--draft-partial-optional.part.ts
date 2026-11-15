/**
 * Bug 1012 回归（harvester **草稿面**）：`Partial<T>` 特判把内层字段**原样
 * 透传** ⇒ 字段仍是**必填** ⇒ 契约**比 TS 更严** ⇒ **假红**（tsc 绿，
 * `nudo check` 红）。
 *
 * oracle（`tsc --strict`，tmp/probe/fix-r27/h8a/e2e/b1012.ts ⇒ 无错）：
 *   `function givePartial(): Partial<{a: number; b: string}> { return {}; }`
 *   ⇒ TS 允许 `{}`（两个字段都可选）⇒ 绿。
 *
 * 改前（git HEAD 的草稿面）：`Partial<{a: number; b: string}>` ⇒
 *   `shape({ a: number(), b: string() })` —— 字段**必填** ⇒ 传 `{}` 违约
 *   ⇒ 比 TS 严 ⇒ 假红。
 * 改后（tmp/probe/fix-r27/h8a/probe.ts）：
 *   `fn({ p: partial(shape({ a: number(), b: string() })) }, any())`
 *
 * **两个产物面同答案**：收割面不建模 `Partial<T>`（该位 `unknown` ⇒ 无义务），
 * 草稿面按 TS 口径把字段**变可选** ⇒ 两侧都**接受** `{}` ⇒ 同一答案
 * （都不比 TS 严）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatShape } from "@nudojs/core";
import { dtsToContractDraft } from "../dts-contract-draft.ts";
import { harvestDts } from "../harvest-dts.ts";
import {
  asConstraint,
  fnParam,
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
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug1012-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

const DTS = `export declare function takePartial(p: Partial<{ a: number; b: string }>): void;
`;

describe("Bug 1012 —— 草稿面：Partial<T> 的字段**变可选**（不比 TS 严）", () => {
  it("草稿是 partial(shape({…}))，不是原样透传的 shape({…})", () => {
    const p = writeDts("fx.d.ts", DTS);
    const draft = dtsToContractDraft([p], "fx");
    expect(draft.draftSource).toContain("partial(shape({ a: number(), b: string() }))");
    // 改前的形态：字段仍必填（shape 直接透传，没有 partial 包装）
    expect(draft.draftSource).not.toContain("p: shape({ a: number(), b: string() })");
  });

  it("契约里两个字段都**可选**（isOptional）", () => {
    const p = writeDts("fx.d.ts", DTS);
    const draft = dtsToContractDraft([p], "fx");
    const exports = loadDraftExports(draft.draftSource);
    const param = fnParam(asConstraint(exports.takePartial), "p");
    expect(param.fields?.a?.constraint.isOptional).toBe(true);
    expect(param.fields?.b?.constraint.isOptional).toBe(true);
  });

  it("产品面：草稿抄进侧车后 `nudo check` **绿**（与 tsc 同向，不再假红）", () => {
    const p = writeDts("fx.d.ts", DTS);
    const draft = dtsToContractDraft([p], "fx");
    const dir = makeWorkDir("b1012");
    const { target } = writeSidecar(
      dir,
      draft.draftSource,
      `export function takePartial(p) { return; }
export function use() { return takePartial({}); }
`,
    );
    const res = runNudoCheck(target);
    removeWorkDir(dir);
    expect(res.status).toBe(0);
    expect(res.stdout).not.toContain("constraint-violated");
  });

  it("收割面同答案：该位无义务（unknown）⇒ 两侧都接受 {}", () => {
    const p = writeDts("fx.d.ts", DTS);
    const env = harvestDts([p]);
    expect(formatShape(env.globals.takePartial!)).toBe("(unknown) => undefined");
  });
});
