/**
 * 引擎精度残余验证：
 * T5 成员/类方法调用点收集 → call@ 合成
 * T6 类方法 derivation 根走类方法桥（不再 fail-closed 跳过）
 * T7 方法槽 returnType 在首次调用后填入（展示不再恒 `() => ?`）
 */
import { describe, it, expect } from "vitest";
import { deriveFromRoot } from "@nudojs/service/emit";
import { analyzeFile, collectCallRecords } from "@nudojs/service";
import { formatAbs, checkSource, pTrue, runTranspiled, callTranspiledExportFull, $new, $invoke, litValue, abs, pTrue as pt } from "@nudojs/core";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultLoadModule } from "@nudojs/service";

describe("T5 member / class-method call-site collection", () => {
  it("bare obj.method() is collected as a call record", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-t5-"));
    try {
      writeFileSync(join(dir, "usage.js"), `
const obj = { area() { return 1; } };
obj.area();
`);
      const records = collectCallRecords(join(dir, "usage.js"), readFileSync(join(dir, "usage.js"), "utf-8"));
      const area = records.filter((r) => r.fnName === "area" || r.fnName.endsWith(".area"));
      expect(area.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("class instance method is recorded as Class.method", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-t5b-"));
    try {
      writeFileSync(join(dir, "geom.js"), `
export class Circle {
  constructor(r) { this.r = r; }
  area() { return 3.14 * this.r * this.r; }
}
export function compute(r) {
  const circle = new Circle(r);
  return circle.area();
}
`);
      writeFileSync(join(dir, "usage.js"), `
import { Circle, compute } from "./geom.js";
export function wrapped(r) {
  const c = new Circle(r);
  return c.area();
}
compute(5);
`);
      const records = collectCallRecords(join(dir, "usage.js"), readFileSync(join(dir, "usage.js"), "utf-8"));
      const area = records.filter((r) => r.fnName === "Circle.area" || r.fnName === "area");
      expect(area.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("internal circle.area() inside compute yields call@ for Circle.area", () => {
    const src = `
export class Circle {
  constructor(r) { this.r = r; }
  area() { return 3.14 * this.r * this.r; }
}
export function compute(r) {
  const circle = new Circle(r);
  return circle.area();
}
compute(2);
`;
    const r = analyzeFile("/tmp/t5-internal.js", src);
    const areaFn = r.functions.find((f) => f.name === "Circle.area" || f.name === "area");
    expect(areaFn).toBeDefined();
    const call = areaFn!.cases.find((c) => c.name.startsWith("call@"));
    expect(call).toBeDefined();
  });
});

describe("T6 class-method derivation bridge", () => {
  it("class method root is recognized (hasRoot) and derives downstream", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-t6-"));
    try {
      writeFileSync(join(dir, "add.js"), `
export function add2(x) { return x + 2; }
`);
      writeFileSync(join(dir, "lib.js"), `
import { add2 } from "./add.js";
export class Adder {
  add4(x) { return add2(x + 1) + 1; }
}
`);
      writeFileSync(join(dir, "lib.nudo.js"), `import { number, fn } from "@nudojs/core";
export const positive = number().gt(0);
export const positive4 = number().gt(4);
export const Adder_add4 = fn({ x: positive }, positive4);
`);
      const r = deriveFromRoot(join(dir, "lib.js"), {
        loadModule: defaultLoadModule,
      });
      console.log("T6 roots:", r.roots, "hasRoot:", r.hasRoot, "derived:", r.derived.map((d) => d.fn));
      expect(r.hasRoot).toBe(true);
      expect(r.roots).toContain("Adder.add4");
      // 下游 add2 应有推导产出
      const add2 = r.derived.find((d) => d.fn === "add2" || d.fn.endsWith("add2"));
      expect(add2).toBeDefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("functionParamNames resolves Class.method params", async () => {
    const { functionParamNames } = await import("../interface-derivation.ts");
    const src = `
export class Adder {
  add(a, b) { return a + b; }
}
`;
    expect(functionParamNames(src, "Adder.add")).toEqual(["a", "b"]);
  });
});

describe("T7 method slot returnType after first call", () => {
  it("called method slot fills returnType; uncalled stays () => ?", () => {
    const src = `
function createCounter() {
  let count = 0;
  return {
    increment() { count = count + 1; return count; },
    getCount() { return count; }
  };
}
export function use() {
  const c = createCounter();
  c.increment();
  return c;
}
`;
    const r = analyzeFile("/tmp/t7-slot.js", src);
    const use = r.functions.find((f) => f.name === "use");
    const call = use?.cases.find((c) => c.name.startsWith("call@") || c.name.startsWith("entry@"));
    const display = call ? formatAbs(call.abs) : "NO_CASE";
    console.log("T7 display:", display);
    // 已调用的 increment 不再是 `() => ?`
    expect(display).not.toMatch(/increment: \(\) => \?/);
    expect(display).toMatch(/increment: \(\) => /);
    // 未调用的 getCount 仍诚实显示 `() => ?`（未调用前无 returnType）
    expect(display).toMatch(/getCount: \(\) => \?/);
  });

  it("both methods fill once both are called", () => {
    const src = `
function createCounter() {
  let count = 0;
  return {
    increment() { count = count + 1; return count; },
    getCount() { return count; }
  };
}
export function use() {
  const c = createCounter();
  c.increment();
  c.getCount();
  return c;
}
`;
    const r = analyzeFile("/tmp/t7-slot2.js", src);
    const use = r.functions.find((f) => f.name === "use");
    const call = use?.cases.find((c) => c.name.startsWith("call@") || c.name.startsWith("entry@"));
    const display = call ? formatAbs(call.abs) : "NO_CASE";
    console.log("T7 display both:", display);
    expect(display).not.toMatch(/increment: \(\) => \?/);
    expect(display).not.toMatch(/getCount: \(\) => \?/);
  });

  it("uncalled method with formals shows param names (not fake zero-arity)", () => {
    const src = `
function make() {
  return {
    add(n) { return n + 1; },
    tag() { return 1; }
  };
}
export function use() { const o = make(); return o; }
`;
    const r = analyzeFile("/tmp/t7-slot-params.js", src);
    const use = r.functions.find((f) => f.name === "use");
    const call = use?.cases.find((c) => c.name.startsWith("call@") || c.name.startsWith("entry@"));
    const display = call ? formatAbs(call.abs) : "NO_CASE";
    console.log("T7 display formals:", display);
    // 有形参 → 展示形参名；returnType 仍诚实 `?`
    expect(display).toMatch(/add: \(n\) => \?/);
    // 真零参仍 `() => ?`（诚实）
    expect(display).toMatch(/tag: \(\) => \?/);
  });

  it("uncalled class method extract shows param names", () => {
    const src = `
export class C {
  add(n) { return n + 1; }
  tag() { return 1; }
  static make(a) { return new C(); }
}
export function use() {
  const o = new C();
  return { add: o.add, tag: o.tag, make: C.make };
}
`;
    const r = analyzeFile("/tmp/t7-slot-class.js", src);
    const use = r.functions.find((f) => f.name === "use");
    const call = use?.cases.find((c) => c.name.startsWith("call@") || c.name.startsWith("entry@"));
    const display = call ? formatAbs(call.abs) : "NO_CASE";
    console.log("T7 display class extract:", display);
    expect(display).toMatch(/add: \(n\) => \?/);
    expect(display).toMatch(/tag: \(\) => \?/);
    expect(display).toMatch(/make: \(a\) => \?/);
  });
});
