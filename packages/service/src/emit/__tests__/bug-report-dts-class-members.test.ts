/**
 * 缺陷报告分册 05-dts-fidelity —— 类成员面 / 修饰符 / 名义标记 / 索引签名。
 *
 * 覆盖：Bug 13（static-only 幻影实例方法）、Bug 23（static 字段 + 访问器）、
 * Bug 42（abstract 类与成员）、Bug 44（注解-only 实例字段）、Bug 48
 * （TSParameterProperty）、Bug 86（private / protected）、Bug 87（#private
 * 名义标记）、Bug 88（index signature）。
 *
 * 用 CLI 同一条模块面投影链 + 真 tsc --noEmit --strict 校验产物 / 消费端。
 */
import { describe, it, expect } from "vitest";
import { localNamedExports, type Abs } from "@nudojs/core";
import { analyzeFile } from "@nudojs/service";
import type { AnalysisResult, FunctionAnalysis } from "../../analyzer-types.ts";
import {
  dtsModuleSurface,
  projectFunctionDts,
  projectModuleDts,
} from "../dts-generator.ts";
import { tscNoEmit } from "./dts-tsc.ts";

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

describe("Bug 13 —— static-only 方法不再多发幻影实例声明", () => {
  const SRC = `export class C {
  static only(v) { return v; }
}
`;

  it("只声明 static only（没有同名实例方法）", () => {
    const dts = moduleDts(SRC);
    expect(dts).toContain("static only(");
    expect(dts).not.toMatch(/^  only\(/m);
  });

  it("同名 static + instance 同时存在时两者都保留（既有口径不回退）", () => {
    const dts = moduleDts(`export class C {
  m() { return 1; }
  static m(y) { return 2; }
}
`);
    expect(dts).toMatch(/^  m\(/m);
    expect(dts).toContain("static m(");
    expect((dts.match(/^  m\(.*\): unknown;/gm) ?? []).length).toBe(1);
  });
});

describe("Bug 23 —— static 字段与 getter/setter 进产物", () => {
  const SRC = `export class A {
  static count = 0;
  value = 2;
  get double() { return this.value * 2; }
  set double(v) { this.value = v / 2; }
  static { A.count = 5; }
  m() { return 1; }
}
`;

  it("static 字段 / 访问器 / 实例字段都在", () => {
    const dts = moduleDts(SRC);
    expect(dts).toContain("static count: number;");
    expect(dts).toMatch(/get double\(\):/);
    expect(dts).toMatch(/set double\(v:/);
    expect(dts).toContain("value: number;");
  });

  it("消费端读这些成员通过 tsc（改前 TS2339 ×2）", () => {
    const check = tscNoEmit({
      "mod.d.ts": moduleDts(SRC),
      "use.ts":
        'import { A } from "./mod.js";\nexport const a = A.count;\nexport const b = new A().double;\nexport const c = new A().value;\n',
    });
    expect(check.ok, check.stderr).toBe(true);
  });
});

describe("Bug 42 —— abstract 修饰符与 abstract 成员", () => {
  const SRC = `export abstract class Shape {
  abstract area(): number;
  abstract label(): string;
  describe() { return this.label(); }
}
`;

  it("类头带 abstract、抽象成员带源码返回注解", () => {
    const dts = moduleDts(SRC);
    expect(dts).toContain("export declare abstract class Shape {");
    expect(dts).toContain("abstract area(): number;");
    expect(dts).toContain("abstract label(): string;");
  });

  it("消费端可用继承来的抽象成员（改前 TS2339）", () => {
    const check = tscNoEmit({
      "mod.d.ts": moduleDts(SRC),
      "use.ts":
        'import { Shape } from "./mod.js";\ndeclare const s: Shape;\nexport const a: number = s.area();\nexport const l: string = s.label();\n',
    });
    expect(check.ok, check.stderr).toBe(true);
  });

  it("消费端 new Shape() 被拦下（改前可实例化抽象类）", () => {
    const check = tscNoEmit({
      "mod.d.ts": moduleDts(SRC),
      "use.ts": 'import { Shape } from "./mod.js";\nexport const inst = new Shape();\n',
    });
    expect(check.ok).toBe(false);
    expect(check.stderr).toContain("TS2511");
  });
});

describe("Bug 44 —— 只有类型注解的实例字段不塌成 unknown", () => {
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

  it("注解字段用源码声明类型（同类初始化器字段不受影响）", () => {
    const dts = moduleDts(SRC);
    expect(dts).toContain("id: number;");
    expect(dts).toContain("name: string;");
    expect(dts).toContain("active: boolean;");
    expect(dts).toContain("count: number;");
  });

  it("消费端字段读取通过 tsc（改前 TS2322 ×3）", () => {
    const check = tscNoEmit({
      "mod.d.ts": moduleDts(SRC),
      "use.ts":
        'import { Account } from "./mod.js";\ndeclare const a: Account;\nexport const id: number = a.id;\nexport const name: string = a.name;\nexport const act: boolean = a.active;\n',
    });
    expect(check.ok, check.stderr).toBe(true);
  });
});

describe("Bug 48 —— TS 构造器参数属性登记成实例字段", () => {
  const SRC = `export class Account {
  constructor(public id: number, protected name: string, readonly active: boolean = true) {}
  getId(): number { return this.id; }
}
`;

  it("字段带源码类型 / 访问修饰符 / readonly，构造器形参类型也保真", () => {
    const dts = moduleDts(SRC);
    expect(dts).toContain("constructor(id: number, name: string, active?: boolean);");
    expect(dts).toContain("id: number;");
    expect(dts).toContain("protected name: string;");
    expect(dts).toContain("readonly active: boolean;");
  });

  it("消费端 `new Account(...).id` 通过 tsc（改前 TS2339）", () => {
    const check = tscNoEmit({
      "mod.d.ts": moduleDts(SRC),
      "use.ts":
        'import { Account } from "./mod.js";\nconst a = new Account(1, "n", true);\nexport const id: number = a.id;\nexport const active: boolean = a.active;\n',
    });
    expect(check.ok, check.stderr).toBe(true);
  });
});

describe("Bug 86 —— private / protected 成员不再翻成 public", () => {
  const SRC = `export class C {
  private secret = 1;
  protected guarded = 2;
  private hidden() { return 3; }
  protected shield() { return 4; }
  public m() { return this.secret + this.hidden(); }
}
`;

  it("字段与方法都带访问修饰符", () => {
    const dts = moduleDts(SRC);
    expect(dts).toContain("private secret: number;");
    expect(dts).toContain("protected guarded: number;");
    expect(dts).toContain("private hidden(): unknown;");
    expect(dts).toContain("protected shield(): unknown;");
  });

  it("消费端读私有面被 tsc 拦下（改前假绿）", () => {
    const check = tscNoEmit({
      "mod.d.ts": moduleDts(SRC),
      "use.ts":
        'import { C } from "./mod.js";\nconst c = new C();\nexport const a = c.secret;\nexport const b = c.hidden();\n',
    });
    expect(check.ok).toBe(false);
    expect(check.stderr).toContain("TS2341");
  });
});

describe("Bug 87 —— `#private;` 名义标记", () => {
  const SRC = `export class A { #x = 1; m() { return this.#x; } }
export class B { #y = 2; m() { return this.#y; } }
`;

  it("两个含 # 私有字段的类都带 #private;", () => {
    const dts = moduleDts(SRC);
    expect((dts.match(/#private;/g) ?? []).length).toBe(2);
    expect(dts).not.toContain("#x");
  });

  it("A / B 不可结构互赋（改前 exit 0，源码侧 TS2741）", () => {
    const check = tscNoEmit({
      "mod.d.ts": moduleDts(SRC),
      "use.ts":
        'import { A, B } from "./mod.js";\nconst a: A = new B();\nexport const n = a.m();\n',
    });
    expect(check.ok).toBe(false);
  });
});

describe("Bug 88 —— 类 index signature 进产物", () => {
  const SRC = `export class Dict3 {
  [key: string]: number | Function;
  a = 1;
  get(k: string) { return this[k]; }
}
`;

  it("发射 `[key: string]: …;`", () => {
    expect(moduleDts(SRC)).toContain("[key: string]: number | Function;");
  });

  it("消费端索引访问通过 tsc（改前 TS7052 / TS2339）", () => {
    const check = tscNoEmit({
      "mod.d.ts": moduleDts(SRC),
      "use.ts":
        'import { Dict3 } from "./mod.js";\nconst d = new Dict3();\nexport const x: number | Function = d["zzz"];\nexport const y: number | Function = d.whatever;\n',
    });
    expect(check.ok, check.stderr).toBe(true);
  });
});
