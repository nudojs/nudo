/**
 * toIOI / fill / copyWithin 的 ToIntegerOrInfinity 回归。
 *
 * 回归背景：toIOI 对 string/bool 走 Math.trunc(Number(lv))，非数字字符串
 * （'abc'、'-'、'  ' 等）的 Number 为 NaN，trunc 后仍是 NaN——而规范
 * ToIntegerOrInfinity(ToNumber(x)) 对 NaN 取 0。结果 fill/copyWithin 把
 * NaN 当窗口边界，比较全 false，整段 no-op 并仍折成 exact tuple：
 *   [1,2,3].fill(0, 'abc')          原生 [0,0,0]，引擎 [1,2,3]
 *   [1,2,3,4,5].copyWithin('abc',1) 原生 [2,3,4,5,5]，引擎 no-op
 *
 * 同类排查：methods.ts toIntegerOrInfinityLit 已对 NaN→0；本文件钉住
 * containers.ts toIOI 同族漏网点（fill/copyWithin 共用）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { transpile, litValue, $lit, $arr, type Abs } from "@nudojs/core";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const runtimeUrl = pathToFileURL(
  join(dirname(fileURLToPath(import.meta.url)), "../exec/index.ts"),
).href;

async function execTranspiled(source: string, exportName: string) {
  const dir = mkdtempSync(join(tmpdir(), "nudo-eval-toioi-"));
  dirs.push(dir);
  const js = transpile(source, { runtimeImport: runtimeUrl });
  const modPath = join(dir, "mod.mjs");
  writeFileSync(modPath, js, "utf-8");
  const mod = await import(pathToFileURL(modPath).href);
  return mod[exportName] as (...args: unknown[]) => Abs;
}

function els(a: Abs): unknown[] {
  return (a.shape as { elements: Abs[] }).elements.map((e) => { const r = litValue(e); return r.ok ? r.value : undefined; });
}

function arr(...xs: number[]): Abs {
  return $arr(xs.map((n) => $lit(n)));
}

describe("toIOI ToIntegerOrInfinity NaN → 0 (non-numeric strings)", () => {
  it("fill with non-numeric string start treats it as 0", async () => {
    const run = await execTranspiled(
      `export function run(a) { a.fill(0, 'abc'); return a; }`,
      "run",
    );
    expect(els(run(arr(1, 2, 3)))).toEqual([0, 0, 0]);
  });

  it("fill with empty-string / '-' / whitespace start also maps to 0", async () => {
    for (const start of ["''", "'-'", "'  '"]) {
      const run = await execTranspiled(
        `export function run(a) { a.fill(9, ${start}); return a; }`,
        "run",
      );
      expect(els(run(arr(1, 2, 3))), start).toEqual([9, 9, 9]);
    }
  });

  it("fill with non-numeric string end maps to 0 (empty window)", async () => {
    // ToIntegerOrInfinity('abc') = 0 → window [start, 0) 为空
    const run = await execTranspiled(
      `export function run(a) { a.fill(0, 1, 'abc'); return a; }`,
      "run",
    );
    expect(els(run(arr(1, 2, 3, 4)))).toEqual([1, 2, 3, 4]);
  });

  it("fill with non-numeric string start + real end", async () => {
    const run = await execTranspiled(
      `export function run(a) { a.fill(0, 'abc', 2); return a; }`,
      "run",
    );
    expect(els(run(arr(1, 2, 3, 4)))).toEqual([0, 0, 3, 4]);
  });

  it("copyWithin with non-numeric string target maps to 0", async () => {
    const run = await execTranspiled(
      `export function run(a) { a.copyWithin('abc', 1); return a; }`,
      "run",
    );
    expect(els(run(arr(1, 2, 3, 4, 5)))).toEqual([2, 3, 4, 5, 5]);
  });

  it("copyWithin with non-numeric string start maps to 0", async () => {
    const run = await execTranspiled(
      `export function run(a) { a.copyWithin(1, 'abc'); return a; }`,
      "run",
    );
    expect(els(run(arr(1, 2, 3, 4, 5)))).toEqual([1, 1, 2, 3, 4]);
  });

  it("copyWithin with non-numeric string end maps to 0 (empty window)", async () => {
    const run = await execTranspiled(
      `export function run(a) { a.copyWithin(2, 1, 'abc'); return a; }`,
      "run",
    );
    expect(els(run(arr(1, 2, 3, 4, 5)))).toEqual([1, 2, 3, 4, 5]);
  });
});
