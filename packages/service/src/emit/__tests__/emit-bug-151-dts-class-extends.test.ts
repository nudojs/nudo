/**
 * BUG-151 —— 类的 `extends` 在 `.d.ts` 里被整条丢弃（类面扫描只采方法与构造器）
 * ⇒ 产物里 `class B extends A` 变成 `class B`：
 *   - `const b: A = new B()` 报 TS2741（缺 A 的成员）；
 *   - `b.am()`（继承方法）报 TS2339；
 *   - 实例字段（构造器 `this.x = …` / 类属性初始化器）**一个都不声明**
 *     ⇒ `b.y` 也是 TS2339。
 *
 * 判据：超类名**可解析**（本地类 / 导入类 / TS 全局构造器）才进 `extends`
 * （否则会造出 TS2304）；实例字段从源码面采集，继承来的字段不重复声明。
 */
import { describe, it, expect } from "vitest";
import { analyzeFile } from "@nudojs/service";
import { dtsModuleSurface, projectFunctionDts, projectModuleDts } from "../dts-generator.ts";
import { tscNoEmit } from "./dts-tsc.ts";

function moduleDts(source: string, path = "/test/bug151.ts"): string {
  const result = analyzeFile(path, source);
  const surface = dtsModuleSurface(source);
  const entries = result.functions
    .filter((fn) => fn.cases.length > 0)
    .map((fn) => ({ fn, projection: projectFunctionDts(fn, undefined, surface) }));
  return projectModuleDts(surface, entries).lines.join("\n");
}

describe("BUG-151 —— dts 类面保留 extends 与实例字段", () => {
  it("`class B extends A` 在产物里带超类；本类字段声明、继承字段不重复", () => {
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
  });

  it("消费方：子类可赋给父类类型；继承方法与字段可访问", () => {
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
  });

  it("类属性初始化器（`count = 3` / `label = \"p\"`）也进实例字段面", () => {
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
  });

  // ── 负控制：不可解析的超类名不进产物（否则 TS2304）──────────────
  it("负控制：`extends` 一个未声明的名字 ⇒ 不发射 extends（消费方零 TS2304）", () => {
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
  });

  it("负控制：TS 全局构造器名（`extends Error`）照旧放行", () => {
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
  });
});
