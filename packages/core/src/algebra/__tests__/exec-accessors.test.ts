/**
 * B-path 访问器（get/set）差分回归。
 * 回归背景：transpile 把 class 的 get/set 与对象字面量访问器都当普通方法
 * 存槽——new A().x 读到占位 fn / undefined，a.x = v 直写槽位绕过 setter。
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
  const dir = mkdtempSync(join(tmpdir(), "nudo-bpath-accessor-"));
  dirs.push(dir);
  const js = transpile(source, { runtimeImport: runtimeUrl });
  const modPath = join(dir, "mod.mjs");
  writeFileSync(modPath, js, "utf-8");
  const mod = await import(pathToFileURL(modPath).href);
  return mod[exportName] as (...args: unknown[]) => Abs;
}

describe("B-path class accessors", () => {
  it("class getter invoked on read", async () => {
    const run = await execTranspiled(
      `export function run() {
  class A { get x() { return 5; } }
  return new A().x;
}`,
      "run",
    );
    expect(litValue(run())).toBe(5);
  });

  it("class setter invoked on write, getter reads back", async () => {
    const run = await execTranspiled(
      `export function run(v) {
  class A {
    set x(v) { this._x = v * 2; }
    get x() { return this._x; }
  }
  const a = new A();
  a.x = v;
  return a.x;
}`,
      "run",
    );
    expect(litValue(run($lit(7)))).toBe(14);
  });

  it("getter body reads other instance fields (this = receiver)", async () => {
    const run = await execTranspiled(
      `export function run() {
  class A {
    constructor() { this.n = 10; }
    get doubled() { return this.n * 2; }
  }
  return new A().doubled;
}`,
      "run",
    );
    expect(litValue(run())).toBe(20);
  });

  it("inherited getter from base class", async () => {
    const run = await execTranspiled(
      `export function run() {
  class A { get tag() { return 'a'; } }
  class B extends A {}
  return new B().tag;
}`,
      "run",
    );
    expect(litValue(run())).toBe("a");
  });
});

describe("B-path object-literal accessors", () => {
  it("getter invoked on read", async () => {
    const run = await execTranspiled(
      `export function run() {
  const o = { get x() { return 5; } };
  return o.x;
}`,
      "run",
    );
    expect(litValue(run())).toBe(5);
  });

  it("getter sees sibling data slot via this", async () => {
    const run = await execTranspiled(
      `export function run() {
  const o = { a: 3, get x() { return this.a + 1; } };
  return o.x;
}`,
      "run",
    );
    expect(litValue(run())).toBe(4);
  });

  it("setter invoked on write, getter reads back", async () => {
    const run = await execTranspiled(
      `export function run(v) {
  const o = {
    set x(v) { this._x = v * 2; },
    get x() { return this._x; },
  };
  o.x = v;
  return o.x;
}`,
      "run",
    );
    expect(litValue(run($lit(7)))).toBe(14);
  });

  it("spread invokes getter (native: { ...o }.x evaluates)", async () => {
    const run = await execTranspiled(
      `export function run() {
  const o = { get x() { return 5; } };
  return ({ ...o }).x;
}`,
      "run",
    );
    expect(litValue(run())).toBe(5);
  });

  it("Object.assign invokes source getter", async () => {
    const run = await execTranspiled(
      `export function run() {
  const o = { get x() { return 5; } };
  const t = Object.assign({}, o);
  return t.x;
}`,
      "run",
    );
    expect(litValue(run())).toBe(5);
  });

  it("abstract object: accessor keys do not fabricate exact claims", async () => {
    const run = await execTranspiled(
      `export function run(o) { return o.x; }`,
      "run",
    );
    const r = run($arr([$lit(1)]));
    expect(formatShape(r)).not.toBe("undefined");
  });
});
