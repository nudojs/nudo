/**
 * contract --from-dts：TypeScript 声明 → 可审阅契约草稿（不执法）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  dtsToContractDraft,
  dtsPathToContractDraft,
  formatDtsContractDraft,
} from "../dts-contract-draft.ts";

/** root 对 chmod 000 免疫，真实 EACCES 用例无法生效 */
const isRoot = process.geteuid?.() === 0;

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("dtsToContractDraft", () => {
  it("projects function params/return to fn() DSL with names", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-from-dts-"));
    dirs.push(dir);
    const dts = join(dir, "math.d.ts");
    writeFileSync(
      dts,
      `export declare function lineTotal(price: number, qty: number): number;
export declare function formatMoney(cents: number): string;
export declare function applyCoupon(total: number, percent: number): number;
`,
      "utf-8",
    );
    const draft = dtsToContractDraft([dts], "math");
    expect(draft.draftSource).toContain("@nudo:draft");
    expect(draft.draftSource).toContain("NOT a sidecar contract");
    expect(draft.draftSource).toContain("fn({ price: number(), qty: number() }, number())");
    expect(draft.draftSource).toContain("fn({ cents: number() }, string())");
    expect(draft.draftSource).toContain("export const lineTotal");
    expect(draft.draftSource).not.toContain("export default fn");
  });

  it("projects shapes and leaves unmodeled as any() with notes", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-from-dts2-"));
    dirs.push(dir);
    const dts = join(dir, "cart.d.ts");
    writeFileSync(
      dts,
      `export type Item = { sku: string; price: number; qty?: number };
export declare function cartTotal(items: Item[], couponPercent?: number): number;
export declare function weird(x: SomeCustomBrand): void;
`,
      "utf-8",
    );
    const draft = dtsToContractDraft([dts], "cart");
    expect(draft.draftSource).toContain("export const cartTotal");
    expect(draft.draftSource).toMatch(/array\(/);
    expect(draft.draftSource).toContain("couponPercent:");
    expect(draft.draftSource).toContain("weird");
  });

  it("dtsPathToContractDraft walks a directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-from-dts3-"));
    dirs.push(dir);
    writeFileSync(join(dir, "a.d.ts"), `export declare function a(x: number): void;\n`, "utf-8");
    const draft = dtsPathToContractDraft(dir, "pkg");
    expect(draft.files.length).toBe(1);
    expect(draft.stats.exports).toBe(1);
    expect(draft.draftSource).toContain("export const a");
  });

  it("dtsPathToContractDraft: 入口不存在（ENOENT）→ 空草稿，不抛", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-from-dts-miss-"));
    dirs.push(dir);
    const draft = dtsPathToContractDraft(join(dir, "nope.d.ts"), "miss");
    expect(draft.files).toEqual([]);
    expect(draft.stats.files).toBe(0);
  });

  it.runIf(!isRoot)("dtsPathToContractDraft: 顶层入口 stat EACCES（父目录 000）→ 上抛", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-from-dts-eacces-"));
    dirs.push(dir);
    mkdirSync(join(dir, "locked"));
    writeFileSync(join(dir, "locked", "a.d.ts"), `export declare function a(x: number): void;\n`, "utf-8");
    chmodSync(join(dir, "locked"), 0o000);
    try {
      // 顶层入口自身在锁定目录内：stat 需要父目录可执行 → EACCES 上抛
      // （harvester CLI 面有顶层 catch 收口；不得折叠成「无入口」）
      expect(() => dtsPathToContractDraft(join(dir, "locked", "a.d.ts"), "locked")).toThrowError(
        /EACCES/,
      );
    } finally {
      chmodSync(join(dir, "locked"), 0o755);
    }
  });
});

describe("formatDtsContractDraft header discipline", () => {
  it("never claims to be a loaded sidecar", () => {
    const src = formatDtsContractDraft("x", ["x.d.ts"], [
      { name: "f", dsl: "fn({ x: number() }, number())", kind: "function" },
    ]);
    expect(src).toContain("NOT a sidecar contract");
    expect(src).toContain("copy it");
    expect(src).toContain("export const f = fn({ x: number() }, number())");
  });
});
