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
import { analyzeFn } from "../index.ts";

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

describe("B-path compound assignment bitwise/shift/pow operators", () => {
  // COMPOUND_OPS 表只登记 += -= *= /= %=——**= <<= >>= >>>= &= |= ^=
  // 落「x = rhs」路径（x >>= 1 折 1、x **= 3 折 3），读-改-写整体丢失。
  it("identifier targets fold the operator, not the rhs", async () => {
    const run = await execTranspiled(
      `export function run() {
  let x = 7; x >>= 1;
  let y = 1; y <<= 3;
  let z = -7; z >>>= 1;
  let a = 5; a &= 3;
  let b = 5; b |= 3;
  let c = 5; c ^= 3;
  let p = 2; p **= 10;
  return '' + x + ',' + y + ',' + z + ',' + a + ',' + b + ',' + c + ',' + p;
}`,
      "run",
    );
    expect(litValue(run())).toBe("3,8,2147483644,1,7,6,1024");
  });

  it("member targets read-modify-write the current slot", async () => {
    const run = await execTranspiled(
      `export function run(o) { o.n >>= 1; o.m **= 3; o.k &= 3; return o.n * 100 + o.m * 10 + o.k; }`,
      "run",
    );
    // 7>>1=3, 2**3=8, 5&3=1 → 381
    expect(litValue(run($obj({ n: $lit(7), m: $lit(2), k: $lit(5) })))).toBe(381);
  });

  it("element targets read-modify-write in place (aliases see it)", async () => {
    const run = await execTranspiled(
      `export function run() { let a = [1,2]; const b = a; b[0] |= 4; return a[0] * 10 + a[1]; }`,
      "run",
    );
    expect(litValue(run())).toBe(52);
  });

  it("assignment expression value is the written value", async () => {
    const run = await execTranspiled(
      `export function run() { let x = 7; return (x >>= 1); }`,
      "run",
    );
    expect(litValue(run())).toBe(3);
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

describe("ast-eval compound assignment bitwise/shift/pow parity", () => {
  // ast-eval applyBin 只折叠 + - * / %——位运算/移位/幂复合赋值落 unknown。
  // 与 B-path COMPOUND_OPS 同轨修复后折叠。
  it("identifier targets fold", () => {
    expect(
      litValue(analyzeFn(`function f() { let x = 7; x >>= 1; return x; }`, "f", [])),
    ).toBe(3);
    expect(
      litValue(analyzeFn(`function f() { let x = 2; x **= 10; return x; }`, "f", [])),
    ).toBe(1024);
    expect(
      litValue(analyzeFn(`function f() { let x = -7; x >>>= 1; return x; }`, "f", [])),
    ).toBe(2147483644);
  });

  it("member targets fold", () => {
    expect(
      litValue(analyzeFn(`function f() { const o = {n: 5}; o.n &= 3; return o.n; }`, "f", [])),
    ).toBe(1);
  });

  it("assignment expression value is the written value", () => {
    expect(
      litValue(analyzeFn(`function f() { let x = 7; return (x <<= 2); }`, "f", [])),
    ).toBe(28);
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
