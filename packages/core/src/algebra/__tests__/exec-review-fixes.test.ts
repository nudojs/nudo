/**
 * loop-fix 审查修复差分回归：$in class 原型成员、instanceof 非标识符 RHS、
 * 静态访问器、对象字面量 delete 访问器、own 槽优先、bigint >>>、
 * classChainNames env 回退、generator instanceof。
 * 每条断言与 Node 真实执行结果对齐（或明确为 sound 的 unknown/boolean）。
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
  instanceOf,
  abs,
  type Abs,
} from "@nudojs/core";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const runtimeUrl = pathToFileURL(
  join(dirname(fileURLToPath(import.meta.url)), "../exec/index.ts"),
).href;

async function execTranspiled(source: string, exportName = "run") {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bpath-review-"));
  dirs.push(dir);
  const js = transpile(source, { runtimeImport: runtimeUrl });
  const modPath = join(dir, "mod.mjs");
  writeFileSync(modPath, js, "utf-8");
  const mod = await import(pathToFileURL(modPath).href);
  return mod[exportName] as (...args: unknown[]) => Abs;
}

function brandAbs(name: string): Abs {
  return abs(
    { k: "brand", name, shape: { k: "obj", slots: {} } },
    undefined,
    undefined,
    "exact",
  );
}

describe("review-fix: $in on class prototype members", () => {
  it("class method key is present (native true)", async () => {
    const run = await execTranspiled(
      `export function run(){ class A{ greet(){ return 1; } } const a=new A(); return "greet" in a; }`,
    );
    expect(litValue(run())).toBe(true);
  });

  it("class accessor key is present (native true)", async () => {
    const run = await execTranspiled(
      `export function run(){ class A{ get x(){ return 5; } } const a=new A(); return "x" in a; }`,
    );
    expect(litValue(run())).toBe(true);
  });

  it("Date builtin method key is present (native true)", async () => {
    const run = await execTranspiled(
      `export function run(){ const d=new Date(0); return "getTime" in d; }`,
    );
    expect(litValue(run())).toBe(true);
  });
});

describe("review-fix: instanceof non-ident / generator / unknown ctor", () => {
  it("member-expression RHS stays abstract boolean, never exact undefined", async () => {
    const run = await execTranspiled(
      `export function run(){ const ns={C: class{}}; const o={}; return o instanceof ns.C; }`,
    );
    const r = run();
    expect(formatShape(r)).toBe("boolean");
    expect(litValue(r)).toBeUndefined();
  });

  it("paren ClassExpression RHS stays abstract boolean", async () => {
    const run = await execTranspiled(
      `export function run(){ const o={}; return o instanceof (class{}); }`,
    );
    const r = run();
    expect(formatShape(r)).toBe("boolean");
    expect(litValue(r)).toBeUndefined();
  });

  it("ClassExpression value is fn-shaped, not exact undefined", async () => {
    const run = await execTranspiled(
      `export function run(){ const o={C: class{}}; return o.C; }`,
    );
    const r = run();
    expect(r.shape.k).toBe("fn");
  });

  it("generator eff shape instanceof Generator is true", async () => {
    const { $instanceof } = await import(
      pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "../exec/index.ts")).href
    );
    const gen = abs({ k: "eff", eff: "generator" }, undefined, undefined, "path") as Abs;
    const r = $instanceof(gen, "Generator");
    expect(litValue(r)).toBe(true);
  });

  it("B-path generator call value is not exact undefined/false for instanceof", async () => {
    // B-path $gen 收集 yield 值而非 Iterator 对象；不得折精确 undefined/false
    const run = await execTranspiled(
      `export function run(){ function* g(){ yield 1; } return g() instanceof Generator; }`,
    );
    const r = run();
    expect(formatShape(r)).toBe("boolean");
    expect(litValue(r)).toBeUndefined();
  });

  it("arr instanceof custom name is not exact false", async () => {
    const run = await execTranspiled(
      `export function run(a){ return a instanceof MyArr; }`,
      "run",
    );
    // 传入抽象无法在 B-path 路径测 brand 子类；直接测 transpile 后 $instanceof 行为
    const { $instanceof, $arr, $lit } = await import(
      pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "../exec/index.ts")).href
    );
    const r = $instanceof($arr([$lit(1)]), "MyArr");
    expect(formatShape(r)).toBe("boolean");
    expect(litValue(r)).toBeUndefined();
  });
});

describe("review-fix: static accessors", () => {
  it("static getter read on class", async () => {
    const run = await execTranspiled(
      `export function run(){ class A{ static get x(){ return 5; } } return A.x; }`,
    );
    expect(litValue(run())).toBe(5);
  });

  it("static setter write then getter", async () => {
    const run = await execTranspiled(
      `export function run(){
  class A{ static get x(){ return this._x; } static set x(v){ this._x = v * 2; } }
  A.x = 7;
  return A.x;
}`,
    );
    expect(litValue(run())).toBe(14);
  });

  it("instance read of static-only accessor key is undefined", async () => {
    const run = await execTranspiled(
      `export function run(){ class A{ static get x(){ return 5; } } return new A().x; }`,
    );
    expect(litValue(run())).toBeUndefined();
  });
});

describe("review-fix: object-literal accessor delete", () => {
  it("delete own accessor key; subsequent read is undefined", async () => {
    const run = await execTranspiled(
      `export function run(){
  const o = { get x(){ return 5; } };
  delete o.x;
  return o.x;
}`,
    );
    expect(litValue(run())).toBeUndefined();
  });
});

describe("review-fix: own slot wins over prototype accessor", () => {
  it("getter+setter parent, child own write via setter then read", async () => {
    const run = await execTranspiled(
      `export function run(){
  class A{
    constructor(){ this._x = 1; }
    get x(){ return this._x; }
    set x(v){ this._x = v; }
  }
  class B extends A {
    constructor(){ super(); this.x = 5; }
  }
  return new B().x;
}`,
    );
    expect(litValue(run())).toBe(5);
  });
});

describe("review-fix: bigint >>> is unknown, not bigint", () => {
  it("5n >>> 1n never claims bigint result", async () => {
    const run = await execTranspiled(`export function run(){ return 5n >>> 1n; }`);
    const r = run();
    expect(formatShape(r)).toBe("unknown");
    expect(litValue(r)).toBeUndefined();
  });
});

describe("review-fix: classChainNames env fallback (ast-eval path)", () => {
  const envWithUser = {
    classes: new Map([
      ["User", { name: "User", superClass: undefined, methods: new Map(), statics: new Map() }],
    ]),
  } as never;

  it("RangeError instanceof Error with non-empty env", () => {
    const r = instanceOf(brandAbs("RangeError"), "Error", envWithUser);
    expect(litValue(r)).toBe(true);
  });

  it("RangeError instanceof Error with empty env", () => {
    const r = instanceOf(brandAbs("RangeError"), "Error", { classes: new Map() } as never);
    expect(litValue(r)).toBe(true);
  });

  it("user class chain with env", () => {
    const env = {
      classes: new Map([
        ["A", { name: "A", superClass: undefined, methods: new Map(), statics: new Map() }],
        ["B", { name: "B", superClass: "A", methods: new Map(), statics: new Map() }],
      ]),
    } as never;
    expect(litValue(instanceOf(brandAbs("B"), "A", env))).toBe(true);
    expect(litValue(instanceOf(brandAbs("B"), "Error", env))).toBe(false);
  });
});
