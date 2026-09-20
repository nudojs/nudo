/**
 * B-path in / instanceof / delete 差分回归。
 * 回归背景：三个运算符均不在 BIN_OPS / UnaryExpression 路由表——
 * transpile 折叠为 $lit(undefined)（unsound 精确断言）。
 * 每条断言与 Node 真实执行结果对齐。
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
  $arr,
  $obj,
  objOf,
  num,
  str,
  unknown,
  type Abs,
} from "@nudojs/core";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const runtimeUrl = pathToFileURL(
  join(dirname(fileURLToPath(import.meta.url)), "../exec/index.ts"),
).href;

async function execTranspiled(source: string, exportName: string) {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bpath-inop-"));
  dirs.push(dir);
  const js = transpile(source, { runtimeImport: runtimeUrl });
  const modPath = join(dir, "mod.mjs");
  writeFileSync(modPath, js, "utf-8");
  const mod = await import(pathToFileURL(modPath).href);
  return mod[exportName] as (...args: unknown[]) => Abs;
}

describe("B-path `in` operator", () => {
  it("own slot present / absent", async () => {
    const run = await execTranspiled(
      `export function run(o) { return ('a' in o) * 10 + ('c' in o); }`,
      "run",
    );
    expect(litValue(run($obj({ a: $lit(1), b: $lit(2) })))).toBe(10); // true*10 + false
  });

  it("prototype names count (toString in {})", async () => {
    const run = await execTranspiled(
      `export function run(o) { return 'toString' in o; }`,
      "run",
    );
    expect(litValue(run($obj({ a: $lit(1) })))).toBe(true);
  });

  it("array index + length", async () => {
    const run = await execTranspiled(
      `export function run(a) {
  return (1 in a) * 4 + (2 in a) * 2 + ('length' in a);
}`,
      "run",
    );
    expect(litValue(run($arr([$lit(5), $lit(6)])))).toBe(4 + 0 + 1);
  });

  it("abstract key stays boolean, never exact undefined", async () => {
    const run = await execTranspiled(
      `export function run(o, k) { return k in o; }`,
      "run",
    );
    const r = run($obj({ a: $lit(1) }), str());
    expect(formatShape(r)).toBe("boolean");
    expect(litValue(r)).toBeUndefined();
  });
});

describe("B-path `instanceof` operator", () => {
  it("array brand: Array true, Date false", async () => {
    const run = await execTranspiled(
      `export function run(a) { return (a instanceof Array) * 2 + (a instanceof Date); }`,
      "run",
    );
    expect(litValue(run($arr([$lit(1)])))).toBe(2);
  });

  it("builtin brand: Date true, Object true, Array false", async () => {
    const run = await execTranspiled(
      `export function run() {
  const d = new Date(0);
  return (d instanceof Date) * 4 + (d instanceof Object) * 2 + (d instanceof Array);
}`,
      "run",
    );
    expect(litValue(run())).toBe(6);
  });

  it("user class extends chain", async () => {
    const run = await execTranspiled(
      `export function run() {
  class A {}
  class B extends A {}
  const b = new B();
  return (b instanceof B) * 4 + (b instanceof A) * 2 + (b instanceof Object);
}`,
      "run",
    );
    expect(litValue(run())).toBe(7);
  });

  it("plain object: Object true, Array false", async () => {
    const run = await execTranspiled(
      `export function run(o) { return (o instanceof Object) * 2 + (o instanceof Array); }`,
      "run",
    );
    expect(litValue(run($obj({ a: $lit(1) })))).toBe(2);
  });

  it("primitives are never instanceof (no boxing)", async () => {
    const run = await execTranspiled(
      `export function run(a) { return a instanceof Number; }`,
      "run",
    );
    expect(litValue(run($lit(5)))).toBe(false);
  });

  it("error subclass: RangeError is Error, not TypeError", async () => {
    const run = await execTranspiled(
      `export function run() {
  try { throw new RangeError('r'); } catch (e) {
    return (e instanceof RangeError) * 4 + (e instanceof Error) * 2 + (e instanceof TypeError);
  }
}`,
      "run",
    );
    expect(litValue(run())).toBe(6);
  });

  it("abstract left stays boolean, never exact undefined", async () => {
    const run = await execTranspiled(
      `export function run(a) { return a instanceof Array; }`,
      "run",
    );
    const r = run(unknown);
    expect(formatShape(r)).toBe("boolean");
    expect(litValue(r)).toBeUndefined();
  });
});

describe("B-path `delete` operator", () => {
  it("delete returns true and removes own slot", async () => {
    const run = await execTranspiled(
      `export function run(o) {
  const r = delete o.a;
  return r * 10 + ('a' in o);
}`,
      "run",
    );
    expect(litValue(run($obj({ a: $lit(1), b: $lit(2) })))).toBe(10); // true, then absent
  });

  it("delete on missing slot still returns true", async () => {
    const run = await execTranspiled(
      `export function run(o) { return delete o.zz; }`,
      "run",
    );
    expect(litValue(run($obj({ a: $lit(1) })))).toBe(true);
  });

  it("delete on array index leaves hole-read as undefined", async () => {
    const run = await execTranspiled(
      `export function run(a) {
  delete a[0];
  return a[0];
}`,
      "run",
    );
    expect(litValue(run($arr([$lit(1), $lit(2)])))).toBe(undefined);
  });

  it("delete on abstract object stays boolean, never exact undefined", async () => {
    const run = await execTranspiled(
      `export function run(o) { return delete o.a; }`,
      "run",
    );
    const r = run(objOf({ a: { value: $lit(1) } }, { open: true }));
    expect(formatShape(r)).toBe("boolean");
  });
});
