/**
 * evaluator 位运算/移位/幂/一元正号差分回归。
 * 回归背景：transpile 对未登记运算符折叠为 $lit(undefined)——
 * 合法 JS（5 & 1、2 ** 10、+"42"）被断言为精确 undefined（真值 1/1024/42），
 * 属 unsound 折叠。每条断言均与 Node 真实执行结果对齐。
 */
import {describe, it, expect, afterAll} from "vitest";
import {mkdtempSync, writeFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, dirname} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {transpileSource, litValue, formatShape, $lit, num, anyAbs, bitandAbs, bitnotAbs, type Abs} from "@nudojs/core";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const runtimeUrl = pathToFileURL(
  join(dirname(fileURLToPath(import.meta.url)), "../exec/runtime.ts"),
).href;

async function execTranspiled(source: string, exportName: string) {
  const dir = mkdtempSync(join(tmpdir(), "nudo-eval-bitwise-"));
  dirs.push(dir);
  const js = transpileSource(source, { runtimeImport: runtimeUrl });
  const modPath = join(dir, "mod.mjs");
  writeFileSync(modPath, js, "utf-8");
  const mod = await import(pathToFileURL(modPath).href);
  return mod[exportName] as (...args: unknown[]) => Abs;
}

describe("evaluator bitwise / shift / exponent / unary-plus", () => {
  it("& | ^ fold on literal operands", async () => {
    const run = await execTranspiled(
      `export function run(a, b) {
  return (a & b) + (a | b) * 10 + (a ^ b) * 100;
}`,
      "run",
    );
    // 5 & 1 = 1, 5 | 1 = 5, 5 ^ 1 = 4 → 1 + 50 + 400 = 451
    expect(litValue(run($lit(5), $lit(1)))).toEqual({ ok: true, value: 451 });
  });

  it("~ folds (ToInt32)", async () => {
    const run = await execTranspiled(
      `export function run(a) { return ~a; }`,
      "run",
    );
    expect(litValue(run($lit(5)))).toEqual({ ok: true, value: -6 });
    expect(litValue(run($lit(-6)))).toEqual({ ok: true, value: 5 });
  });

  it("<< >> >>> fold (ToInt32 lhs, ToUint32&31 rhs)", async () => {
    const run = await execTranspiled(
      `export function run(a, b) {
  return (a << b) + (a >> b) * 100 + (a >>> b) * 10000;
}`,
      "run",
    );
    // -5 << 1 = -10, -5 >> 1 = -3, -5 >>> 1 = 2147483645
    const r = run($lit(-5), $lit(1));
    expect(litValue(r)).toEqual({ ok: true, value: -10 + -3 * 100 + 2147483645 * 10000 });
  });

  it(">>> of -1 is 2147483647 (uint32 wrap)", async () => {
    const run = await execTranspiled(
      `export function run(a) { return a >>> 1; }`,
      "run",
    );
    expect(litValue(run($lit(-1)))).toEqual({ ok: true, value: 2147483647 });
  });

  it("** folds with right associativity", async () => {
    const run = await execTranspiled(
      `export function run(a, b, c) { return a ** b ** c; }`,
      "run",
    );
    // 2 ** 3 ** 2 = 2 ** 9 = 512
    expect(litValue(run($lit(2), $lit(3), $lit(2)))).toEqual({ ok: true, value: 512 });
    // (-3) ** 2 = 9
    expect(litValue(run($lit(-3), $lit(2), $lit(1)))).toEqual({ ok: true, value: 9 });
  });

  it("unary + coerces to number (ToNumber)", async () => {
    const run = await execTranspiled(
      `export function run(a, b) { return +(a) + +(b); }`,
      "run",
    );
    expect(litValue(run($lit("42"), $lit("")))).toEqual({ ok: true, value: 42 });
    expect(litValue(run($lit(true), $lit(null)))).toEqual({ ok: true, value: 1 });
    const nanR = litValue(run($lit("abc"), $lit(0)));
    expect(nanR.ok && Number.isNaN(nanR.value as number)).toBe(true);
  });

  it("abstract operands stay sound number, never exact undefined", async () => {
    const run = await execTranspiled(
      `export function run(a, b) { return a & b; }`,
      "run",
    );
    const r = run(num(), num());
    expect(formatShape(r)).toBe("number");
    expect(litValue(r)).toEqual({ ok: false });
  });

  it("any operand: 单侧 any 仍是 number，双 any / ~any 是 unknown；bigint 字面量仍折叠", () => {
    // 单侧 any + 确定 number：bigint 只可能来自 any 侧，混型位运算原生
    // TypeError ⇒ 非抛结果恒 number（精度保留）。
    expect(formatShape(bitandAbs(anyAbs, $lit(1)))).toBe("number");
    // 双 any 可能**同为 bigint**（`1n & 1n` 合法 ⇒ bigint）⇒ 不得报 number。
    expect(formatShape(bitandAbs(anyAbs, anyAbs))).toBe("unknown");
    // `~1n === -2n` 合法且非抛 ⇒ `~any` 的值域不是 number。
    expect(formatShape(bitnotAbs(anyAbs))).toBe("unknown");
    // 负控：bigint 字面量仍精确折叠（ToNumeric 不截断 bigint）。
    expect(formatShape(bitnotAbs($lit(1n)))).toBe("-2n");
  });
});
