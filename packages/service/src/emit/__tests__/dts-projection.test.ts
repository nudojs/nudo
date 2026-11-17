/**
 * 模块套件：dts 投影面（声明形态 × 可编译性 × 负控制）。
 */
import { describe, it, expect } from "vitest";
import { abs, num, objOf, type Abs, localNamedExports, str, lit, v } from "@nudojs/core";
import { absToTSType, dtsModuleSurface, projectFunctionDts, projectModuleDts, generateDts, type DtsContractFace } from "../dts-generator.ts";
import { tscNoEmit } from "./dts-tsc.ts";
import { analyzeFile } from "@nudojs/service";
import type { AnalysisResult, FunctionAnalysis } from "../../analyzer-types.ts";
import { absToSchemaSource } from "../schema-generator.ts";

/**
 * 模块套件：dts 投影面（声明形态 × 可编译性 × 负控制）。
 *
 * 13 个原 part/entry 的用例按投影面归并：brand/extends/成员/契约可选性/
 * 解构/导出形态/泛型/元数/rest/可解析注解/值导出/namespace。缺陷编号只保留
 * 在 it 标题的 provenance。
 */











// ---------------------------------------------------------------------------
// dts 面不得产出未声明的类型名
// ---------------------------------------------------------------------------
describe("dts 面不得产出未声明的类型名", () => {
/**
 * dts 面不得产出「从未声明的类型名」（用户类 brand）。
 *
 * 改前：`absToTSType(brand("Counter"))` = `Counter` ⇒ 产物里那个类名**从未
 * 声明** ⇒ 消费方 tsc 报 **TS2304**（"Cannot find name 'Counter'"）。
 *
 * 修法（模块面口径）：
 * - **本地声明**的类 ⇒ 保留类名 + `declare class`（既有口径不变）；
 * - **import 进来**的类 ⇒ 保留类名 + 补 `import type { C } from "…";`
 * （族 15 S11 的 zod 白名单口径：「补 import 的类名不能被误杀」——不能把
 * 所有未声明的类型名一律降级）；
 * - **两边都没有**的类名（用户类 brand 来自未声明的名字）⇒ 降级为 `unknown`
 * 并在产物头部留**降级台账**（可诊断）。
 *
 * TS 全局类型名（Date / RegExp / Error / URL …，与 zod 白名单同名单）原样保留。
 * 纯投影面（`absToTSType` 单值投影，无模块面）保持既有口径不变。
 */





const brandOf = (name: string): Abs =>
  abs({ k: "brand", name, shape: objOf({}) }, undefined, undefined, "path");

/** 假 fn（返回位给定） */
function fakeFn(name: string, outAbs: Abs): unknown {
  return { name, cases: [{ name: "c", argAbs: [num()], args: [], abs: outAbs }] };
}

/** 模块面 dts（CLI export --format dts 的产品面路径） */
function moduleDts(source: string, fn: unknown): string {
  const surface = dtsModuleSurface(source);
  const typed = fn as Parameters<typeof projectFunctionDts>[0];
  const projection = projectFunctionDts(typed, undefined, surface);
  return projectModuleDts(surface, [{ fn: typed, projection }]).lines.join("\n");
}


  it("未声明的类 brand：降级为 unknown + 降级台账（改前：TS2304）；import 进来的类：类名保留 + 补 import type（不被误杀）；import 进来的类：产物可编译（消费方能按该类使用）；改前形态确实红（未声明的类型名 ⇒ TS2304）；负控制：本地声明的类不变（Bug 517 口径：声明 + 类名保留）；负控制：TS 全局类型名 brand 逐字不变（与 zod 白名单同名单）；负控制：纯投影面（无模块面）保持既有口径（类名原样）", () => {
  {
    const dts = moduleDts(
      `export function make() { return 1; }\n`,
      fakeFn("make", brandOf("Counter")),
    );
    // 返回位不再是「从未声明的类型名」
    expect(dts).not.toMatch(/:\s*Counter/);
    expect(dts).toMatch(/export declare function make\([^)]*\): unknown;/);
    // 可诊断：台账点名被降级的类名
    expect(dts).toContain("nudo:unresolved-class");
    expect(dts).toContain("Counter");
  }
  {
    const dts = moduleDts(
      `import { Counter } from "./counter.js";\nexport function make() { return 1; }\n`,
      fakeFn("make", brandOf("Counter")),
    );
    expect(dts).toContain('import type { Counter } from "./counter.js";');
    expect(dts).toMatch(/export declare function make\([^)]*\): Counter;/);
    expect(dts).not.toContain("nudo:unresolved-class");
  }
  {
    const dts = moduleDts(
      `import { Counter } from "./counter.js";\nexport function make() { return 1; }\n`,
      fakeFn("make", brandOf("Counter")),
    );
    const check = tscNoEmit({
      "counter.d.ts": `export declare class Counter { v: number; }\n`,
      "lib.d.ts": dts,
      "use.ts": `import { make } from "./lib.js";\nimport { Counter } from "./counter.js";\nexport const c: Counter = make(1);\n`,
    });
    expect(check.ok, check.stderr).toBe(true);
  }
  {
    const before = `export declare function make(x: number): Counter;\n`;
    const check = tscNoEmit({
      "lib.d.ts": before,
      "use.ts": `import { make } from "./lib.js";\nexport const c = make(1);\n`,
    });
    expect(check.ok).toBe(false);
    expect(check.stderr).toContain("TS2304");
  }
  {
    const dts = moduleDts(
      `export class Counter {\n  constructor(v) { this.v = v; }\n}\nexport function make() { return 1; }\n`,
      fakeFn("make", brandOf("Counter")),
    );
    expect(dts).toContain("declare class Counter");
    expect(dts).toMatch(/export declare function make\([^)]*\): Counter;/);
    expect(dts).not.toContain("nudo:unresolved-class");
  }
  {
    const dts = moduleDts(
      `export function make() { return 1; }\n`,
      fakeFn("make", brandOf("Date")),
    );
    expect(dts).toMatch(/export declare function make\([^)]*\): Date;/);
    expect(dts).not.toContain("nudo:unresolved-class");
  }
  {
    expect(absToTSType(brandOf("User"))).toBe("User");
  }
});







});

// ---------------------------------------------------------------------------
// dts 类面保留 extends 与实例字段
// ---------------------------------------------------------------------------
describe("dts 类面保留 extends 与实例字段", () => {
/**
 * 类的 `extends` 在 `.d.ts` 里被整条丢弃（类面扫描只采方法与构造器）
 * ⇒ 产物里 `class B extends A` 变成 `class B`：
 * - `const b: A = new B()` 报 TS2741（缺 A 的成员）；
 * - `b.am()`（继承方法）报 TS2339；
 * - 实例字段（构造器 `this.x = …` / 类属性初始化器）**一个都不声明**
 * ⇒ `b.y` 也是 TS2339。
 *
 * 判据：超类名**可解析**（本地类 / 导入类 / TS 全局构造器）才进 `extends`
 * （否则会造出 TS2304）；实例字段从源码面采集，继承来的字段不重复声明。
 */





function moduleDts(source: string, path = "/test/bug151.ts"): string {
  const result = analyzeFile(path, source);
  const surface = dtsModuleSurface(source);
  const entries = result.functions
    .filter((fn) => fn.cases.length > 0)
    .map((fn) => ({ fn, projection: projectFunctionDts(fn, undefined, surface) }));
  return projectModuleDts(surface, entries).lines.join("\n");
}


  it("`class B extends A` 在产物里带超类；本类字段声明、继承字段不重复；消费方：子类可赋给父类类型；继承方法与字段可访问；类属性初始化器（`count = 3` / `label = \"p\"`）也进实例字段面；负控制：`extends` 一个未声明的名字 ⇒ 不发射 extends（消费方零 TS2304）；负控制：TS 全局构造器名（`extends Error`）照旧放行", () => {
  {
    const dts = moduleDts(`export class A {
  constructor() {
    this.x = 1;
  }
  am() {
    return 1;
  }
}
export class B extends A {
  constructor() {
    super();
    this.y = 2;
  }
  bm() {
    return 2;
  }
}
`);
    expect(dts).toContain("export declare class A {");
    expect(dts).toContain("export declare class B extends A {");
    const bStart = dts.indexOf("export declare class B extends A {");
    const bBody = dts.slice(bStart, dts.indexOf("\n}", bStart));
    // 继承来的字段不在子类里重复声明（语义重复 + 类型面自相矛盾）
    expect(bBody).not.toContain("x: number;");
    expect(bBody).toMatch(/y: number;/);
    expect(dts).toMatch(/am\(/);
    expect(dts).toMatch(/bm\(/);
  }
  {
    const dts = moduleDts(`export class A {
  constructor() {
    this.x = 1;
  }
  am() {
    return 1;
  }
}
export class B extends A {
  constructor() {
    super();
    this.y = "s";
  }
}
`);
    expect(dts).toContain("export declare class B extends A {");
    const check = tscNoEmit({
      "mod.d.ts": dts,
      "use.ts":
        'import { A, B } from "./mod.js";\n' +
        "const b = new B();\n" +
        "const n: number = b.x;\n" +
        "const s: string = b.y;\n" +
        "const r = b.am();\n" +
        "const asA: A = b;\n" +
        "export { n, s, r, asA };\n",
    });
    expect(check.ok, check.stderr).toBe(true);
  }
  {
    const dts = moduleDts(`export class P {
  count = 3;
  label = "p";
  tags = [];
  state = null;
}
`);
    expect(dts).toMatch(/count: number;/);
    expect(dts).toMatch(/label: string;/);
    expect(dts).toMatch(/tags: unknown\[\];/);
    expect(dts).toMatch(/state: null;/);
  }
  {
    const dts = moduleDts(`export class C extends NotDeclaredHere {
  m() {
    return 1;
  }
}
`);
    expect(dts).toContain("export declare class C {");
    expect(dts).not.toContain("extends");
    const check = tscNoEmit({ "mod.d.ts": dts });
    expect(check.ok, check.stderr).toBe(true);
  }
  {
    const dts = moduleDts(`export class MyError extends Error {
  constructor(message) {
    super(message);
    this.name = "MyError";
  }
}
`);
    expect(dts).toContain("export declare class MyError extends Error {");
    const check = tscNoEmit({ "mod.d.ts": dts });
    expect(check.ok, check.stderr).toBe(true);
  }
});



  // ── 负控制：不可解析的超类名不进产物（否则 TS2304）──────────────


});

// ---------------------------------------------------------------------------
// static-only 方法不再多发幻影实例声明
// ---------------------------------------------------------------------------
describe("static-only 方法不再多发幻影实例声明", () => {
/**
 * 缺陷报告分册 05-dts-fidelity —— 类成员面 / 修饰符 / 名义标记 / 索引签名。
 *
 * 覆盖：（static-only 幻影实例方法）、（static 字段 + 访问器）、
 * （abstract 类与成员）、（注解-only 实例字段）、* （TSParameterProperty）、（private / protected）、（#private
 * 名义标记）、（index signature）。
 *
 * 用 CLI 同一条模块面投影链 + 真 tsc --noEmit --strict 校验产物 / 消费端。
 */







function exportFaceFunctions(source: string, result: AnalysisResult): FunctionAnalysis[] {
  const entryNames = localNamedExports(source);
  const onExportFace = (name: string): boolean => {
    if (entryNames.has(name) || name === "default") return true;
    const m = /^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/.exec(name);
    return m !== null && entryNames.has(m[1]!);
  };
  return result.functions.filter((f) => f.cases.length > 0 && onExportFace(f.name));
}

function moduleDts(source: string, path = "/test/bug-report-class.ts"): string {
  const result = analyzeFile(path, source);
  const surface = dtsModuleSurface(source);
  const entries = exportFaceFunctions(source, result).map((fn) => ({
    fn,
    projection: projectFunctionDts(fn, undefined, surface),
  }));
  const values = new Map<string, Abs>();
  for (const [name, info] of result.bindings) values.set(name, info.abs);
  return projectModuleDts(surface, entries, { values }).lines.join("\n");
}

{
  const SRC = `export class C {
  static only(v) { return v; }
}
`;

  it("只声明 static only（没有同名实例方法）；同名 static + instance 同时存在时两者都保留（既有口径不回退）", () => {
  {
    const dts = moduleDts(SRC);
    expect(dts).toContain("static only(");
    expect(dts).not.toMatch(/^  only\(/m);
  }
  {
    const dts = moduleDts(`export class C {
  m() { return 1; }
  static m(y) { return 2; }
}
`);
    expect(dts).toMatch(/^  m\(/m);
    expect(dts).toContain("static m(");
    // 类实例方法返回类型由 的入口兜底派发补全：unknown → number。
    // 本断言的目标是「同名 static / instance 两条声明都在」，类型精度
    // 跟随分析面（与 dts 单元面对齐），不再钉死 unknown。
    expect((dts.match(/^  m\(.*\): (number|unknown);/gm) ?? []).length).toBe(1);
  }
});

}

describe("static 字段与 getter/setter 进产物", () => {
  const SRC = `export class A {
  static count = 0;
  value = 2;
  get double() { return this.value * 2; }
  set double(v) { this.value = v / 2; }
  static { A.count = 5; }
  m() { return 1; }
}
`;

  it("static 字段 / 访问器 / 实例字段都在；消费端读这些成员通过 tsc（改前 TS2339 ×2）", () => {
  {
    const dts = moduleDts(SRC);
    expect(dts).toContain("static count: number;");
    expect(dts).toMatch(/get double\(\):/);
    expect(dts).toMatch(/set double\(v:/);
    expect(dts).toContain("value: number;");
  }
  {
    const check = tscNoEmit({
      "mod.d.ts": moduleDts(SRC),
      "use.ts":
        'import { A } from "./mod.js";\nexport const a = A.count;\nexport const b = new A().double;\nexport const c = new A().value;\n',
    });
    expect(check.ok, check.stderr).toBe(true);
  }
});

});

describe("abstract 修饰符与 abstract 成员", () => {
  const SRC = `export abstract class Shape {
  abstract area(): number;
  abstract label(): string;
  describe() { return this.label(); }
}
`;

  it("类头带 abstract、抽象成员带源码返回注解；消费端可用继承来的抽象成员（改前 TS2339）；消费端 new Shape() 被拦下（改前可实例化抽象类）", () => {
  {
    const dts = moduleDts(SRC);
    expect(dts).toContain("export declare abstract class Shape {");
    expect(dts).toContain("abstract area(): number;");
    expect(dts).toContain("abstract label(): string;");
  }
  {
    const check = tscNoEmit({
      "mod.d.ts": moduleDts(SRC),
      "use.ts":
        'import { Shape } from "./mod.js";\ndeclare const s: Shape;\nexport const a: number = s.area();\nexport const l: string = s.label();\n',
    });
    expect(check.ok, check.stderr).toBe(true);
  }
  {
    const check = tscNoEmit({
      "mod.d.ts": moduleDts(SRC),
      "use.ts": 'import { Shape } from "./mod.js";\nexport const inst = new Shape();\n',
    });
    expect(check.ok).toBe(false);
    expect(check.stderr).toContain("TS2511");
  }
});


});

describe("只有类型注解的实例字段不塌成 unknown", () => {
  const SRC = `export class Account {
  id: number;
  name: string;
  active: boolean;
  constructor(id: number, name: string, active: boolean) {
    this.id = id; this.name = name; this.active = active;
  }
  label(): string { return this.name; }
}
export class Counter { count: number = 0; label: string = "c"; }
`;

  it("注解字段用源码声明类型（同类初始化器字段不受影响）；消费端字段读取通过 tsc（改前 TS2322 ×3）", () => {
  {
    const dts = moduleDts(SRC);
    expect(dts).toContain("id: number;");
    expect(dts).toContain("name: string;");
    expect(dts).toContain("active: boolean;");
    expect(dts).toContain("count: number;");
  }
  {
    const check = tscNoEmit({
      "mod.d.ts": moduleDts(SRC),
      "use.ts":
        'import { Account } from "./mod.js";\ndeclare const a: Account;\nexport const id: number = a.id;\nexport const name: string = a.name;\nexport const act: boolean = a.active;\n',
    });
    expect(check.ok, check.stderr).toBe(true);
  }
});

});

describe("TS 构造器参数属性登记成实例字段", () => {
  const SRC = `export class Account {
  constructor(public id: number, protected name: string, readonly active: boolean = true) {}
  getId(): number { return this.id; }
}
`;

  it("字段带源码类型 / 访问修饰符 / readonly，构造器形参类型也保真；消费端 `new Account(...).id` 通过 tsc（改前 TS2339）", () => {
  {
    const dts = moduleDts(SRC);
    expect(dts).toContain("constructor(id: number, name: string, active?: boolean);");
    expect(dts).toContain("id: number;");
    expect(dts).toContain("protected name: string;");
    expect(dts).toContain("readonly active: boolean;");
  }
  {
    const check = tscNoEmit({
      "mod.d.ts": moduleDts(SRC),
      "use.ts":
        'import { Account } from "./mod.js";\nconst a = new Account(1, "n", true);\nexport const id: number = a.id;\nexport const active: boolean = a.active;\n',
    });
    expect(check.ok, check.stderr).toBe(true);
  }
});

});

describe("private / protected 成员不再翻成 public", () => {
  const SRC = `export class C {
  private secret = 1;
  protected guarded = 2;
  private hidden() { return 3; }
  protected shield() { return 4; }
  public m() { return this.secret + this.hidden(); }
}
`;

  it("字段与方法都带访问修饰符；消费端读私有面被 tsc 拦下（改前假绿）", () => {
  {
    const dts = moduleDts(SRC);
    expect(dts).toContain("private secret: number;");
    expect(dts).toContain("protected guarded: number;");
    // 同上：修好后私有/保护方法也拿到精确返回类型（number）。
    expect(dts).toMatch(/private hidden\(\): (number|unknown);/);
    expect(dts).toMatch(/protected shield\(\): (number|unknown);/);
  }
  {
    const check = tscNoEmit({
      "mod.d.ts": moduleDts(SRC),
      "use.ts":
        'import { C } from "./mod.js";\nconst c = new C();\nexport const a = c.secret;\nexport const b = c.hidden();\n',
    });
    expect(check.ok).toBe(false);
    expect(check.stderr).toContain("TS2341");
  }
});

});

describe("`#private;` 名义标记", () => {
  const SRC = `export class A { #x = 1; m() { return this.#x; } }
export class B { #y = 2; m() { return this.#y; } }
`;

  it("两个含 # 私有字段的类都带 #private;；A / B 不可结构互赋（改前 exit 0，源码侧 TS2741）", () => {
  {
    const dts = moduleDts(SRC);
    expect((dts.match(/#private;/g) ?? []).length).toBe(2);
    expect(dts).not.toContain("#x");
  }
  {
    const check = tscNoEmit({
      "mod.d.ts": moduleDts(SRC),
      "use.ts":
        'import { A, B } from "./mod.js";\nconst a: A = new B();\nexport const n = a.m();\n',
    });
    expect(check.ok).toBe(false);
  }
});

});

describe("类 index signature 进产物", () => {
  const SRC = `export class Dict3 {
  [key: string]: number | Function;
  a = 1;
  get(k: string) { return this[k]; }
}
`;

  it("发射 `[key: string]: …;`；消费端索引访问通过 tsc（改前 TS7052 / TS2339）", () => {
  {
    expect(moduleDts(SRC)).toContain("[key: string]: number | Function;");
  }
  {
    const check = tscNoEmit({
      "mod.d.ts": moduleDts(SRC),
      "use.ts":
        'import { Dict3 } from "./mod.js";\nconst d = new Dict3();\nexport const x: number | Function = d["zzz"];\nexport const y: number | Function = d.whatever;\n',
    });
    expect(check.ok, check.stderr).toBe(true);
  }
});

});
});

// ---------------------------------------------------------------------------
// dts 顶层形参吃契约级可选性
// ---------------------------------------------------------------------------
describe("dts 顶层形参吃契约级可选性", () => {
/**
 * 契约的**顶层形参「可选性」**在 dts / zod 面全丢 ⇒ 生成的
 * `.d.ts` **拒绝契约允许的调用**（实测 TS2345）；契约面（权威）却显示
 * `x: number().optional()`。
 *
 * 根因（dts 那半）：顶层形参的「可选」只有**声明级**（带默认值）一个来源，
 * **契约级**（侧车 `fn({ x: number().optional() }, …)`）完全不被读。
 * 契约约束的 `isOptional` 在 `constraintToEntryAbs` 里对标量契约**丢失**
 * （entry Abs 无该信息）⇒ 可选性必须由契约面**显式带过来**。
 *
 * 修法：`DtsContractFace.params[].optional` 新增可选标记（契约面直传
 * `constraint.isOptional`），dts 侧读它渲染 `x?: T`。
 *
 * ⚠️ 越界（不在本分片文件清单内）：CLI 侧
 * `packages/nudojs/src/commands/export.ts` 的 `contractParamsOf` 需补
 * `optional: p.constraint.isOptional === true`；zod 那半
 * （`inputSlots` 装配）归 S6。
 */









const neverAbs = (): Abs =>
  ({ shape: { k: "never" }, conf: "exact" }) as unknown as Abs;



  it("契约声明 optional 的**尾部**形参渲染成 `x?: T`；契约声明 optional 的**中间**形参渲染成 `T | undefined`（TS1016：`?` 不能跟在必填位后）；消费方按契约允许的调用（传 undefined / 省略）不再吃 TS2345；负控制：契约未申报可选的形参仍是必填；负控制：契约覆盖 ⇒ 观测元数不再把契约位标成可选（不裁剪契约义务）", () => {
  {
    const source = `export function act(x, s) { return s; }\n`;
    const result = analyzeFile("/test/s2-copt.js", source);
    const fn = result.functions.find((f) => f.name === "act")!;
    const p = projectFunctionDts(fn, {
      params: [
        { name: "x", abs: num() },
        { name: "s", abs: str(), optional: true },
      ],
    });
    expect(p.lines.join("\n")).toContain(
      "export declare function act(x: number, s?: string)",
    );
  }
  {
    const source = `export function act(x, s) { return s; }\n`;
    const result = analyzeFile("/test/s2-copt-mid.js", source);
    const fn = result.functions.find((f) => f.name === "act")!;
    const p = projectFunctionDts(fn, {
      params: [
        { name: "x", abs: num(), optional: true },
        { name: "s", abs: str() },
      ],
    });
    expect(p.lines.join("\n")).toContain(
      "export declare function act(x: number | undefined, s: string)",
    );
    expect(p.lines.join("\n")).not.toContain("x?: number, s: string");
  }
  {
    const source = `export function act(x, s) { return s; }\n`;
    const result = analyzeFile("/test/s2-copt2.js", source);
    const fn = result.functions.find((f) => f.name === "act")!;
    const p = projectFunctionDts(fn, {
      params: [
        { name: "x", abs: num(), optional: true },
        { name: "s", abs: str() },
      ],
    });
    const check = tscNoEmit({
      "mod.d.ts": p.lines.join("\n") + "\n",
      "use.ts":
        'import { act } from "./mod.js";\nexport const r1 = act(undefined, "hello");\n',
    });
    expect(check.ok, check.stderr).toBe(true);
  }
  {
    const source = `export function act(x, s) { return s; }\n`;
    const result = analyzeFile("/test/s2-copt3.js", source);
    const fn = result.functions.find((f) => f.name === "act")!;
    const p = projectFunctionDts(fn, {
      params: [
        { name: "x", abs: num() },
        { name: "s", abs: str() },
      ],
    });
    expect(p.lines.join("\n")).toContain(
      "export declare function act(x: number, s: string)",
    );
    const check = tscNoEmit({
      "mod.d.ts": p.lines.join("\n") + "\n",
      "use.ts": 'import { act } from "./mod.js";\nexport const r = act(undefined, "hello");\n',
    });
    expect(check.ok).toBe(false);
    expect(check.stderr).toContain("TS2345");
  }
  {
    const fn = {
      name: "addAll",
      loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
      paramNames: ["a", "b"],
      cases: [
        { name: "c", argAbs: [num()], abs: neverAbs(), throwsAbs: neverAbs() },
      ],
    } as unknown as Parameters<typeof projectFunctionDts>[0];
    const p = projectFunctionDts(fn, {
      params: [
        { name: "a", abs: num() },
        { name: "b", abs: num() },
      ],
    });
    expect(p.lines.join("\n")).toContain(
      "export declare function addAll(a: number, b: number)",
    );
  }
});





});

// ---------------------------------------------------------------------------
// dts 解构形参吃契约
// ---------------------------------------------------------------------------
describe("dts 解构形参吃契约", () => {
/**
 * **dts 面**对**解构形参**把**整份手写契约丢掉** ⇒ 生成的
 * `.d.ts` 声明 `act(_p0: unknown): number` ⇒ TS 消费方**零类型检查**
 * （错误调用 `tsc` exit 0 静默放行），而同一次导出的 check / zod /
 * standard 三面**都保真**。
 *
 * 根因：dts 生成器把「契约的形参位」与「分析的形参表」**按名字 join**
 * （`contractByParam.get(bare)`）。分析侧的形参名来自
 * `formalParamDisplayNames` —— 对**解构（pattern）形参**返回**求值占位**
 * `_p0`；而契约侧的键是**绑定名**（`a` / `b`）⇒ 两者永不相交 ⇒ 契约
 * Abs 恒为 undefined ⇒ 形参类型回落成 `unknown`。
 *
 * 修法：解构形参的契约**字段级**条目聚合成该形参的**形状**；形参名用
 * **签名展示名**（`{ a, b }`），不再把求值占位 `_p0` 写进公共 API 声明。
 */









const neverAbs = (): Abs =>
  ({ shape: { k: "never" }, conf: "exact" }) as unknown as Abs;



  it("契约的字段级条目聚合成该形参的形状（不再是 unknown）；消费方错误调用不再静默放行（改前 exit 0）；负控制：契约缺该绑定时回落求值占位（不产出不可编译的模式形态）；负控制：具名形参的契约投影不受影响", () => {
  {
    const source = `export function act({ a, b }) { return a + b; }\n`;
    const result = analyzeFile("/test/s2-destr.js", source);
    const fn = result.functions.find((f) => f.name === "act")!;
    const p = projectFunctionDts(fn, {
      params: [
        { name: "a", abs: num() },
        { name: "b", abs: num() },
      ],
    });
    expect(p.lines.join("\n")).toContain(
      "export declare function act({ a, b }: { a: number; b: number })",
    );
    expect(p.lines.join("\n")).not.toContain("_p0");
  }
  {
    const source = `export function act({ a, b }) { return a + b; }\n`;
    const result = analyzeFile("/test/s2-destr2.js", source);
    const fn = result.functions.find((f) => f.name === "act")!;
    const p = projectFunctionDts(fn, {
      params: [
        { name: "a", abs: num() },
        { name: "b", abs: num() },
      ],
    });
    const check = tscNoEmit({
      "mod.d.ts": p.lines.join("\n") + "\n",
      "use.ts": 'import { act } from "./mod.js";\nexport const r = act({ a: "wrong", b: 2 });\n',
    });
    expect(check.ok).toBe(false);
    // 对象字面量内的类型不匹配 ⇒ TS2322（整体不匹配 ⇒ TS2345）
    expect(check.stderr).toMatch(/TS2322|TS2345/);
  }
  {
    const source = `export function act({ a, b }) { return a + b; }\n`;
    const result = analyzeFile("/test/s2-destr3.js", source);
    const fn = result.functions.find((f) => f.name === "act")!;
    const p = projectFunctionDts(fn, {
      // 契约只覆盖 a —— b 无契约证据 ⇒ 模式形态与类型不匹配 ⇒ 回落占位名
      params: [{ name: "a", abs: num() }],
    });
    expect(p.lines.join("\n")).toContain("act(_p0:");
    const check = tscNoEmit({ "mod.d.ts": p.lines.join("\n") + "\n" });
    expect(check.ok, check.stderr).toBe(true);
  }
  {
    const source = `export function act(a, b) { return a + b; }\n`;
    const result = analyzeFile("/test/s2-named.js", source);
    const fn = result.functions.find((f) => f.name === "act")!;
    const p = projectFunctionDts(fn, {
      params: [
        { name: "a", abs: num() },
        { name: "b", abs: num() },
      ],
    });
    expect(p.lines.join("\n")).toContain(
      "export declare function act(a: number, b: number)",
    );
  }
});




});

// ---------------------------------------------------------------------------
// Unicode 导出名原样保留
// ---------------------------------------------------------------------------
describe("Unicode 导出名原样保留", () => {
/**
 * 缺陷报告分册 05-dts-fidelity —— 导出面 / 默认导出 / 再导出 / 顶层类型 / enum。
 *
 * 覆盖：（Unicode 导出名）、（匿名默认类）、* （`export * as ns from`）、（非函数 default 表达式）、* （顶层 export interface / type）、（const enum）、* （再导出字符串名引号）。
 *
 * 用 CLI 同一条模块面投影链（analyzeFile → dtsModuleSurface →
 * projectFunctionDts → projectModuleDts）+ 真 tsc --noEmit --strict 校验产物。
 */







/** CLI export 面筛选（与 packages/nudojs/src/commands/export/dts-face.ts 同口径）。 */
function exportFaceFunctions(source: string, result: AnalysisResult): FunctionAnalysis[] {
  const entryNames = localNamedExports(source);
  const onExportFace = (name: string): boolean => {
    if (entryNames.has(name) || name === "default") return true;
    const m = /^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/.exec(name);
    return m !== null && entryNames.has(m[1]!);
  };
  return result.functions.filter((f) => f.cases.length > 0 && onExportFace(f.name));
}

/** CLI `export --format dts` 的产品面路径（值类型来自分析面 bindings）。 */
function moduleDts(source: string, path = "/test/bug-report-export.ts"): string {
  const result = analyzeFile(path, source);
  const surface = dtsModuleSurface(source);
  const entries = exportFaceFunctions(source, result).map((fn) => ({
    fn,
    projection: projectFunctionDts(fn, undefined, surface),
  }));
  const values = new Map<string, Abs>();
  for (const [name, info] of result.bindings) values.set(name, info.abs);
  return projectModuleDts(surface, entries, { values }).lines.join("\n");
}

{
  const SRC = `export function café(x) { return x; }
export const 日本 = 1;
`;

  it("dts 不再把合法 Unicode 绑定名洗成 ASCII；消费端 `import { café }` 通过 tsc（改前 TS2305）", () => {
  {
    const dts = moduleDts(SRC);
    expect(dts).toContain("export declare function café(");
    expect(dts).not.toContain("caf_");
    expect(dts).toContain("export declare const 日本: number;");
  }
  {
    const check = tscNoEmit({
      "mod.d.ts": moduleDts(SRC),
      "use.ts": 'import { café, 日本 } from "./mod.js";\nexport const y = café(1);\nexport const z: number = 日本;\n',
    });
    expect(check.ok, check.stderr).toBe(true);
  }
});

}

describe("匿名默认类产出合法 ambient 声明", () => {
  const SRC = `export default class { m() { return 1; } }
`;

  it("不是 `declare class default`（保留字当类名）；产物过 tsc --noEmit --strict（改前 TS1005）", () => {
  {
    const dts = moduleDts(SRC);
    expect(dts).toContain("export default class _default {");
    expect(dts).not.toContain("class default");
    // 补齐类方法入口兜底后返回类型从 unknown 变精确值（此处为
    // number）；本例钉的是匿名默认类的**类名合法性**，不钉返回类型。
    expect(dts).toMatch(/m\(\): [^;]+;/);
  }
  {
    const check = tscNoEmit({ "mod.d.ts": moduleDts(SRC) });
    expect(check.ok, check.stderr).toBe(true);
  }
});

});

describe("`export * as ns from` 发射合法语法", () => {
  const SRC = `export * as ns from "./a.js";
export function anchor(x) { return x; }
`;

  it("用 `export * as ns from`，不是 `export { * as ns } from`；产物过 tsc（改前 TS1003/1005/1128/1434）", () => {
  {
    const dts = moduleDts(SRC);
    expect(dts).toContain('export * as ns from "./a.js";');
    expect(dts).not.toContain("export { * as ns }");
    expect(dts).not.toContain("{ * as");
  }
  {
    const check = tscNoEmit({
      "mod.d.ts": moduleDts(SRC),
      "a.d.ts": "export declare function f(): number;\n",
    });
    expect(check.ok, check.stderr).toBe(true);
  }
});

});

describe("非函数 / 非标识符 default 表达式不消失", () => {
  const SRC = `export default 42;
export function f() { return 1; }
`;

  it("发射 default 值绑定（改前整条消失）；消费端 `import v from` 通过 tsc（改前 TS1192）", () => {
  {
    const dts = moduleDts(SRC);
    expect(dts).toContain("declare const _default: number;");
    expect(dts).toContain("export { _default as default };");
  }
  {
    const check = tscNoEmit({
      "mod.d.ts": moduleDts(SRC),
      "use.ts": 'import v from "./mod.js";\nexport const x: number = v;\n',
    });
    expect(check.ok, check.stderr).toBe(true);
  }
});

});

describe("顶层 export interface / export type 进产物", () => {
  const SRC = `export interface Top { b: number }
export type Alias = number;
export namespace NS { export interface Inner { a: number } }
export function useTop(t: Top): Alias { return t.b; }
`;

  it("顶层类型声明原文镜像（namespace 内同名声明照旧保留）；消费端 type import 通过 tsc（改前 TS2305）", () => {
  {
    const dts = moduleDts(SRC);
    expect(dts).toContain("export interface Top { b: number }");
    expect(dts).toContain("export type Alias = number;");
    expect(dts).toContain("export interface Inner { a: number }");
  }
  {
    const check = tscNoEmit({
      "mod.d.ts": moduleDts(SRC),
      "use.ts": 'import type { Top, Alias } from "./mod.js";\nexport const a: Top = { b: 1 };\nexport const b: Alias = 2;\n',
    });
    expect(check.ok, check.stderr).toBe(true);
  }
});

});

describe("`export const enum` 保留 const 限定", () => {
  const SRC = `export const enum Mode { A = "a", B = "b" }
`;

  it("发射 `export declare const enum`（改前丢 const ⇒ 运行时 import 报错）；消费端 tsc 通过且 const enum 成员可内联使用", () => {
  {
    const dts = moduleDts(SRC);
    expect(dts).toContain("export declare const enum Mode {");
    expect(dts).toContain('A = "a",');
  }
  {
    const check = tscNoEmit({
      "mod.d.ts": moduleDts(SRC),
      "use.ts": 'import { Mode } from "./mod.js";\nexport const a = Mode.A;\n',
    });
    expect(check.ok, check.stderr).toBe(true);
  }
});

});

describe("再导出字符串导出名走 exportNameRepr", () => {
  const SRC = `export { f as "a-b" } from "./a.js";
export function anchor(x) { return x; }
`;

  it("`as \"a-b\"` 不丢引号；产物过 tsc（改前 TS1005×3）", () => {
  {
    const dts = moduleDts(SRC);
    expect(dts).toContain('export { f as "a-b" } from "./a.js";');
    expect(dts).not.toContain("f as a-b");
  }
  {
    const check = tscNoEmit({
      "mod.d.ts": moduleDts(SRC),
      "a.d.ts": "export declare function f(x: unknown): unknown;\n",
      "use.ts": 'import { "a-b" as ab } from "./mod.js";\nexport const z = ab(1);\n',
    });
    expect(check.ok, check.stderr).toBe(true);
  }
});

});
});

// ---------------------------------------------------------------------------
// `extends NS.Base` 不再整条消失
// ---------------------------------------------------------------------------
describe("`extends NS.Base` 不再整条消失", () => {
/**
 * 缺陷报告分册 05-dts-fidelity —— 泛型 / 类型形参 / 形参可省性 / 超类。
 *
 * 覆盖：（namespace 限定超类）、（函数 / 方法级类型形参槽）、
 * （默认值 + 后随 rest 的可省性）、（构造器 / static 默认值）、
 * （导入泛型基类的类型实参）、（类类型形参默认值）。
 *
 * 用 CLI 同一条模块面投影链 + 真 tsc --noEmit --strict 校验产物 / 消费端。
 */







function exportFaceFunctions(source: string, result: AnalysisResult): FunctionAnalysis[] {
  const entryNames = localNamedExports(source);
  const onExportFace = (name: string): boolean => {
    if (entryNames.has(name) || name === "default") return true;
    const m = /^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/.exec(name);
    return m !== null && entryNames.has(m[1]!);
  };
  return result.functions.filter((f) => f.cases.length > 0 && onExportFace(f.name));
}

function moduleDts(source: string, path = "/test/bug-report-generics.ts"): string {
  const result = analyzeFile(path, source);
  const surface = dtsModuleSurface(source);
  const entries = exportFaceFunctions(source, result).map((fn) => ({
    fn,
    projection: projectFunctionDts(fn, undefined, surface),
  }));
  const values = new Map<string, Abs>();
  for (const [name, info] of result.bindings) values.set(name, info.abs);
  return projectModuleDts(surface, entries, { values }).lines.join("\n");
}

{
  const SRC = `import DBase, { Base } from "./base.js";
import * as NS from "./base.js";
export class Sub extends Base { s() { return 3; } }
export class DSub extends DBase { s() { return 4; } }
export class NSub extends NS.Base { s() { return 5; } }
export function anchor(x) { return x; }
`;
  const BASE_DTS = `export declare class Base { b(): unknown; }
export default class DBase { d(): unknown; }
`;

  it("保留 extends NS.Base 并补 import * as NS；消费端能访问继承来的 b()（改前 TS2339）", () => {
  {
    const dts = moduleDts(SRC);
    expect(dts).toContain("export declare class NSub extends NS.Base {");
    expect(dts).toContain('import * as NS from "./base.js";');
    // 同模块的 Identifier / default import 基类照旧保留
    expect(dts).toContain("export declare class Sub extends Base {");
    expect(dts).toContain("export declare class DSub extends DBase {");
  }
  {
    const check = tscNoEmit({
      "mod.d.ts": moduleDts(SRC),
      "base.d.ts": BASE_DTS,
      "use.ts":
        'import { NSub } from "./mod.js";\ndeclare const n: NSub;\nexport const b = n.b();\n',
    });
    expect(check.ok, check.stderr).toBe(true);
  }
});

}

describe("函数 / 方法级类型形参槽", () => {
  const SRC = `export class Box<T> {
  constructor(public v: T) {}
}
export function gen<T>(x: T): T { return x; }
export function pair<A, B>(a: A, b: B): [A, B] { return [a, b]; }
`;

  it("函数声明带 <T> / <A, B>，类级 <T> 保留；消费端显式类型实参通过 tsc（改前 TS2558 ×2）；类方法自己的 <U> 也保留", () => {
  {
    const dts = moduleDts(SRC);
    expect(dts).toContain("export declare function gen<T>(");
    expect(dts).toContain("export declare function pair<A, B>(");
    expect(dts).toContain("export declare class Box<T> {");
  }
  {
    const check = tscNoEmit({
      "mod.d.ts": moduleDts(SRC),
      "use.ts":
        'import { Box, gen, pair } from "./mod.js";\nexport const boxed = new Box<number>(1);\nexport const g = gen<string>("x");\nexport const p = pair<number, string>(1, "s");\n',
    });
    expect(check.ok, check.stderr).toBe(true);
  }
  {
    const dts = moduleDts(`export class C { m<U>(x: U): U { return x; } }
`);
    expect(dts).toMatch(/\bm<U>\(/);
  }
});


});

describe("后随 rest 的默认形参仍可省", () => {
  const SRC = `export function f(a = 1, ...rest) { return [a, rest]; }
export class C { m(a = 1, ...rest) { return [a, rest]; } }
`;

  it("默认形参渲染成 `a?:`，不是 `a: … | undefined`；消费端 f() / c.m() 通过 tsc（改前 TS2555）", () => {
  {
    const dts = moduleDts(SRC);
    expect(dts).toContain("f(a?: unknown, ...rest: unknown[])");
    expect(dts).toContain("m(a?: unknown, ...rest: unknown[])");
    expect(dts).not.toContain("a: unknown | undefined");
  }
  {
    const check = tscNoEmit({
      "mod.d.ts": moduleDts(SRC),
      "use.ts":
        'import { f, C } from "./mod.js";\nexport const a = f();\nexport const b = f(1);\nexport const c = new C().m();\n',
    });
    expect(check.ok, check.stderr).toBe(true);
  }
});

});

describe("构造器 / static 方法默认值不丢", () => {
  const SRC = `export class C {
  constructor(a = 1) { this.a = a; }
  static make(x = 2) { return new C(); }
  inst(y = 3) { return y; }
}
`;

  it("构造器 / static 形参带 `?`（与实例位一致）；消费端 new C() / C.make() 通过 tsc（改前 TS2554）", () => {
  {
    const dts = moduleDts(SRC);
    expect(dts).toContain("constructor(a?: unknown);");
    expect(dts).toContain("static make(x?: unknown): unknown;");
    expect(dts).toContain("inst(y?: unknown)");
  }
  {
    const check = tscNoEmit({
      "mod.d.ts": moduleDts(SRC),
      "use.ts":
        'import { C } from "./mod.js";\nexport const c = new C();\nexport const d = C.make();\nexport const e = new C().inst();\n',
    });
    expect(check.ok, check.stderr).toBe(true);
  }
});

});

describe("导入的泛型基类保留类型实参", () => {
  const SRC = `import { Base } from "./base.js";
export class Derived extends Base<string> { y: number = 1; z(): number { return this.y; } }
`;

  it("`extends Base<string>` 不是 `extends Base`；产物自身过 tsc（改前 TS2314）", () => {
  {
    const dts = moduleDts(SRC);
    expect(dts).toContain("export declare class Derived extends Base<string> {");
    expect(dts).not.toMatch(/extends Base \{/);
  }
  {
    const check = tscNoEmit({
      "mod.d.ts": moduleDts(SRC),
      "base.d.ts": "export declare class Base<T> { t: T; get(): T; }\n",
    });
    expect(check.ok, check.stderr).toBe(true);
  }
});

});

describe("类类型形参默认值", () => {
  const SRC = `export class Box<T = string> {
  value: T = "x" as T;
  get(): T { return this.value; }
}
export function mk(): Box { return new Box(); }
`;

  it("`class Box<T = string>` 不是 `class Box<T>`；裸泛型引用 `mk(): Box` 不再让产物 TS2314", () => {
  {
    expect(moduleDts(SRC)).toContain("export declare class Box<T = string> {");
  }
  {
    const check = tscNoEmit({ "mod.d.ts": moduleDts(SRC) });
    expect(check.ok, check.stderr).toBe(true);
  }
});

});
});

// ---------------------------------------------------------------------------
// 一个绑定多个导出名，全部进 .d.ts
// ---------------------------------------------------------------------------
describe("一个绑定多个导出名，全部进 .d.ts", () => {
/**
 * 同一个本地绑定**同时**是具名导出与 `default` 导出时，旧实现
 * （`dtsExportNameOf` 只返回一个名字）只发射其中一个 ⇒ 另一个导出名在发布的
 * `.d.ts` 里根本不存在：
 * - default 名缺失 ⇒ 消费方 `import def from "./m.js"` 得到 `{}` ⇒
 * `error TS2349: This expression is not callable`；
 * - 具名缺失 ⇒ `TS2305: has no exported member`。
 *
 * 判据：`.d.ts` 只能引用**它自己声明或导入**的名字；一个本地绑定有几个导出名，
 * 产物就有几条导出 —— 主形态（具名优先）一次，其余逐条 `export { local as … };`。
 */






/** 模块面 dts 投影（CLI `export --format dts` 的产品面路径） */
function moduleDts(source: string, path = "/test/bug189.ts"): string {
  const result = analyzeFile(path, source);
  const surface = dtsModuleSurface(source);
  const names = localNamedExports(source);
  const ontoFace = (name: string): boolean =>
    names.has(name) ||
    name === "default" ||
    /^([A-Za-z_$][\w$]*)\./.test(name);
  const entries = result.functions
    .filter((fn) => fn.cases.length > 0 && ontoFace(fn.name))
    .map((fn) => ({ fn, projection: projectFunctionDts(fn, undefined, surface) }));
  return projectModuleDts(surface, entries).lines.join("\n");
}


  it("`export { foo as default, foo }` ⇒ 具名声明 + default 别名；`export default foo;`（具名函数 + 表达式式 default）⇒ default 可调用；类：具名 + default 双导出 ⇒ 两条导出都在（`new` 不报 TS2351）；负控制：只有 default 一个导出名时保持 `export default function`；负控制：别名导出仍按导出名声明（不额外发射内部名）", () => {
  {
    const dts = moduleDts(`function foo(x) {
  return x + 1;
}
export { foo as default, foo };
`);
    expect(dts).toContain("export declare function foo(");
    expect(dts).toContain("export { foo as default };");
    const check = tscNoEmit({
      "mod.d.ts": dts,
      "use.ts": 'import def, { foo } from "./mod.js";\nconst a = def(1);\nconst b = foo(2);\nexport { a, b };\n',
    });
    expect(check.ok, check.stderr).toBe(true);
  }
  {
    const dts = moduleDts(`function foo(x) {
  return x + 1;
}
export default foo;
`);
    expect(dts).toContain("export default function foo(");
    const check = tscNoEmit({
      "mod.d.ts": dts,
      "use.ts": 'import def from "./mod.js";\nconst a = def(1);\nexport { a };\n',
    });
    expect(check.ok, check.stderr).toBe(true);
  }
  {
    const dts = moduleDts(`class C {
  m() {
    return 1;
  }
}
export { C as default, C };
`);
    expect(dts).toContain("export declare class C {");
    expect(dts).toContain("export { C as default };");
    const check = tscNoEmit({
      "mod.d.ts": dts,
      "use.ts": 'import DefC, { C } from "./mod.js";\nconst a = new DefC().m();\nconst b = new C().m();\nexport { a, b };\n',
    });
    expect(check.ok, check.stderr).toBe(true);
  }
  {
    const dts = moduleDts(`export default function addOne(x) {
  return x + 1;
}
`);
    expect(dts).toContain("export default function addOne(");
    expect(dts).not.toContain("export { addOne as default };");
  }
  {
    const dts = moduleDts(`const internal = (x) => x + 1;
export { internal as publicName };
`);
    expect(dts).toContain("export { internal as publicName };");
    expect(dts).not.toContain("export declare function internal");
  }
});



  // ── 负控制：单导出的形态不该被改写 ──────────────────────────────


});

// ---------------------------------------------------------------------------
// dts 参数表来自声明形参表
// ---------------------------------------------------------------------------
describe("dts 参数表来自声明形参表", () => {
/**
 * dts 参数表按 **case 实参个数**截断 → **契约声明的形参被静默
 * 丢弃**；同一次导出里 check / zod / standard 三面都保留 → **四方交叉矛盾**。
 *
 * 症状（旧口径）：契约声明 2 个形参、只有 1 个 case 实参 ⇒
 * `export declare function addAll(a: number): number;`（`b` 被吞）
 * 而 check 签名面是 `addAll(a: number, b: number) => number`。
 *
 * 根因：dts 参数表的**长度**取自观测到的 case 实参个数（证据驱动），
 * 而不是契约/声明的形参表（义务驱动）⇒ 观测面污染了契约面。
 *
 * 修法：参数表长度取**声明形参表**（case 只贡献类型证据，不得裁剪契约
 * 义务）。
 */






const neverAbs = (): Abs =>
  ({ shape: { k: "never" }, conf: "exact" }) as unknown as Abs;

/** 最小 fn 骨架：单条 case（argAbs 全 any、结果 any） */
function fnOf(
  name: string,
  paramNames: string[],
  cases: FunctionAnalysis["cases"],
): FunctionAnalysis {
  return {
    name,
    loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
    paramNames,
    cases,
  } as FunctionAnalysis;
}


  it("契约声明 2 个形参、只有 1 个 case 实参 ⇒ 形参不被丢弃；声明形参比观测元数多 ⇒ 尾部形参保留（无契约时落观测 widen）；真分析面：声明 2 参 + 1 参 case ⇒ 两个形参都在产物里；负控制：契约里多出、形参表对不上的参数名仍不投影（不撒 arity 谎言）", () => {
  {
    const fn = fnOf("addAll", ["a", "b"], [
      { name: "c", argAbs: [num()], abs: neverAbs(), throwsAbs: neverAbs() },
    ]);
    const p = projectFunctionDts(fn, {
      params: [
        { name: "a", abs: num() },
        { name: "b", abs: num() },
      ],
    });
    expect(p.lines.join("\n")).toContain(
      "export declare function addAll(a: number, b: number)",
    );
    expect(p.params.map((x) => x.name)).toEqual(["a", "b"]);
  }
  {
    const fn = fnOf("addAll", ["a", "b"], [
      { name: "c", argAbs: [num()], abs: neverAbs(), throwsAbs: neverAbs() },
    ]);
    const p = projectFunctionDts(fn);
    // 类型词（number / any / unknown）随类型渲染面口径变化（无断言 case 指令
    // 只是见证、不是域声明 ⇒ 产物面取推断域，）——本钉只关心**两个形参
    // 都在产物里**（声明形参表的长度）。
    expect(p.lines.join("\n")).toMatch(
      /export declare function addAll\(a: \w+( \| \w+)?, b\?: (unknown|any)\)/,
    );
  }
  {
    const source = `
/**
 * @nudo:case "c" (1)
 */
export function addAll(a, b) { return a + b; }
`;
    const result = analyzeFile("/test/s2-arity.js", source);
    const fn = result.functions.find((f) => f.name === "addAll")!;
    expect(fn).toBeTruthy();
    const p = projectFunctionDts(fn);
    // 类型词（number / any / unknown）随类型渲染面口径变化（无断言 case 指令
    // 只是见证、不是域声明 ⇒ 产物面取推断域，）——本钉只关心**两个形参
    // 都在产物里**（声明形参表的长度）。
    expect(p.lines.join("\n")).toMatch(
      /export declare function addAll\(a: \w+( \| \w+)?, b\?: (unknown|any)\)/,
    );
  }
  {
    const fn = fnOf("one", ["a"], [
      { name: "c", argAbs: [num()], abs: neverAbs(), throwsAbs: neverAbs() },
    ]);
    const p = projectFunctionDts(fn, {
      params: [
        { name: "a", abs: num() },
        { name: "ghost", abs: num() },
      ],
    });
    expect(p.lines.join("\n")).toContain("one(a: number)");
    expect(p.lines.join("\n")).not.toContain("ghost");
  }
});




});

// ---------------------------------------------------------------------------
// dts 剩余参数
// ---------------------------------------------------------------------------
describe("dts 剩余参数", () => {
/**
 * dts 生成器对**剩余参数（rest parameter）**函数产出**非法
 * TypeScript**（tsc 报 TS2370 / TS1014）。
 *
 * 症状（旧口径）：
 * - `export declare function sum(...xs: number): number;` ⇒ TS2370
 * （剩余参数必须是数组类型）；
 * - `export declare function sum3(...xs: number, arg1: number, arg2: number)`
 * ⇒ TS1014（剩余参数必须最后）+ TS2370。
 *
 * 根因（两处叠加）：
 * - 参数表长度取自**观测到的 case 实参个数**（rest 天然吞掉 N 个实参 ⇒
 * 元数 N > 声明形参数 1 ⇒ 多余槽位被当成普通形参追加在 rest 之后）；
 * - case-widen 路径（paramTypeFromAbs）**漏了**契约路径才有的
 * `isRest → T[]` 提升 ⇒ rest 槽类型是单个实参类型而非数组类型。
 *
 * 修法：参数表长度取**声明形参表**（rest 吞掉全部尾部实参 ⇒ 长度 = 声明
 * 长度，rest 必居末位）；case-widen 路径复用 rest → T[] 提升。
 */








/** rest 形参提升为数组（元素类型词随类型渲染面口径变化） */
const REST_ARRAY_RE = (name: string) =>
  new RegExp(`export declare function ${name}\\(\\.\\.\\.xs: \\w+\\[\\]\\): \\w+;`);
/** 非 rest 形参仍是普通参数 + 尾部可选（类型词随类型渲染面口径变化） */
const NONREST_OPTIONAL_RE =
  /export declare function add\(a: \w+( \| \w+)?, b\?: (unknown|any)\): \w+( \| \w+)?;/;


  it("rest 形参类型提升为数组（TS2370）；rest 吞掉全部尾部实参：参数表不再追加 argN（TS1014）；产物真能过 tsc --noEmit --strict（改前：TS2370 / TS1014）；负控制：非 rest 形参仍是普通参数（不误提升为数组）", () => {
  {
    const source = `
/**
 * @nudo:case "c" (1)
 */
export function sum(...xs) { return xs.length; }
`;
    const dts = generateDts(analyzeFile("/test/s2-rest.js", source));
    // rest 形参提升为**数组**（TS2370 的修法）。元素类型词（number / any）是
    // 类型渲染面的口径：无断言的 case 指令只是见证、不是域声明 ⇒ 产物面取
    // 推断域（）⇒ 元素落到 any。
    expect(dts).toMatch(REST_ARRAY_RE("sum"));
    expect(dts).not.toContain("...xs: number;");
  }
  {
    const source = `
/**
 * @nudo:case "c" (1, 2, 3)
 */
export function sum3(...xs) { return xs.length; }
`;
    const dts = generateDts(analyzeFile("/test/s2-rest3.js", source));
    // 同上（元素类型词见上）
    expect(dts).toMatch(REST_ARRAY_RE("sum3"));
    expect(dts).not.toContain("arg1");
    expect(dts).not.toContain("arg2");
  }
  {
    const source = `
/**
 * @nudo:case "c" (1, 2, 3)
 */
export function sum3(...xs) { return xs.length; }
`;
    const dts = generateDts(analyzeFile("/test/s2-rest-tsc.js", source));
    const check = tscNoEmit({ "mod.d.ts": dts });
    expect(check.ok, check.stderr).toBe(true);
  }
  {
    const source = `
/**
 * @nudo:case "c" (1)
 */
export function add(a, b) { return a + b; }
`;
    const dts = generateDts(analyzeFile("/test/s2-nonrest.js", source));
    // 类型词（unknown / any / number）是类型渲染面的口径（不在本分片职责内）——
    // 本钉只关心**可选性**标记与「没被误提升成数组」。
    expect(dts).toMatch(NONREST_OPTIONAL_RE);
    expect(dts).not.toContain("number[]");
  }
});




});

// ---------------------------------------------------------------------------
// 注解原文的类型名必须在产物里可解析
// ---------------------------------------------------------------------------
describe("注解原文的类型名必须在产物里可解析", () => {
/**
 * dts 面把 TS 注解原文抄进产物，却**不校验该名字在产物里可解析**
 * ⇒ 发布的 `.d.ts` 里出现从未声明的类型名（TS2304），且 `nudo export`
 * exit 0、零台账；同一形参 check 面说 `any`、dts 面说 `T`（两面相反）。
 *
 * 判据（本钉）：注解原文里的**类型名**必须在产物里可解析 ——
 * 本地 `declare class`（含未导出但被注解引用的类）/ 已 import 的名字 /
 * TS 全局类型名（`Date` / `Record` / `Promise` …）才放行；
 * 类型形参（`<T>`）/ 本地 interface / type 别名 / 未导入的名字 ⇒ **不放行**，
 * 回落 `paramTypeFromAbs` 的观测口径（与 check 面一致）并留
 * `nudo:dropped-type-annotation` 台账。
 */







/** CLI export 面筛选（与 packages/nudojs/src/commands/export.ts 同口径） */
function exportFaceFunctions(source: string, result: AnalysisResult): FunctionAnalysis[] {
  const entryNames = localNamedExports(source);
  const onExportFace = (name: string): boolean => {
    if (entryNames.has(name)) return true;
    if (name === "default") return true;
    const m = /^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/.exec(name);
    return m !== null && entryNames.has(m[1]!);
  };
  return result.functions.filter((f) => f.cases.length > 0 && onExportFace(f.name));
}

/** 模块面 dts 投影（CLI `export --format dts` 的产品面路径） */
function moduleDts(source: string, path = "/test/bug168-annotation.ts"): string {
  const result = analyzeFile(path, source);
  const surface = dtsModuleSurface(source);
  const entries = exportFaceFunctions(source, result).map((fn) => ({
    fn,
    projection: projectFunctionDts(fn, undefined, surface),
  }));
  return projectModuleDts(surface, entries).lines.join("\n");
}


  it("泛型函数的类型形参不放行：`id<T>(x: T)` ⇒ `id(x: unknown)` + 台账；多类型形参：`pair<A, B>` ⇒ 两个形参都回落观测口径（TS 投影面为 unknown）；本地 interface 放行（原文镜像进产物）⇒ 注解保留、零台账；TS 全局类型名照旧放行（Date / Record / Promise 不产生台账）；本地类（未导出）被注解引用 ⇒ 补 `declare class`（产物必须能解析该名）；别的模块的 import ⇒ ", () => {
  {
    const dts = moduleDts(`export function id<T>(x: T): T {
  return x;
}
`);
    expect(dts).toContain("export declare function id(x: unknown): unknown;");
    expect(dts).not.toContain("id(x: T)");
    expect(dts).toContain("nudo:dropped-type-annotation id.x: T");
  }
  {
    const dts = moduleDts(`export function pair<A, B>(a: A, b: B): [A, B] {
  return [a, b];
}
`);
    expect(dts).toContain("export declare function pair(a: unknown, b: unknown): [unknown, unknown];");
    expect(dts).not.toContain("pair(a: A");
    expect(dts).not.toContain("b: B)");
  }
  {
    const dts = moduleDts(`interface Point { x: number; y: number }
export function dist(p: Point): number {
  return p.x + p.y;
}
`);
    expect(dts).toContain("dist(p: Point)");
    expect(dts).toContain("interface Point { x: number; y: number }");
    expect(dts).not.toContain("nudo:dropped-type-annotation dist.p: Point");
  }
  {
    const dts = moduleDts(`export function when(d: Date, o: Record<string, number>): Promise<number> {
  return Promise.resolve(d.getTime() + o.n);
}
`);
    expect(dts).toContain("d: Date");
    expect(dts).toContain("o: Record<string, number>");
    expect(dts).not.toContain("nudo:dropped-type-annotation");
  }
  {
    const dts = moduleDts(`class Helper {
  constructor() {
    this.n = 1;
  }
}
export function useHelper(h: Helper): number {
  return h.n;
}
`);
    expect(dts).toContain("declare class Helper {");
    expect(dts).toContain("export declare function useHelper(h: Helper)");
    expect(dts).not.toContain("nudo:dropped-type-annotation");
  }
  {
    const dts = moduleDts(`import type { User } from "./types";
export function name(u: User): string {
  return String(u);
}
`);
    expect(dts).toContain('import type { User } from "./types";');
    expect(dts).toContain("export declare function name(u: User)");
    const check = tscNoEmit({
      "mod.d.ts": dts,
      "types.d.ts": "export type User = { id: number };\n",
      "use.ts": 'import { name } from "./mod.js";\nexport const s: string = name({ id: 1 });\n',
    });
    expect(check.ok, check.stderr).toBe(true);
  }
  {
    const dts = moduleDts(`export class Box<T> {
  constructor(v) {
    this.v = v;
  }
}
`);
    expect(dts).toContain("export declare class Box<T> {");
    const check = tscNoEmit({
      "mod.d.ts": dts,
      "use.ts": 'import { Box } from "./mod.js";\nexport const b: Box<string> = new Box<string>("x");\n',
    });
    expect(check.ok, check.stderr).toBe(true);
  }
  {
    const dts = moduleDts(`export function id<T>(x: T): T {
  return x;
}
export function pair<A, B>(a: A, b: B): [A, B] {
  return [a, b];
}
`);
    const check = tscNoEmit({ "mod.d.ts": dts });
    expect(check.ok, check.stderr).toBe(true);
  }
});


  // 之后口径变更：模块级 `interface` / `type` 会被**原文镜像**进同一份
  // 产物（见 dtsModuleSurface 的 typeDeclarations）⇒ 引用它是可解析的，不再回落。
  // 真正的「不可解析」只剩类型形参与未声明 / 未导入的名字（上面两条已覆盖）。






});

// ---------------------------------------------------------------------------
// 值导出落地到 .d.ts
// ---------------------------------------------------------------------------
describe("值导出落地到 .d.ts", () => {
/**
 * 模块级**值绑定**（`export const` / `export let` / TS `enum`）在导出
 * 面表里登记了、却从不落地到 `.d.ts` ⇒ 发布的产物里根本没有这些导出 ⇒
 * 消费端 `error TS2305: Module … has no exported member 'VERSION'`，而运行时
 * 确实有该导出（`.d.ts` 与运行时面相反）。
 *
 * 判据：导出面里登记的每个绑定都要有声明；值的**类型**取分析面绑定（同一条
 * 推断来源），无绑定则投影为 `unknown` 并留 `nudo:unresolved-value` 台账。
 */






/** CLI export 面的模块值表（与分析面绑定同名：本地名 → Abs） */
function valuesOf(source: string, path = "/test/bug190.ts"): Map<string, Abs> {
  const result = analyzeFile(path, source);
  const out = new Map<string, Abs>();
  for (const [name, info] of result.bindings) out.set(name, info.abs);
  return out;
}

function moduleDts(source: string, path = "/test/bug190.ts", includeValues = true): string {
  const result = analyzeFile(path, source);
  const surface = dtsModuleSurface(source);
  const entries = result.functions
    .filter((fn) => fn.cases.length > 0)
    .map((fn) => ({ fn, projection: projectFunctionDts(fn, undefined, surface) }));
  return projectModuleDts(surface, entries, includeValues ? { values: valuesOf(source, path) } : {})
    .lines.join("\n");
}


  it("`export const` / `export let` 有声明，类型来自分析面绑定；TS `enum` 按 enum 声明（成员 + 字面量初始化器都在）；数值 enum：无初始化器成员照常落地（消费方零参 import 可用）；无分析绑定 ⇒ 声明仍是 `unknown` + 台账（不静默消失）；负控制：非导出的模块级 const 不进 .d.ts", () => {
  {
    const dts = moduleDts(`export const VERSION = "1.2.3";
export const LIMIT = 10;
export let counter = 0;
`);
    expect(dts).toContain("export declare const VERSION: string;");
    expect(dts).toContain("export declare const LIMIT: number;");
    expect(dts).toContain("export declare let counter: number;");
    const check = tscNoEmit({
      "mod.d.ts": dts,
      "use.ts":
        'import { VERSION, LIMIT, counter } from "./mod.js";\n' +
        "const v: string = VERSION;\nconst l: number = LIMIT;\nconst c: number = counter;\nexport { v, l, c };\n",
    });
    expect(check.ok, check.stderr).toBe(true);
  }
  {
    const dts = moduleDts(`export enum Mode {
  A = "a",
  B = "b",
}
`);
    expect(dts).toContain("export declare enum Mode {");
    expect(dts).toContain('A = "a",');
    expect(dts).toContain('B = "b",');
    const check = tscNoEmit({
      "mod.d.ts": dts,
      "use.ts": 'import { Mode } from "./mod.js";\nconst m: Mode = Mode.A;\nexport { m };\n',
    });
    expect(check.ok, check.stderr).toBe(true);
  }
  {
    const dts = moduleDts(`export enum Level {
  Low,
  High,
}
`);
    expect(dts).toContain("export declare enum Level {");
    expect(dts).toContain("Low,");
    expect(dts).toContain("High,");
    const check = tscNoEmit({
      "mod.d.ts": dts,
      "use.ts": 'import { Level } from "./mod.js";\nconst l: Level = Level.High;\nexport { l };\n',
    });
    expect(check.ok, check.stderr).toBe(true);
  }
  {
    const dts = moduleDts(`export const later = computeSomething();
`, "/test/bug190-unresolved.ts", false);
    expect(dts).toContain("export declare const later: unknown;");
    expect(dts).toContain("nudo:unresolved-value later");
  }
  {
    const dts = moduleDts(`const secret = 42;
export function reveal() {
  return secret;
}
`);
    expect(dts).not.toContain("secret");
    expect(dts).toContain("export declare function reveal(");
  }
});




  // ── 负控制：非导出的模块值不进产物 ─────────────────────────────

});

// ---------------------------------------------------------------------------
// 模块级可变容器不投成字面量类型
// ---------------------------------------------------------------------------
describe("模块级可变容器不投成字面量类型", () => {
/**
 * 缺陷报告分册 05-dts-fidelity —— 模块级值绑定 / namespace 成员 / readonly。
 *
 * 覆盖：（对象 / 数组常量不投成冻结字面量类型）、（namespace
 * 成员注解引用的模块私有类型）、（namespace 内 export class 非空体）、
 * （readonly 类字段 / `as const`）。
 *
 * 用 CLI 同一条模块面投影链 + 真 tsc --noEmit --strict 校验产物 / 消费端。
 */







function exportFaceFunctions(source: string, result: AnalysisResult): FunctionAnalysis[] {
  const entryNames = localNamedExports(source);
  const onExportFace = (name: string): boolean => {
    if (entryNames.has(name) || name === "default") return true;
    const m = /^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/.exec(name);
    return m !== null && entryNames.has(m[1]!);
  };
  return result.functions.filter((f) => f.cases.length > 0 && onExportFace(f.name));
}

function moduleDts(source: string, path = "/test/bug-report-values.ts"): string {
  const result = analyzeFile(path, source);
  const surface = dtsModuleSurface(source);
  const entries = exportFaceFunctions(source, result).map((fn) => ({
    fn,
    projection: projectFunctionDts(fn, undefined, surface),
  }));
  const values = new Map<string, Abs>();
  for (const [name, info] of result.bindings) values.set(name, info.abs);
  return projectModuleDts(surface, entries, { values }).lines.join("\n");
}

{
  const SRC = `export let config = { retries: 3, label: "x" };
export const empty = [];
export const nums = [1, 2, 3];
export const scalar = 42;
export const nested = { a: { b: 1 } };
`;

  it("对象槽 / 数组元素 / 元组按基类型投影，标量绑定照旧拓宽；消费端对合法写入不再报 TS2322 / TS2345", () => {
  {
    const dts = moduleDts(SRC);
    expect(dts).toContain("config: { retries: number; label: string }");
    expect(dts).toContain("empty: unknown[];");
    expect(dts).toContain("nums: number[];");
    expect(dts).toContain("scalar: number;");
    expect(dts).toContain("nested: { a: { b: number } };");
    expect(dts).not.toContain("retries: 3");
  }
  {
    const check = tscNoEmit({
      "mod.d.ts": moduleDts(SRC),
      "use.ts":
        'import { config, empty, nums, scalar } from "./mod.js";\nconfig.retries = 5;\nempty.push(1);\nnums[0] = 9;\nscalar.toFixed(1);\n',
    });
    expect(check.ok, check.stderr).toBe(true);
  }
});

}

describe("namespace 成员注解引用的私有类型可解析", () => {
  const SRC = `interface Hidden { a: number }
type LocalAlias = string;

export function topLevel(x: Hidden): number { return x.a; }
export const anchor = 1;
export namespace NS {
  export function f(x: Hidden): number { return x.a; }
  export function g(y: LocalAlias): LocalAlias { return y; }
}
`;

  it("私有 interface / type 别名补进产物（tsc --declaration 同口径）；产物自身过 tsc（改前 TS2304 ×3）", () => {
  {
    const dts = moduleDts(SRC);
    expect(dts).toContain("interface Hidden { a: number }");
    expect(dts).toContain("type LocalAlias = string;");
    expect(dts).toContain("export function f(x: Hidden): number;");
  }
  {
    const check = tscNoEmit({ "mod.d.ts": moduleDts(SRC) });
    expect(check.ok, check.stderr).toBe(true);
  }
});

});

describe("namespace 内 export class 不再是空类体", () => {
  const SRC = `export const anchor = 1;
export namespace NS {
  export class C {
    v: number = 1;
    m(): number { return this.v; }
  }
}
`;

  it("类体带字段与方法（ambient 声明体合法）；消费端 new NS.C().v / .m() 通过 tsc（改前 TS2339 ×2）", () => {
  {
    const dts = moduleDts(SRC);
    expect(dts).toContain("export class C {");
    expect(dts).toMatch(/v: number;/);
    expect(dts).toMatch(/m\(\): number;/);
    expect(dts).not.toMatch(/export class C \{\}/);
  }
  {
    const check = tscNoEmit({
      "mod.d.ts": moduleDts(SRC),
      "use.ts":
        'import { NS } from "./mod.js";\nconst c = new NS.C();\nexport const v: number = c.v;\nexport const m: number = c.m();\n',
    });
    expect(check.ok, check.stderr).toBe(true);
  }
});

});

describe("readonly 语义", () => {
  const SRC = `export class Counter { readonly count: number = 0; m(): number { return this.count; } }
export const CFG = { host: "h" } as const;
`;

  it("readonly 字段 / as const 对象槽都带修饰符，字面量精度保留；消费端对只读值的写入被 tsc 拦下（改前假绿）", () => {
  {
    const dts = moduleDts(SRC);
    expect(dts).toContain("readonly count: number;");
    expect(dts).toContain('readonly host: "h"');
  }
  {
    const check = tscNoEmit({
      "mod.d.ts": moduleDts(SRC),
      "use.ts":
        'import { Counter, CFG } from "./mod.js";\nconst c = new Counter();\nc.count = 99;\nCFG.host = "h";\n',
    });
    expect(check.ok).toBe(false);
    expect(check.stderr).toContain("TS2540");
  }
});

});
});

// ---------------------------------------------------------------------------
// ABS-03 契约面类型形参（可达性 + 统一性）
// ---------------------------------------------------------------------------
describe("[abs03] ABS-03 契约面类型形参（可达性 + 统一性）", () => {
/**
 * ABS-03：dts / schema 投影补全。
 *
 * 覆盖：
 * - 契约面类型形参的**可达性**（不发射未被签名引用的变元）与**统一性**
 * （元素域 / 回调入参共享同一变元）——entry-only HOF 夹具；
 * - 契约可读注记（JSDoc `Contract:` 行）只做注记、不改类型面；
 * - 重载集 → TS 调用签名对象（声明序 = TS 解析序）；
 * - schema 数值界（gt/ge/lt/le）生成检查（可表达时），不可表达时诚实省略。
 */






function fnOf(source: string, name: string) {
  const result = analyzeFile("/test/abs03.js", source);
  const fn = result.functions.find((f) => f.name === name);
  if (!fn) throw new Error(`function ${name} not found`);
  return fn;
}

function binderVar(id: string): Abs {
  return abs({ k: "any" }, v(id), undefined, "path");
}

/** processItems 的契约面（与 ABS-01 目标数据形态同构） */
function processItemsContract(): DtsContractFace {
  const elemA = binderVar("bind:a");
  const items = abs({ k: "arr", element: elemA }, v("items"), undefined, "path");
  const transform = abs(
    {
      k: "fn",
      params: ["x"],
      paramTypes: [binderVar("bind:a")],
      returnType: binderVar("bind:b"),
    },
    v("transform"),
    undefined,
    "path",
  );
  const returns = abs({ k: "arr", element: binderVar("bind:b") }, v("return"), undefined, "path");
  return {
    params: [
      { name: "items", abs: items, display: 'array(bind("a", any()))' },
      { name: "transform", abs: transform, display: 'fn({ x: ref("a") }, bind("b", any()))' },
    ],
    return: returns,
    returnDisplay: 'array(ref("b"))',
  };
}

describe("ABS-03 契约面类型形参（可达性 + 统一性）", () => {
  const fn = fnOf(
    `export function processItems(items, transform) { return items.map(transform); }`,
    "processItems",
  );

  it("元素域 / 回调入参共享同一变元；返回位复用回调返回变元（<a, b>）；未被签名引用的变元不发射（ghost 位不产生悬空类型参数）；契约可读注记：Contract: 行存在，且不参与类型面", () => {
  {
    const proj = projectFunctionDts(fn, processItemsContract());
    const decl = proj.lines.join("\n");
    expect(decl).toContain("<a, b>");
    expect(decl).toContain("items: a[]");
    expect(decl).toContain("(x: a) => b");
    expect(decl).toContain(": b[]");
  }
  {
    const contract = processItemsContract();
    contract.params.push({
      name: "ghost",
      abs: binderVar("bind:ghost"),
    });
    const proj = projectFunctionDts(fn, contract);
    const decl = proj.lines.join("\n");
    expect(decl).not.toContain("ghost");
  }
  {
    const proj = projectFunctionDts(fn, processItemsContract());
    const decl = proj.lines.join("\n");
    expect(decl).toContain('Contract: items: array(bind("a", any()))');
    expect(decl).toContain('Contract: return: array(ref("b"))');
    // 注记不改变声明行的类型面
    expect(decl).toContain("(items: a[], transform: (x: a) => b): b[]");
  }
});


});

describe("ABS-03 重载集 → TS 调用签名对象", () => {
  it("逐 arm 发射（声明序）且保留形参↔返回相关性", () => {
    const prim = (type: "string" | "number"): Abs =>
      abs({ k: "prim", type }, undefined, undefined, "exact");
    const overloaded: Abs = abs(
      {
        k: "fn",
        params: ["a0"],
        paramTypes: [abs({ k: "unknown" }, undefined, undefined, "partial")],
        returnType: abs({ k: "unknown" }, undefined, undefined, "partial"),
        overloads: [
          { paramTypes: [prim("string")], returnType: prim("number") },
          { paramTypes: [prim("number")], returnType: prim("string") },
        ],
      },
      undefined,
      undefined,
      "exact",
    );
    const ts = absToTSType(overloaded);
    expect(ts).toBe("{ (a0: string): number; (a0: number): string }");
  });
});

describe("ABS-03 schema 数值界投影", () => {
  it("可表达的 gt/ge 下界与 le/lt 上界生成检查；不可表达的关系（x > y）诚实省略界（不回退成假精确）", () => {
  {
    const entry = abs(
      { k: "prim", type: "number" },
      v("x"),
      {
        op: "and",
        args: [
          { op: "ge", a: v("x"), b: lit(0) },
          { op: "lt", a: v("x"), b: lit(10) },
        ],
      },
      "path",
    );
    const src = absToSchemaSource(entry);
    expect(src).toContain(".gte(0)");
    expect(src).toContain(".lt(10)");
  }
  {
    const entry = abs(
      { k: "prim", type: "number" },
      v("x"),
      { op: "gt", a: v("x"), b: v("y") },
      "path",
    );
    const src = absToSchemaSource(entry);
    expect(src).not.toContain(".gt(");
    expect(src).toContain("number");
  }
});

});
});
