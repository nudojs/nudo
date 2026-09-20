/**
 * B-path 成员复合赋值 / 自增自减 / 解构赋值差分回归。
 * 回归背景：成员目标上的 += / ++ / -- 不读-改-写（o.n += 5 折 11、o.n++ 落 undefined、
 * a.length += 1 不生效）；数组解构赋值完全不求值；右侧引用旧值的求值顺序错。
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
  $obj,
  $arr,
  num,
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
  const dir = mkdtempSync(join(tmpdir(), "nudo-bpath-memupd-"));
  dirs.push(dir);
  const js = transpile(source, { runtimeImport: runtimeUrl });
  const modPath = join(dir, "mod.mjs");
  writeFileSync(modPath, js, "utf-8");
  const mod = await import(pathToFileURL(modPath).href);
  return mod[exportName] as (...args: unknown[]) => Abs;
}

describe("B-path member compound assignment", () => {
  it("o.n += 5 reads current slot (1 + 5 = 6)", async () => {
    const run = await execTranspiled(
      `export function run(o) { o.n += 5; return o.n; }`,
      "run",
    );
    expect(litValue(run($obj({ n: $lit(1) })))).toBe(6);
  });

  it("o.n -= / *= / /= fold like identifiers", async () => {
    const run = await execTranspiled(
      `export function run(o) {
  o.a -= 2;
  o.b *= 3;
  o.c /= 4;
  return o.a * 100 + o.b * 10 + o.c;
}`,
      "run",
    );
    // 7-2=5, 3*3=9, 8/4=2 → 5*100+9*10+2 = 592
    expect(litValue(run($obj({ a: $lit(7), b: $lit(3), c: $lit(8) })))).toBe(592);
  });

  it("a.length += 1 extends the array", async () => {
    const run = await execTranspiled(
      `export function run(a) { a.length += 1; return a.length; }`,
      "run",
    );
    expect(litValue(run($arr([$lit(1)])))).toBe(2);
  });

  it("compound through accessor: getter + setter chain", async () => {
    const run = await execTranspiled(
      `export function run() {
  class A {
    constructor() { this._x = 1; }
    get x() { return this._x; }
    set x(v) { this._x = v; }
  }
  const a = new A();
  a.x += 5;
  return a.x;
}`,
      "run",
    );
    expect(litValue(run())).toBe(6);
  });
});

describe("B-path member update expressions", () => {
  it("o.n++ returns old value and writes back", async () => {
    const run = await execTranspiled(
      `export function run(o) { const r = o.n++; return r * 10 + o.n; }`,
      "run",
    );
    expect(litValue(run($obj({ n: $lit(1) })))).toBe(12);
  });

  it("++o.n returns new value and writes back", async () => {
    const run = await execTranspiled(
      `export function run(o) { return ++o.n; }`,
      "run",
    );
    expect(litValue(run($obj({ n: $lit(1) })))).toBe(2);
  });

  it("o.n-- decrements", async () => {
    const run = await execTranspiled(
      `export function run(o) { o.n--; return o.n; }`,
      "run",
    );
    expect(litValue(run($obj({ n: $lit(1) })))).toBe(0);
  });

  it("class instance member ++ writes back", async () => {
    const run = await execTranspiled(
      `export function run() {
  class A { constructor() { this.n = 1; } }
  const a = new A();
  a.n++;
  return a.n;
}`,
      "run",
    );
    expect(litValue(run())).toBe(2);
  });

  it("abstract slot update stays number, never exact undefined", async () => {
    const run = await execTranspiled(
      `export function run(o) { o.n++; return o.n; }`,
      "run",
    );
    const r = run($obj({ n: num() }));
    expect(formatShape(r)).toBe("number");
  });
});

describe("B-path destructuring assignment", () => {
  it("[a, b] = [b, a] swaps", async () => {
    const run = await execTranspiled(
      `export function run() {
  let a = 1, b = 2;
  [a, b] = [b, a];
  return a * 10 + b;
}`,
      "run",
    );
    expect(litValue(run())).toBe(21);
  });

  it("({ p: x } = { p: 9 }) writes through", async () => {
    const run = await execTranspiled(
      `export function run() {
  let x = 1;
  ({ p: x } = { p: 9 });
  return x;
}`,
      "run",
    );
    expect(litValue(run())).toBe(9);
  });

  it("[x, y = 5] = [1] fills default", async () => {
    const run = await execTranspiled(
      `export function run() {
  let x = 0, y = 0;
  [x, y = 5] = [1];
  return x * 10 + y;
}`,
      "run",
    );
    expect(litValue(run())).toBe(15);
  });
});

describe("B-path assignment evaluation order", () => {
  it("a = (a = 10) + a reads updated value (10 + 10 = 20)", async () => {
    const run = await execTranspiled(
      `export function run() {
  let a = 5;
  a = (a = 10) + a;
  return a;
}`,
      "run",
    );
    expect(litValue(run())).toBe(20);
  });

  it("n += n += 1 captures lhs first (1 + 2 = 3)", async () => {
    const run = await execTranspiled(
      `export function run() {
  let n = 1;
  n += n += 1;
  return n;
}`,
      "run",
    );
    expect(litValue(run())).toBe(3);
  });
});
