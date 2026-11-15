/**
 * Bug 825 —— `nudo contract --from-dts` 把**重载集静默塌成第一个 overload**
 * ⇒ 草稿**少声明**签名，且被丢掉的 overload **不计入 `skipped`**
 * ⇒ 汇总行**看不出任何丢失**。
 *
 * 修法（草稿面）：
 * 1. 重载**全部保留**：合并后的返回类型取**全部 overload 的 union**
 *    （与收割面 `harvest-dts.ts` 的重载合并**同口径**），形参取首个；
 * 2. 每条 overload 的**签名写进 note** ⇒ 审阅者看得见「这里本来有 N 条」；
 * 3. 被合并掉的 overload **计入 `stats.skipped`** ⇒ 汇总行说真话。
 *
 * 反向闸：改前（塌成第一个 overload、`skipped` 不计数）⇒ 本文件全部失败。
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

function writeDts(name: string, src: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug825-"));
  dirs.push(dir);
  const file = join(dir, name);
  writeFileSync(file, src, "utf-8");
  return file;
}

describe("Bug 825 —— --from-dts 的重载集", () => {
  it("重载集保留**全部** overload 的返回类型（不被塌成第一个）", () => {
    const file = writeDts(
      "kt14.d.ts",
      `export declare function over(x: string): string;
export declare function over(x: string, y: number): number;
`,
    );
    const draft = dtsToContractDraft([file], "kt14");
    // 合并后的返回类型 = 两条 overload 的 union
    expect(draft.draftSource).toContain("union(string(), number())");
    // 改前：只保留第一个 overload ⇒ 这行会出现在草稿里
    expect(draft.draftSource).not.toContain("export const over = fn({ x: string() }, string());");
  });

  it("每条 overload 的签名都看得见（note 里逐条列出）", () => {
    const file = writeDts(
      "kt14.d.ts",
      `export declare function over(x: string): string;
export declare function over(x: string, y: number): number;
`,
    );
    const draft = dtsToContractDraft([file], "kt14");
    expect(draft.draftSource).toContain("2 overloads merged");
    expect(draft.draftSource).toContain("fn({ x: string() }, string())");
    expect(draft.draftSource).toContain("fn({ x: string(), y: number() }, number())");
  });

  it("被合并掉的 overload **计入 skipped**（汇总行说真话）", () => {
    const file = writeDts(
      "kt14.d.ts",
      `export declare function over(x: string): string;
export declare function over(x: string, y: number): number;
`,
    );
    const draft = dtsToContractDraft([file], "kt14");
    expect(draft.stats.exports).toBe(1);
    // 2 条声明 → 1 条条目 ⇒ 丢失 1 条 ⇒ skipped = 1（改前报 0）
    expect(draft.stats.skipped).toBe(1);
  });

  it("N 条 overload ⇒ N−1 条丢失被逐条计数", () => {
    const file = writeDts(
      "kt14.d.ts",
      `export declare function over(x: string): string;
export declare function over(x: string, y: number): number;
export declare function over(x: string, y: number, z: boolean): boolean;
`,
    );
    const draft = dtsToContractDraft([file], "kt14");
    expect(draft.stats.exports).toBe(1);
    expect(draft.stats.skipped).toBe(2);
    expect(draft.draftSource).toContain("3 overloads merged");
    expect(draft.draftSource).toContain("union(string(), number(), boolean())");
  });

  it("单条声明（无重载）不算丢失", () => {
    const file = writeDts(
      "single.d.ts",
      `export declare function only(x: string): string;
`,
    );
    const draft = dtsToContractDraft([file], "single");
    expect(draft.stats.exports).toBe(1);
    expect(draft.stats.skipped).toBe(0);
    expect(draft.draftSource).toContain("export const only = fn({ x: string() }, string());");
    expect(draft.draftSource).not.toContain("overloads merged");
  });
});
