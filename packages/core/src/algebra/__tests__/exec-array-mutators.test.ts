/**
 * B-path copyWithin / fill 差分回归。
 * 回归背景：两个方法不在 ARR_MUTATOR_NAMES——语句位置的 a.copyWithin(…)/a.fill(…)
 * 不重绑容器，后续读取仍折旧 tuple（unsound 精确断言）。
 * 每条断言与 Node 真实执行结果对齐（ToIntegerOrInfinity / 负边界自尾计数 /
 * 重叠窗口规范复制方向）。
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
  const dir = mkdtempSync(join(tmpdir(), "nudo-bpath-arrctr-"));
  dirs.push(dir);
  const js = transpile(source, { runtimeImport: runtimeUrl });
  const modPath = join(dir, "mod.mjs");
  writeFileSync(modPath, js, "utf-8");
  const mod = await import(pathToFileURL(modPath).href);
  return mod[exportName] as (...args: unknown[]) => Abs;
}

function els(a: Abs): unknown[] {
  return (a.shape as { elements: Abs[] }).elements.map((e) => litValue(e));
}

describe("B-path copyWithin (statement rebind)", () => {
  it("overlapping window copies backwards", async () => {
    const run = await execTranspiled(
      `export function run(a) { a.copyWithin(2, 0); return a; }`,
      "run",
    );
    expect(els(run($arr([$lit(1), $lit(2), $lit(3), $lit(4), $lit(5)])))).toEqual([
      1, 2, 1, 2, 3,
    ]);
  });

  it("source after target copies forwards", async () => {
    const run = await execTranspiled(
      `export function run(a) { a.copyWithin(0, 2); return a; }`,
      "run",
    );
    expect(els(run($arr([$lit(1), $lit(2), $lit(3), $lit(4), $lit(5)])))).toEqual([
      3, 4, 5, 4, 5,
    ]);
  });

  it("negative bounds count from the end", async () => {
    const run = await execTranspiled(
      `export function run(a) { a.copyWithin(0, -2); return a; }`,
      "run",
    );
    expect(els(run($arr([$lit(1), $lit(2), $lit(3), $lit(4)])))).toEqual([3, 4, 3, 4]);
  });

  it("target beyond length is a no-op", async () => {
    const run = await execTranspiled(
      `export function run(a) { a.copyWithin(9, 0); return a; }`,
      "run",
    );
    expect(els(run($arr([$lit(1), $lit(2)])))).toEqual([1, 2]);
  });

  it("explicit undefined end counts as absent (full window)", async () => {
    const run = await execTranspiled(
      `export function run(a) { a.copyWithin(1, 0, undefined); return a; }`,
      "run",
    );
    expect(els(run($arr([$lit(1), $lit(2), $lit(3)])))).toEqual([1, 1, 2]);
  });
});

describe("B-path fill (statement rebind)", () => {
  it("fills a bounded range", async () => {
    const run = await execTranspiled(
      `export function run(a) { a.fill(0, 1, 3); return a; }`,
      "run",
    );
    expect(els(run($arr([$lit(1), $lit(2), $lit(3), $lit(4), $lit(5)])))).toEqual([
      1, 0, 0, 4, 5,
    ]);
  });

  it("negative start counts from the end", async () => {
    const run = await execTranspiled(
      `export function run(a) { a.fill(7, -2); return a; }`,
      "run",
    );
    expect(els(run($arr([$lit(1), $lit(2), $lit(3), $lit(4)])))).toEqual([1, 2, 7, 7]);
  });

  it("no range fills the whole array", async () => {
    const run = await execTranspiled(
      `export function run(a) { a.fill(0); return a; }`,
      "run",
    );
    expect(els(run($arr([$lit(1), $lit(2), $lit(3)])))).toEqual([0, 0, 0]);
  });

  it("empty range is a no-op", async () => {
    const run = await execTranspiled(
      `export function run(a) { a.fill(9, 2, 2); return a; }`,
      "run",
    );
    expect(els(run($arr([$lit(1), $lit(2)])))).toEqual([1, 2]);
  });
});
