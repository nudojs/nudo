/**
 * BUG-006 回归：含 nullish 字面量成员的 union（`nullable(...)`）无法**证违**
 * 结构化返回值 ⇒ 违约事实被降级成 `nudo:unproven-return`（warning）⇒ 门禁
 * 判 OK、exit 0（假绿）。同一条契约在参数侧是 error 级拦截。
 *
 * 根因（两环）：
 * 1. `lit(null)` / `lit(undefined)` 的约束**没有 prim**（域靠 `eq(self, null)`
 *    承载）⇒ `assertScalar` 的 prim 门不触发；值相等义务随后落到
 *    `isBoundedEvidenceMissing` 的兜底「无证据」⇒ `unprovable`——该函数把
 *    **值相等义务**误分类成**带界义务**（gt/ge/lt/le），而结构化形状本身
 *    已确定「不是 nullish」。
 * 2. union 聚合「任一成员 unprovable ⇒ 整体 unprovable」⇒ 已被确定证伪的
 *    `number()` 成员被伪不可判定的 nullish 成员掩盖 ⇒ disproved 降级 unprovable。
 *
 * 修法：值相等义务在返回项形状与其字面量域**不相交**时可判定 ⇒ 不蕴含即
 * `disproved`；于是全部成员被证伪 ⇒ union 整体 `disproved`（error）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { abs, absLit } from "../abs.ts";
import { app as termApp, v as termVar } from "../term.ts";
import { nullable, number } from "../constraint.ts";
import { assertImplies } from "../postcondition.ts";

const SIDECAR = `
export const maybeNumber = nullable(number());
export const numOrNull = union(number(), lit(null));
`;

const opts = {
  loadModule: (spec: string) => (spec.includes("nullish.nudo.js") ? SIDECAR : undefined),
  fromFile: "/t/app.js",
};

function check(contract: string, body: string) {
  const src = `/// @nudo:import { maybeNumber, numOrNull } from "./nullish.nudo.js"
/**
 * @nudo:contract return ${contract}
 */
export function f() {
  return ${body};
}
`;
  return checkSource("/t/app.js", src, pTrue, opts);
}

const violation = (r: ReturnType<typeof check>) =>
  r.issues.find((i) => i.code === "nudo:constraint-violated" && i.fn === "f");

const unproven = (r: ReturnType<typeof check>) =>
  r.issues.find((i) => i.code === "nudo:unproven-return" && i.fn === "f");

describe("BUG-006: nullable(...) 对结构化返回值必须判违约（error）", () => {
  it.each([
    ["[]", "空数组"],
    ["{}", "空对象"],
    ["{ a: 1 }", "普通对象"],
  ])("返回 %s（%s）⊭ nullable(number()) ⇒ error", (body) => {
    const r = check("maybeNumber", body);
    const v = violation(r);
    expect(v).toBeDefined();
    expect(v!.severity).toBe("error");
    // 旧口径的假绿症状：只出 warning
    expect(unproven(r)).toBeUndefined();
  });

  it("union(number(), lit(null)) 同口径：数组返回值 ⇒ error", () => {
    const v = violation(check("numOrNull", "[1]"));
    expect(v).toBeDefined();
    expect(v!.severity).toBe("error");
  });

  it("不制造假红：null / undefined / number 返回值仍放行", () => {
    expect(violation(check("maybeNumber", "null"))).toBeUndefined();
    expect(violation(check("maybeNumber", "undefined"))).toBeUndefined();
    expect(violation(check("maybeNumber", "1"))).toBeUndefined();
    expect(unproven(check("maybeNumber", "null"))).toBeUndefined();
  });

  it("单元面：结构臂 ⊭ union ⇒ disproved（不是 unprovable）", () => {
    const numAbs = abs({ k: "prim", type: "number" }, undefined, undefined, "partial");
    const arrAbs = abs({ k: "arr", element: numAbs }, undefined, undefined, "path");
    const tup = abs({ k: "tuple", elements: [] }, undefined, undefined, "exact");
    const obj = abs({ k: "obj", slots: {} }, undefined, undefined, "exact");
    expect(assertImplies(arrAbs, nullable(number())).status).toBe("disproved");
    expect(assertImplies(tup, nullable(number())).status).toBe("disproved");
    expect(assertImplies(obj, nullable(number())).status).toBe("disproved");
    // nullish 字面量仍按域隶属放行
    const nullLit = absLit(null);
    expect(assertImplies(nullLit, nullable(number())).status).toBe("proved");
  });

  it("护栏：同域值相等义务（lit(5) 对无 pred 的 number 返回值）不得升级成 error", () => {
    // 返回项形状与字面量**同域** ⇒ 不可判定 ⇒ 仍是 unprovable（warning），
    // 不得因本条修法变成 disproved（假红）。
    const numNoPred = abs({ k: "prim", type: "number" }, undefined, undefined, "partial");
    expect(assertImplies(numNoPred, number().gt(0)).status).toBe("unprovable");
    const derived = abs(
      { k: "prim", type: "number" },
      termApp("abs", [termVar("x")]),
      undefined,
      "path",
    );
    expect(assertImplies(derived, number().gt(0)).status).toBe("unprovable");
  });
});
