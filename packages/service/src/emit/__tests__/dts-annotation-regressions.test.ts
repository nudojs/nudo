/**
 * dts 导出胶水 / 模块面合并 / 值位置注解的回归钉（根因根除台账的仓内落点）。
 *
 * 只收**差分矩阵（`scripts/face-matrix.ts`）表达不了**的断言：
 * - 默认导出胶水 + 重载解析（矩阵的消费方只做合成默认导入，区分不出胶水丢失）；
 * - namespace 声明合并的**逐成员**消费方用法（矩阵只比声明文本）；
 * - 值位置函数表达式（`export const f = (n) => (x: number): number => …`；
 *   tsc 发 `const`，nudo 发函数声明，声明文本无法直接对 oracle）；
 * - 对象字面量计算键成员注解的三种写法 + 错实参假绿方向。
 *
 * 产物取法与 `nudo export --format dts` 同口径（case 档 `none`、有见证的函数、
 * 值通道取分析面 bindings），只差首行模块标识注释。每条都带「改前产物形态确实红」
 * 的负控制，证明断言对台账描述的缺陷有区分力。
 * 缺陷编号只出现在 it 标题的 provenance（文件名 / describe 标题不含编号）。
 */
import { describe, it, expect } from "vitest";
import { type Abs } from "@nudojs/core";
import { analyzeFileAsync } from "@nudojs/service";
import { dtsModuleSurface, projectFunctionDts, projectModuleDts } from "../dts-generator.ts";
import { tscNoEmit } from "./dts-tsc.ts";

const PATH = "/test/dts-annotation-regressions.ts";

/** 模块面 dts（`nudo export --format dts` 同口径；夹具只含导出函数 ⇒ 不做导出面裁剪） */
async function moduleDts(source: string): Promise<string> {
  const result = await analyzeFileAsync(PATH, source, undefined, undefined, undefined, "none");
  const surface = dtsModuleSurface(source);
  const entries = result.functions
    .filter((fn) => fn.cases.length > 0)
    .map((fn) => ({ fn, projection: projectFunctionDts(fn, undefined, surface) }));
  const values = new Map<string, Abs>();
  for (const [name, info] of result.bindings) values.set(name, info.abs);
  return projectModuleDts(surface, entries, { values }).lines.join("\n");
}

/** 消费方编译：`mod.d.ts` = 产物，`use.ts` = 用法。 */
function consumer(dts: string, use: string): { ok: boolean; stderr: string } {
  return tscNoEmit({ "mod.d.ts": dts, "use.ts": use });
}

const count = (text: string, re: RegExp): number => text.match(re)?.length ?? 0;

describe("重载函数的导出胶水", () => {
  it("BUG-416 重载 + `export { p as alias }` / `export default p`：别名与默认导出胶水都在产物里（重载集各一条）；消费方经别名 / 默认导入按重载解析", async () => {
    const dts = await moduleDts(`export function p(x: string): string;
export function p(x: number): number;
export function p(x: string | number): string | number { return x; }
export { p as alias };
export default p;
`);
    // 导出胶水：别名与默认导出各一行（默认导出 nudo 发 `export { p as default }`）
    expect(dts).toContain("export { p as alias };");
    expect(dts).toContain("export { p as default };");
    // 重载集保留，且不随导出名翻倍
    expect(count(dts, /function p\(x: string\): string;/g)).toBe(1);
    expect(count(dts, /function p\(x: number\): number;/g)).toBe(1);

    const use =
      'import def, { alias } from "./mod.js";\n' +
      "export const a: number = alias(1);\n" +
      'export const b: string = def("x");\n';
    const ok = consumer(dts, use);
    expect(ok.ok, ok.stderr).toBe(true);

    // 改前产物形态确实红：只剩重载本体、胶水整条消失
    const broken = consumer(
      "export declare function p(x: string): string;\nexport declare function p(x: number): number;\n",
      use,
    );
    expect(broken.ok).toBe(false);
    expect(broken.stderr).toContain("TS2305");
    expect(broken.stderr).toContain("TS2349");
  });
});

describe("namespace 声明合并", () => {
  it("BUG-457 同名 namespace 分块声明（函数块 / const 块 / 函数块）：产物合成一个块且三块成员齐全；消费方逐成员可用", async () => {
    const dts = await moduleDts(`export namespace N {
  export function f(): number { return 1; }
}
export namespace N {
  export const b = 2;
}
export namespace N {
  export function g(): string { return "s"; }
}
`);
    expect(count(dts, /namespace N/g)).toBe(1);
    expect(dts).toContain("export function f(): number;");
    expect(dts).toContain("export const b: 2;");
    expect(dts).toContain("export function g(): string;");

    const use =
      'import { N } from "./mod.js";\n' +
      "export const a: number = N.f();\n" +
      "export const b: 2 = N.b;\n" +
      'export const c: string = N.g();\n';
    const ok = consumer(dts, use);
    expect(ok.ok, ok.stderr).toBe(true);

    // 改前产物形态确实红：后写覆盖，只剩末块
    const broken = consumer("export declare namespace N {\n  export function g(): string;\n}\n", use);
    expect(broken.ok).toBe(false);
    expect(broken.stderr).toContain("TS2339");
  });

  it("BUG-457 同名 namespace 的声明器形态（块内全是 `export function …;`）：产物合成一个块且成员齐全；消费方逐成员调用", async () => {
    const dts = await moduleDts(`export namespace N {
  export function a(): number;
}
export namespace N {
  export function b(): string;
}
`);
    expect(dts).toMatch(
      /export declare namespace N \{\n  export function a\(\): number;\n  export function b\(\): string;\n\}/,
    );

    const use = 'import { N } from "./mod.js";\nexport const a: number = N.a();\nexport const b: string = N.b();\n';
    const ok = consumer(dts, use);
    expect(ok.ok, ok.stderr).toBe(true);

    // 改前产物形态确实红：后写覆盖，只剩末块
    const broken = consumer("export declare namespace N {\n  export function b(): string;\n}\n", use);
    expect(broken.ok).toBe(false);
    expect(broken.stderr).toContain("TS2339");
  });
});

describe("值位置的函数表达式注解", () => {
  it("BUG-438 `export const f = (n: number) => (x: number): number => …`：产物保留内层形参 / 返回注解（`f(n: number): (x: number) => number`）；消费方合法调用通过、错实参报 TS2345", async () => {
    const dts = await moduleDts(
      "export const adderConst = (n: number) => (x: number): number => x + n;\n",
    );
    expect(dts).toContain("adderConst(n: number): (x: number) => number;");
    expect(dts).not.toContain("unknown");

    const valid = consumer(
      dts,
      'import { adderConst } from "./mod.js";\nexport const r: number = adderConst(1)(2);\n',
    );
    expect(valid.ok, valid.stderr).toBe(true);
    const invalid = consumer(
      dts,
      'import { adderConst } from "./mod.js";\nadderConst(1)("oops");\n',
    );
    expect(invalid.ok).toBe(false);
    expect(invalid.stderr).toContain("TS2345");

    // 改前产物形态：合法调用假红（TS2322）+ 错实参假绿
    const broken = consumer(
      "export declare function adderConst(n: number): (x: unknown) => unknown;\n",
      'import { adderConst } from "./mod.js";\nexport const r: number = adderConst(1)(2);\n',
    );
    expect(broken.ok).toBe(false);
    expect(broken.stderr).toContain("TS2322");
  });
});

describe("对象字面量计算键成员的注解", () => {
  it("BUG-482 计算键成员（const 字面量键 `[k]` / 字符串字面量键 `[\"dyn\"]` / 数字键 `[1]`）的形参与返回注解进产物；消费方按键名调用得到 `string`、错实参报 TS2345", async () => {
    const dts = await moduleDts(`const k = "dyn";
export const o10 = { [k]: (x: number): string => String(x) };
export const o10b = { ["dyn"]: (x: number): string => String(x) };
export const o11 = { [1]: (x: number): string => String(x) };
`);
    expect(dts).toContain("o10: { dyn: (x: number) => string };");
    expect(dts).toContain("o10b: { dyn: (x: number) => string };");
    expect(dts).toContain("o11: { 1: (x: number) => string };");
    expect(dts).not.toContain("unknown");

    const valid = consumer(
      dts,
      'import { o10, o10b, o11 } from "./mod.js";\n' +
        "export const a: string = o10.dyn(1);\n" +
        "export const b: string = o10b.dyn(1);\n" +
        "export const c: string = o11[1](2);\n",
    );
    expect(valid.ok, valid.stderr).toBe(true);
    const invalid = consumer(
      dts,
      'import { o10, o11 } from "./mod.js";\no10.dyn("oops");\no11[1]("oops");\n',
    );
    expect(invalid.ok).toBe(false);
    expect(count(invalid.stderr, /TS2345/g)).toBe(2);

    // 改前产物形态：合法调用假红（TS2322）
    const broken = consumer(
      "export declare const o10: { dyn: (x: unknown) => unknown };\n",
      'import { o10 } from "./mod.js";\nexport const a: string = o10.dyn(1);\n',
    );
    expect(broken.ok).toBe(false);
    expect(broken.stderr).toContain("TS2322");
  });
});
