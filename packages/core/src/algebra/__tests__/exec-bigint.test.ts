/**
 * evaluator BigInt 字面量差分回归。
 * 回归背景：transpile 无 BigIntLiteral case——5n 落到默认分支被折叠为
 * $lit(undefined)：typeof 5n 折 "undefined"、(5n).toString() 报假 TypeError、
 * 5n == 5 折 false、位运算/幂以 undefined 参与。
 * 每条断言与 Node 真实执行结果对齐。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { transpile, litValue, runTranspiled, callTranspiledExportFull, bigintLit, type Abs } from "@nudojs/core";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const runtimeUrl = pathToFileURL(
  join(dirname(fileURLToPath(import.meta.url)), "../exec/index.ts"),
).href;

async function execTranspiled(source: string, exportName: string) {
  const dir = mkdtempSync(join(tmpdir(), "nudo-eval-bigint-"));
  dirs.push(dir);
  const js = transpile(source, { runtimeImport: runtimeUrl });
  const modPath = join(dir, "mod.mjs");
  writeFileSync(modPath, js, "utf-8");
  const mod = await import(pathToFileURL(modPath).href);
  return mod[exportName] as (...args: unknown[]) => Abs;
}

describe("evaluator BigInt literals", () => {
  it("typeof 5n is \"bigint\"", async () => {
    const run = await execTranspiled(`export function run() { return typeof 5n; }`, "run");
    expect(litValue(run())).toEqual({ ok: true, value: "bigint" });
  });

  it("(5n).toString() folds \"5\" without a throw claim", async () => {
    const run = await execTranspiled(`export function run() { return (5n).toString(); }`, "run");
    expect(litValue(run())).toEqual({ ok: true, value: "5" });
  });

  it("5n == 5 loose equality across number/bigint", async () => {
    const run = await execTranspiled(`export function run() { return 5n == 5; }`, "run");
    expect(litValue(run())).toEqual({ ok: true, value: true });
  });

  it("5n == 5.5 is false (mathematical value compare)", async () => {
    const run = await execTranspiled(`export function run() { return 5n == 5.5; }`, "run");
    expect(litValue(run())).toEqual({ ok: true, value: false });
  });

  it("bigint arithmetic folds", async () => {
    const run = await execTranspiled(
      `export function run() { return (5n + 2n) * 10n + 5n / 2n * 2n + 5n % 2n; }`,
      "run",
    );
    // 70n + 4n + 1n = 75n
    expect(litValue(run())).toEqual({ ok: true, value: 75n });
  });

  it("bigint shift and power fold", async () => {
    const run = await execTranspiled(
      `export function run() { return (1n << 3n) + 2n ** 10n; }`,
      "run",
    );
    // 8n + 1024n = 1032n
    expect(litValue(run())).toEqual({ ok: true, value: 1032n });
  });

  it("bigint bitwise folds", async () => {
    const run = await execTranspiled(`export function run() { return 5n & 3n; }`, "run");
    expect(litValue(run())).toEqual({ ok: true, value: 1n });
  });

  it("abstract bigint stays bigint, never exact undefined", async () => {
    const run = await execTranspiled(
      `export function run(a) { return a + 1n; }`,
      "run",
    );
    const big = { shape: { k: "prim", type: "bigint" }, conf: "widened" } as unknown as Abs;
    const r = run(big);
    expect(r.shape.k).toBe("prim");
    if (r.shape.k === "prim") expect(r.shape.type).toBe("bigint");
    expect(litValue(r)).toEqual({ ok: false });
  });

  // 原生 ground truth：5n * 1 抛 TypeError: Cannot mix BigInt and other types
  // （ToNumeric 保型、混型即抛，不是 ToNumber 后的 NaN）。
  // 回归背景：simplifyTerm 的 x*1 恒等式曾把 bigint 操作数折 lit(NaN)；
  // term 层不得吞掉混型 TypeError 语义（算术核 foldBigintBinOp 负责抛）。
  describe("bigint * 1 mixed TypeError", () => {
    it("5n * 1 evaluates to throws TypeError, result never (not NaN)", () => {
      const exports = runTranspiled(`export function run() { return 5n * 1; }`, {
        mode: "analyze",
      });
      const r = callTranspiledExportFull(exports, "run", []);
      expect(r.result.shape.k).toBe("never");
      expect(r.throws.shape.k).toBe("brand");
      if (r.throws.shape.k === "brand") expect(r.throws.shape.name).toBe("TypeError");
    });

    it("1 * 5n likewise throws TypeError", () => {
      const exports = runTranspiled(`export function run() { return 1 * 5n; }`, {
        mode: "analyze",
      });
      const r = callTranspiledExportFull(exports, "run", []);
      expect(r.result.shape.k).toBe("never");
      expect(r.throws.shape.k).toBe("brand");
      if (r.throws.shape.k === "brand") expect(r.throws.shape.name).toBe("TypeError");
    });

    it("x * 1 with x bound to 5n still throws TypeError (term substitution path)", () => {
      const exports = runTranspiled(`export function run(x) { return x * 1; }`, {
        mode: "analyze",
      });
      const r = callTranspiledExportFull(exports, "run", [bigintLit(5n)]);
      expect(r.result.shape.k).toBe("never");
      expect(r.throws.shape.k).toBe("brand");
      if (r.throws.shape.k === "brand") expect(r.throws.shape.name).toBe("TypeError");
    });
  });
});
