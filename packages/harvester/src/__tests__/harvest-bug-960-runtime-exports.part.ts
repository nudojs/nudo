/**
 * Bug 960 —— `nudo contract --from-dts` 的**草稿面**把 5 类**运行时导出**
 * 整条丢弃（`export {x} from` / `export * from` / `enum` / `namespace` /
 * 匿名 `export default function`），且**汇总行报「0 skipped」** ⇒ 丢失**零信号**；
 * 而**同一 harvester 的收割面 `harvestDts` 对同一文件看得见 `Color`（enum）**
 * ⇒ **两个产物面自相矛盾**。
 *
 * 修法（草稿面）：
 * 1. `collectExports` 补齐语句分支：`enum` / `namespace`（**运行时对象** ⇒
 *    投影成 shape）、`export {x} from` / `export * from` / `export * as ns from`
 *    （**导出名逐个 push + note** ⇒ 看得见）、匿名 `export default function`
 *    （与匿名 class **同款**处理）；
 * 2. **无法建模的导出也要 `push({name, note, kind})`** ⇒ 进 `stats.skipped`
 *    ⇒ 汇总行说真话。
 *
 * 反向闸：改前（5 类里 3 类整条消失 + 汇总行报「0 skipped」）⇒ 本文件失败。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dtsToContractDraft } from "../dts-contract-draft.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 报告 §Bug 960 的夹具：6 个运行时导出面 */
const RUNTIME_DTS = `export declare function alpha(x: number): string;
export { beta } from "./other";
export * from "./other";
export enum Color { Red, Green }
export namespace Space { export const inner = 1; }
export default function () { return 1; }
`;

function writeDts(name: string, src: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug960-"));
  dirs.push(dir);
  const file = join(dir, name);
  writeFileSync(file, src, "utf-8");
  return file;
}

describe("Bug 960 —— --from-dts 的运行时导出面", () => {
  it("`enum` 是运行时导出 ⇒ 进草稿（收割面看得见 `Color`）", () => {
    const file = writeDts("types.d.ts", RUNTIME_DTS);
    const draft = dtsToContractDraft([file], "types");
    expect(draft.draftSource).toContain("export const Color = shape({");
    expect(draft.draftSource).toContain("Red: 0");
    expect(draft.draftSource).toContain("Green: 1");
  });

  it("`namespace` 是运行时导出 ⇒ 进草稿", () => {
    const file = writeDts("types.d.ts", RUNTIME_DTS);
    const draft = dtsToContractDraft([file], "types");
    expect(draft.draftSource).toContain("export const Space = shape({");
    expect(draft.draftSource).toContain("inner: 1");
  });

  it("匿名 `export default function` 进草稿（键 = `default`）", () => {
    const file = writeDts("types.d.ts", RUNTIME_DTS);
    const draft = dtsToContractDraft([file], "types");
    expect(draft.draftSource).toContain("as default };");
    // 改前：匿名 default function 整条 `continue` 掉（草稿里根本没有）
    expect(draft.exports.some((e) => e.name === "default")).toBe(true);
  });

  it("`export {x} from` / `export * from` **看得见**（逐个 push + note）", () => {
    const file = writeDts("types.d.ts", RUNTIME_DTS);
    const draft = dtsToContractDraft([file], "types");
    expect(draft.draftSource).toContain("beta");
    expect(draft.draftSource).toContain("export * from \"./other\"");
    expect(draft.exports.some((e) => e.name === "beta")).toBe(true);
  });

  it("投影不了的运行时导出**计入 skipped**（汇总行不再报「0 skipped」）", () => {
    const file = writeDts("types.d.ts", RUNTIME_DTS);
    const draft = dtsToContractDraft([file], "types");
    // 4 条投影成功（alpha / Color / Space / default）+ 2 条看得见但投影不了
    // （beta 的再导出 + star 再导出）⇒ skipped = 2（改前报 0）
    expect(draft.stats.exports).toBe(4);
    expect(draft.stats.skipped).toBe(2);
  });

  it("`export * as ns from` 也是运行时导出面 ⇒ 看得见", () => {
    const file = writeDts(
      "ns.d.ts",
      `export * as helpers from "./other";\nexport declare const alpha: number;\n`,
    );
    const draft = dtsToContractDraft([file], "ns");
    expect(draft.exports.some((e) => e.name === "helpers")).toBe(true);
    expect(draft.stats.skipped).toBe(1);
  });

  it("`export import x = require(\"m\")` 不再静默丢弃", () => {
    const file = writeDts(
      "cjs.d.ts",
      `export import legacy = require("./legacy");\nexport declare const alpha: number;\n`,
    );
    const draft = dtsToContractDraft([file], "cjs");
    expect(draft.exports.some((e) => e.name === "legacy")).toBe(true);
    expect(draft.stats.skipped).toBe(1);
  });
});
