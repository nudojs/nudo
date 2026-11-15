/**
 * Bug 47 回归：模块里一条非 `declare` 的 `namespace` 此前让转译器抛
 * NudoUnsupportedError ⇒ 整个模块求值失败 ⇒ 同模块无关导出全部退化成
 * unknown（返回契约违例从 error 降成 warning，exit 0 假绿）。
 * 修复：namespace 降级为局部 opaque 绑定，其它导出照常求值。
 */
import { describe, it, expect } from "vitest";
import { val, call } from "./eval-helpers.ts";
import { litValue } from "@nudojs/core";
import { checkSource } from "../check/check.ts";
import { pTrue } from "../pred.ts";

const PLAIN = `export function bad() { return 1; }
export const top = 7;`;
const POISONED = `export namespace NS { export const x = 1; }
export function bad() { return 1; }
export const top = 7;`;

describe("Bug 47 — namespace 不污染同模块其它导出", () => {
  it("存在 export namespace 时无关函数仍是精确值（改前 unknown）", () => {
    expect(val(POISONED.replace("bad", "f"))).toEqual({ ok: true, value: 1 });
  });

  it("顶层常量导出同样不退化", () => {
    const exp = call(POISONED, "bad");
    expect(litValue(exp.result)).toEqual({ ok: true, value: 1 });
  });

  it("check 面的问题集合与无 namespace 的同一模块一致（不再假绿）", () => {
    const codes = (src: string, name: string) =>
      checkSource(`/t/bug47-${name}.ts`, src, pTrue, {})
        .issues.map((i) => i.code)
        .sort()
        .join(",");
    expect(codes(POISONED, "poisoned")).toBe(codes(PLAIN, "plain"));
  });
});
