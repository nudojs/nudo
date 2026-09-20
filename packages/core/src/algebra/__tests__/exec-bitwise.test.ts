/**
 * B-path 位运算/移位/幂/一元正号差分回归。
 * 回归背景：transpile 对未登记运算符折叠为 $lit(undefined)——
 * 合法 JS（5 & 1、2 ** 10、+"42"）被断言为精确 undefined（真值 1/1024/42），
 * 属 unsound 折叠。每条断言均与 Node 真实执行结果对齐。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  transpile,
  litValue,
  formatShape,
  $lit,
  num,
  type Abs,
} from "@nudojs/core";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const runtimeUrl = pathToFileURL(
  join(dirname(fileURLToPath(import.meta.url)), "../exec/runtime.ts"),
).href;

async function execTranspiled(source: string, exportName: string) {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bpath-bitwise-"));
  dirs.push(dir);
  const js = transpile(source, { runtimeImport: runtimeUrl });
  const modPath = join(dir, "mod.mjs");
  writeFileSync(modPath, js, "utf-8");
  const mod = await import(pathToFileURL(modPath).href);
  return mod[exportName] as (...args: unknown[]) => Abs;
}

describe("B-path bitwise / shift / exponent / unary-plus", () => {
  it("& | ^ fold on literal operands", async () => {
    const run = await execTranspiled(
      `export function run(a, b) {
  return (a & b) + (a | b) * 10 + (a ^ b) * 100;
}`,
      "run",
    );
    // 5 & 1 = 1, 5 | 1 = 5, 5 ^ 1 = 4 → 1 + 50 + 400 = 451
    expect(litValue(run($lit(5), $lit(1)))).toBe(451);
  });

  it("~ folds (ToInt32)", async () => {
    const run = await execTranspiled(
      `export function run(a) { return ~a; }`,
      "run",
    );
    expect(litValue(run($lit(5)))).toBe(-6);
    expect(litValue(run($lit(-6)))).toBe(5);
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
    expect(litValue(r)).toBe(-10 + -3 * 100 + 2147483645 * 10000);
  });

  it(">>> of -1 is 2147483647 (uint32 wrap)", async () => {
    const run = await execTranspiled(
      `export function run(a) { return a >>> 1; }`,
      "run",
    );
    expect(litValue(run($lit(-1)))).toBe(2147483647);
  });

  it("** folds with right associativity", async () => {
    const run = await execTranspiled(
      `export function run(a, b, c) { return a ** b ** c; }`,
      "run",
    );
    // 2 ** 3 ** 2 = 2 ** 9 = 512
    expect(litValue(run($lit(2), $lit(3), $lit(2)))).toBe(512);
    // (-3) ** 2 = 9
    expect(litValue(run($lit(-3), $lit(2), $lit(1)))).toBe(9);
  });

  it("unary + coerces to number (ToNumber)", async () => {
    const run = await execTranspiled(
      `export function run(a, b) { return +(a) + +(b); }`,
      "run",
    );
    expect(litValue(run($lit("42"), $lit("")))).toBe(42);
    expect(litValue(run($lit(true), $lit(null)))).toBe(1);
    expect(Number.isNaN(litValue(run($lit("abc"), $lit(0))))).toBe(true);
  });

  it("abstract operands stay sound number, never exact undefined", async () => {
    const run = await execTranspiled(
      `export function run(a, b) { return a & b; }`,
      "run",
    );
    const r = run(num(), num());
    expect(formatShape(r)).toBe("number");
    expect(litValue(r)).toBeUndefined();
  });
});
