/**
 * A2+A8 / A10 / A11 的地基回归：Abs 可扩展槽位容器。
 *
 * 对应 docs/design/architecture-debt.md「剩余槽位的受控 major 执行方案」步骤 1：
 * - 缺省不出现 ⇒ 旧 Abs 的键 / 投影 / leq 接受集逐字节不变；
 * - subst / snapshot / rename / join 等**重建点**必须整包搬运（A7 教训）。
 *
 * 本测试不启用任何槽位的语义，只钉住容器本身。逐槽启用另立回归基线。
 */
import { describe, it, expect } from "vitest";
import { numLit, type Abs, type AbsFacets } from "../abs.ts";
import { snapshotAbs, substAbs } from "../hof.ts";
import { renameAbs } from "../key/generalize-key.ts";
import { absKey } from "../key/abs-key.ts";
import { leqAbs } from "../leq.ts";
import { joinAbs } from "../objects.ts";
import { formatAbs, formatShape } from "../format/format.ts";

const facets: AbsFacets = {
  callable: false,
  protoOwnKeys: { strings: ["constructor", "name"], symbols: ["Symbol.iterator"] },
  brand: "Generator",
};

function withFacets(a: Abs, f: AbsFacets = facets): Abs {
  a.facets = f;
  return a;
}

describe("Abs facets carrier — 缺省不出现 ⇒ 旧面逐字节不变", () => {
  it("无 facets 的 Abs 不携带该字段", () => {
    expect("facets" in numLit(1)).toBe(false);
  });

  it("带容器不改变展示投影与 leq 接受集", () => {
    const a = withFacets(numLit(1));
    const b = numLit(1);
    expect(formatShape(a)).toBe(formatShape(b));
    expect(formatAbs(a)).toBe(formatAbs(b));
    expect(leqAbs(a, b).ok).toBe(true);
    expect(leqAbs(b, a).ok).toBe(true);
  });

  it("空容器不改变 absKey", () => {
    expect(absKey(withFacets(numLit(1), {}))).toBe(absKey(numLit(1)));
  });

  it("非空 facets 进键，且不同槽位不撞键", () => {
    const a = withFacets(numLit(1));
    const b = withFacets(numLit(1), { callable: true });
    const c = withFacets(numLit(1), { brand: "Generator" });
    expect(absKey(a)).not.toBe(absKey(numLit(1)));
    expect(absKey(a)).not.toBe(absKey(b));
    expect(absKey(b)).not.toBe(absKey(c));
    // 同槽位同形状 ⇒ 键稳定（不因对象身份漂移）；term 不同仍可区分。
    expect(absKey(a)).toBe(absKey(withFacets(numLit(1))));
    expect(absKey(withFacets(numLit(2)))).not.toBe(absKey(a));
  });
});

describe("Abs facets carrier — 重建点不得静默抹掉槽位", () => {
  it("snapshotAbs 保留且深拷贝", () => {
    const a = withFacets(numLit(2));
    const copy = snapshotAbs(a);
    expect(copy.facets).toEqual(facets);
    expect(copy.facets).not.toBe(a.facets);
    copy.facets!.protoOwnKeys!.strings.push("x");
    expect(a.facets!.protoOwnKeys!.strings).toHaveLength(2);
  });

  it("substAbs 保留（含 var 替换分支）", () => {
    expect(substAbs(withFacets(numLit(2)), new Map()).facets).toEqual(facets);
  });

  it("renameAbs 保留", () => {
    expect(renameAbs(withFacets(numLit(2)), new Map()).facets).toEqual(facets);
  });

  it("joinAbs 同值保留", () => {
    expect(joinAbs(withFacets(numLit(2)), withFacets(numLit(2))).facets).toEqual(facets);
  });
});
