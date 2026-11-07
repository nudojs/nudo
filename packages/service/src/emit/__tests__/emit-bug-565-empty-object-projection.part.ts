/**
 * Bug 565 —— dts 把「**无已知成员的对象**」渲染成 TypeScript 的 `{}`。
 *
 * TS 语义：类型 `{}` = 「**任意非 nullish 值**」（`42` / `"str"` / `[]` 全部
 * 合法）——它**不是**「没有属性的对象」。⇒ ① 消费方属性读吃 **TS2339 假红**
 * （运行期返回 `undefined`，合法）；② 联合类型里 `{}` **吸收** `{ a: number }`
 * ⇒ 契约义务被静默作废；③ 同一次导出的 zod 面要求「必须是对象」⇒ 四面矛盾。
 *
 * 修法：零成员对象 → `Record<string, never>`（TS 的空对象类型）：属性读合法
 * （不报 TS2339），且在联合类型里**不吸收** `{ a: number }`（契约义务保留）。
 */
import { describe, it, expect } from "vitest";
import { num, numLit, objOf } from "@nudojs/core";
import { absToTSType, generateDts } from "../dts-generator.ts";
import { analyzeFile } from "@nudojs/service";
import { tscNoEmit } from "./dts-tsc.ts";

describe("Bug 565 —— 零成员对象不是 TS 的 {}", () => {
  it("空 obj → Record<string, never>（不是 {}）", () => {
    expect(absToTSType(objOf({}))).toBe("Record<string, never>");
  });

  it("负控制：有成员的对象仍是结构体（不误伤）", () => {
    expect(absToTSType(objOf({ a: { value: num() } }))).toBe("{ a: number }");
  });

  it("端到端：空对象返回值的属性读不再吃 TS2339", () => {
    const dts = generateDts(
      analyzeFile("/test/bug565.js", `export function empty() {\n  return {};\n}\n`),
    );
    expect(dts).toContain("Record<string, never>");
    expect(dts).not.toContain(": {};");
    const consumer = `
import { empty } from "./lib.js";
const v = empty();
const p = v.foo;
export { p };
`;
    const check = tscNoEmit({ "lib.d.ts": dts, "use.ts": consumer });
    expect(check.ok, check.stderr).toBe(true);
  });

  it("联合类型里契约义务不被吸收（{ a: number } | Record<string, never>）", () => {
    const dts = `
export declare function read(u: { a: number } | Record<string, never>): Record<string, never>;
`;
    const bad = `
import { read } from "./lib.js";
export const bad1 = read({ a: "wrong-type" });
`;
    const check = tscNoEmit({ "lib.d.ts": dts, "use.ts": bad });
    expect(check.ok).toBe(false);
    expect(check.stderr).toContain("TS2322");
  });

  it("非对象实参被拒（与 zod 面「必须是对象」同裁决）", () => {
    const dts = `
export declare function read(u: { a: number } | Record<string, never>): Record<string, never>;
`;
    const bad = `
import { read } from "./lib.js";
export const bad2 = read(42);
`;
    const check = tscNoEmit({ "lib.d.ts": dts, "use.ts": bad });
    expect(check.ok).toBe(false);
    expect(check.stderr).toContain("TS2345");
  });

  it("改前形态确实红（{} ⇒ TS2339，且联合里吸收契约义务）", () => {
    const before = `
export declare function empty(): {};
`;
    const consumer = `
import { empty } from "./lib.js";
const v = empty();
const p = v.foo;
export { p };
`;
    const check = tscNoEmit({ "lib.d.ts": before, "use.ts": consumer });
    expect(check.ok).toBe(false);
    expect(check.stderr).toContain("TS2339");
  });

  it("负控制：字面量成员对象不受影响（结构体照旧，嵌套精度保留）", () => {
    const dts = generateDts(
      analyzeFile("/test/bug565b.js", `export function one() {\n  return { a: 1 };\n}\n`),
    );
    expect(dts).toContain("{ a: 1 }");
  });
});
