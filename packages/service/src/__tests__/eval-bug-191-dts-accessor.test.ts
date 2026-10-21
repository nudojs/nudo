/**
 * Bug 191 回归（**dts 投影面**）：对象字面量访问器（getter）的占位槽
 * 不得在 `.d.ts` 里被渲染成 exact `undefined`。
 *
 * 背景：访问器不住在 shape 槽里——transpile 只落一个 `$lit(void 0)` 占位槽
 * （保键存在性），真 getter 住 core 的 accessorTable 侧表。**读**通道
 * （$get）先查侧表 ⇒ `o.ab` 读得对；但 **dts 投影**直读占位槽 ⇒
 * `{ get ab() { return 1; } }` 的 dts 渲染成 `{ ab: undefined }`（自信的
 * 错值：比真值更窄且自相矛盾——消费方按此声明写代码拿到 undefined 类型，
 * 真值是 number）。
 *
 * 修法（service/emit/dts-generator.ts）：dts 投影按 getter **读域**渲染
 * （有 getter → 以对象为接收者求值；getter 抛 → unknown；无 getter → 槽值）。
 * 与 core 投影面（formatShape / denoteGuard / absToConstraint / 契约证明）
 * 同口径。
 *
 * 断言与 Node 真实执行结果对齐（原生读值见各用例注释）。
 */
import { describe, it, expect } from "vitest";
import { analyzeFile } from "@nudojs/service";
import { generateDts } from "../emit/dts-generator.ts";

/** 源码 → dts 文本 */
function dtsOf(source: string): string {
  return generateDts(analyzeFile("/test/bug191-dts.js", source));
}

/** dts 里该函数的声明行（`export declare function g(...): T;`） */
function declOf(source: string): string {
  const line = dtsOf(source)
    .split("\n")
    .find((l) => l.startsWith("export declare function"));
  return line ?? "";
}

describe("Bug 191 — dts 面：访问器占位槽不得渲染成 exact undefined", () => {
  it("getter 返数字：dts 取读域 number（原生读 1）", () => {
    expect(declOf(`export function g() { return { get ab() { return 1; } }; }`)).toContain(
      "{ ab: 1 }",
    );
  });

  it("getter 返字符串：dts 取读域（原生读 \"s\"）", () => {
    expect(
      declOf(`export function g() { return { get ab() { return "s"; } }; }`),
    ).toContain('{ ab: "s" }');
  });

  it("getter 以 this 为接收者读域（原生 this.n = 41）", () => {
    expect(
      declOf(`export function g() { return { n: 41, get q() { return this.n; } }; }`),
    ).toContain("{ n: 41; q: 41 }");
  });

  it("嵌套对象的 getter 槽同样按读域渲染", () => {
    expect(
      declOf(`export function g() { return { inner: { get ab() { return 2; } } }; }`),
    ).toContain("{ inner: { ab: 2 } }");
  });

  it("getter 抛（读域不可刻画）→ unknown，不得回落 definite undefined", () => {
    expect(
      declOf(`export function g() { return { get boom() { throw new Error("x"); } }; }`),
    ).toContain("{ boom: unknown }");
  });

  it("dts 不得出现 exact undefined 的访问器槽", () => {
    const dts = dtsOf(`export function g() { return { get ab() { return 1; } }; }`);
    expect(dts).not.toContain("ab: undefined");
  });
});

describe("Bug 191 dts 负控制：非 getter 槽不受影响", () => {
  it("普通数据属性仍渲染成它的值类型", () => {
    expect(declOf(`export function g() { return { plain: 5 }; }`)).toContain("{ plain: 5 }");
  });

  it("显式 undefined 数据属性仍渲染成 undefined", () => {
    expect(declOf(`export function g() { return { u: undefined }; }`)).toContain(
      "{ u: undefined }",
    );
  });

  it("仅 setter 的访问器：原生读值恒 undefined，占位槽本就正确", () => {
    expect(declOf(`export function g() { return { set ab(v) {} }; }`)).toContain(
      "{ ab: undefined }",
    );
  });

  it("空对象渲染成 Record<string, never>（不是 TS 的 {}，Bug 565）", () => {
    // TS 的 `{}` = 任意非 nullish 值（不是「空对象」）⇒ 属性读吃 TS2339 假红，
    // 且在联合类型里吸收 `{ a: number }`（契约义务被静默作废）
    expect(declOf(`export function g() { return {}; }`)).toContain(
      "Record<string, never>",
    );
  });
});
