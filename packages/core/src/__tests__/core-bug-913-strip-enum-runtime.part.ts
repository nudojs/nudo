/**
 * Bug 913 —— TS 的 `enum` 被整段删除 ⇒ 成员引用退化成未绑定全局读取 ⇒
 * 门禁 error 级 `nudo:entry-may-throw`（假红）+ dts / zod / standard / guard
 * 四个产物面把返回类型落成 `never`。
 *
 * 根因：strip-types.ts 的 `isTypeOnlyStatement` 把 `TSEnumDeclaration` 整条
 * 删除 ⇒ 模块里不再有 `E` 这个绑定。
 *
 * 修法：在 strip-types.ts 内**合成 enum 运行时对象**（路线 a）——逐形态对齐
 * tsc 的 emit：反向映射 / 自动递增 / 字符串枚举（无反向映射）/ const enum
 * （对齐 tsc 的 `--preserveConstEnums` 形态）。
 */
import { describe, it, expect } from "vitest";
import { parseSource } from "../index.ts";
import { call } from "../algebra/__tests__/eval-helpers.ts";
import { litValue } from "../algebra/abs.ts";

const body = (src: string) => parseSource(src).program.body;

describe("Bug 913: TS enum 被合成成运行时对象", () => {
  it("enum 声明不再被删除 ⇒ 变成一个 var 声明", () => {
    const b = body(`export enum E { A = 1 }`);
    expect(b.map((n) => n.type)).not.toContain("TSEnumDeclaration");
    const decl = b[0] as unknown as {
      type: string;
      declaration?: { type: string; kind?: string; declarations?: { id?: { name?: string } }[] };
    };
    expect(decl.type).toBe("ExportNamedDeclaration");
    expect(decl.declaration?.type).toBe("VariableDeclaration");
    expect(decl.declaration?.kind).toBe("var");
    expect(decl.declaration?.declarations?.[0].id?.name).toBe("E");
  });

  it("成员引用可求值 ⇒ f() => 1（不再是 never / ReferenceError）", () => {
    const rec = call(`export enum E { A = 1 }\nexport function f() { return E.A; }`);
    expect(litValue(rec.result)).toEqual({ ok: true, value: 1 });
  });

  it("反向映射可求值（E[1] === \"A\"）", () => {
    const rec = call(
      `export enum E { A = 1 }\nexport function f() { return E[1]; }`,
    );
    expect(litValue(rec.result)).toEqual({ ok: true, value: "A" });
  });

  it("自动递增（A=1 ⇒ B=2 ⇒ C=3）", () => {
    const rec = call(`export enum E { A = 1, B, C }\nexport function f() { return E.C; }`);
    expect(litValue(rec.result)).toEqual({ ok: true, value: 3 });
  });

  it("字符串枚举：值正确、无反向映射（E[\"a\"] 不存在）", () => {
    const rec = call(`export enum S { A = "a" }\nexport function f() { return S.A; }`);
    expect(litValue(rec.result)).toEqual({ ok: true, value: "a" });
    const rev = call(`export enum S { A = "a" }\nexport function f() { return S["a"]; }`);
    expect(litValue(rev.result)).not.toEqual({ ok: true, value: "A" });
  });

  it("混合枚举：数值成员有反向映射、字符串成员没有", () => {
    const num = call(`export enum M { A = 1, B = "b" }\nexport function f() { return M[1]; }`);
    expect(litValue(num.result)).toEqual({ ok: true, value: "A" });
    const str = call(`export enum M { A = 1, B = "b" }\nexport function f() { return M["b"]; }`);
    expect(litValue(str.result)).not.toEqual({ ok: true, value: "B" });
  });

  it("declare enum（环境声明）仍然整条删除", () => {
    const b = body(`declare enum DE { A = 1 }\nexport const x = 1;`);
    expect(b.map((n) => n.type)).not.toContain("TSEnumDeclaration");
    expect(b).toHaveLength(1);
  });

  it("enum 声明上的文件级指令随合成节点一起活下来（Bug 968 联动）", () => {
    const b = body(
      `/// @nudo:import { positive } from "./shapes.nudo.js"\nexport enum E { A = 1 }`,
    );
    const decl = b[0] as unknown as { leadingComments?: { value: string }[] };
    expect(decl.leadingComments?.[0]?.value).toContain("@nudo:import");
  });
});
