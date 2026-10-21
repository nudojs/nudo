/**
 * Bug 242 回归：`new Intl.Collator('en')` 等**未建模子构造器**返回内部伪名
 * brand（`__nudoFnParentN`），该伪名泄漏进 `nudo check` 签名 / dts 产物
 * （TS2304：伪名是合法 JS 标识符却从未声明）/ schema 产物
 * （`z.instanceof(伪名)` ⇒ 加载即 ReferenceError）。
 *
 * 根因两处：
 * 1. 命名空间成员 fn 投影（containers/member.ts）**不带 name** ⇒ `new` 落
 *    「伪父名」兜底（`ensureFnParentName`）——伪名成了实例的**类型名**；
 * 2. `$new`（packages/core/src/algebra/exec/class/declare.ts）用伪名兜底时
 *    直接造出 brand 实例。
 *
 * 修法：
 * - core 侧（declare.ts）：伪名**不得**成为实例的类型名——命名空间成员
 *   构造器（宿主成员函数：无体、只有 apply 钩子）未建模 ⇒ 折 unknown
 *   （台账口径：Intl 成员未建模，接受 unknown）；
 * - 命名空间成员投影带 name（containers/member.ts，S2a 的 Bug 243 修复）⇒
 *   实例 brand 拿到真名（`Intl.<Sub>`），不再落伪名。
 *
 * 本文件钉住**行为**（实例 brand 名不得是内部伪名 + 产物面不得引用伪名），
 * 与具体由哪一侧收口无关。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

const wrap = (body: string) => `export function f() { ${body} }`;

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue(call(src, "f").result);
}

/** 结果的 brand 名（非 brand → ""） */
function brandName(src: string): string {
  const r = call(src, "f").result as { shape?: { k?: string; name?: string } };
  return r?.shape?.k === "brand" ? (r.shape.name ?? "") : "";
}

/** 内部伪名的判定（`__nudoFnParentN` 一族——实现细节，不得出现在类型面上） */
function isInternalPseudoName(name: string): boolean {
  return /^__nudoFnParent\d*$/.test(name);
}

describe("Bug 242 — 未建模 Intl 子构造器不得返回内部伪名 brand", () => {
  it("new Intl.Collator('en') 的 brand 名不是内部伪名", () => {
    const name = brandName(wrap(`return new Intl.Collator('en');`));
    expect(isInternalPseudoName(name)).toBe(false);
  });

  it("new Intl.ListFormat('en') / new Intl.Locale('en') 的 brand 名不是内部伪名", () => {
    for (const ctor of ["ListFormat", "Locale"]) {
      const name = brandName(wrap(`return new Intl.${ctor}('en');`));
      expect(isInternalPseudoName(name), ctor).toBe(false);
    }
  });

  it("负控制：已建模的 Intl 子构造器保留其 brand 名（Intl.NumberFormat）", () => {
    const name = brandName(wrap(`return new Intl.NumberFormat('en');`));
    expect(isInternalPseudoName(name)).toBe(false);
    expect(name).not.toBe("");
  });

  it("负控制：未建模子构造器的**调用**形（Intl.Collator('en')）折 unknown（台账：接受 unknown）", () => {
    const r = call(wrap(`return Intl.Collator('en');`), "f").result as { shape?: { k?: string } };
    expect(r?.shape?.k).toBe("unknown");
  });

  it("负控制：用户类的实例 brand 仍是用户类名（不得被伪名/降级污染）", () => {
    const name = brandName(wrap(`class User242 { constructor(){ this.n = 1; } } return new User242();`));
    expect(name).toBe("User242");
    expect(isInternalPseudoName(name)).toBe(false);
  });
});
