/**
 * BUG-030：可判定的契约矛盾被降级成「不可计算」warning ⇒ `nudo check` exit 0。
 *
 * 源码契约 `x = 42`（`lit(42)` 模板）∧ 侧车契约 `x ∈ {43,44}`
 * （`union(lit(43),lit(44))`）的合取**为空集**——完全可判定，必须报
 * `nudo:interface-conflict` **error**（docs/design/refine-derivation.md：
 * 「源码 + 侧车是合取 … 不可满足报冲突码」）。
 *
 * 旧口径 `crossBoundConflict` 只读各侧**顶层** preds（不下钻 `members`）⇒ 矛盾
 * 看不见 ⇒ 落进 `isNonScalarForm` 的 undecidable 通道 ⇒ warning + exit 0；
 * 而**同一个矛盾**写成平铺字面量（`lit(43)`）就是 error ⇒ 两种拼写两种结论。
 *
 * 钉：有限字面量集之间交集为空 ⇒ error（不是 warning / undecidable）；
 * 且可满足的有限集组合仍然不误报。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { resetCheckSourceMemo } from "../check.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { takeInterfaceDiags } from "../interface.ts";
import { takeRefineDiags } from "../refine.ts";
import { makeFiles } from "./nudo-constraints.ts";

const SRC = `
/// @nudo:import { fortyTwo } from "./tmpl.nudo.js"

/**
 * @nudo:contract x fortyTwo
 */
export function f(x) {
  return x;
}
f(42);
`;

function check(sidecar: string) {
  const { loadModule } = makeFiles({
    "/t/lib.nudo.js": sidecar,
    "/t/tmpl.nudo.js": `import { lit } from "@nudojs/core";\nexport const fortyTwo = lit(42);\n`,
  });
  return checkSource("/t/lib.js", SRC, pTrue, {
    loadModule,
    fromFile: "/t/lib.js",
  });
}

describe("BUG-030 有限字面量集的矛盾 ⇒ error（可判定）", () => {
  beforeEach(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeInterfaceDiags();
    takeRefineDiags();
  });

  it("x = 42 ∧ x ∈ {43,44} → nudo:interface-conflict error + exit≠0", () => {
    const r = check(
      `import { fn, lit, union } from "@nudojs/core";\nexport const f = fn({ x: union(lit(43), lit(44)) });\n`,
    );
    const conflicts = r.issues.filter((i) => i.code === "nudo:interface-conflict");
    // 矛盾不是「不可计算」：只有一条 error，不得再印 undecidable warning
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.severity).toBe("error");
    expect(conflicts[0]!.message).toContain("unsatisfiable");
    expect(r.ok).toBe(false);
  });

  it("平铺字面量同款矛盾 → error（两种拼写同结论）", () => {
    const flat = check(`import { fn, lit } from "@nudojs/core";\nexport const f = fn({ x: lit(43) });\n`);
    const withUnion = check(
      `import { fn, lit, union } from "@nudojs/core";\nexport const f = fn({ x: union(lit(43), lit(44)) });\n`,
    );
    expect(flat.issues.find((i) => i.code === "nudo:interface-conflict")?.severity).toBe("error");
    expect(withUnion.issues.find((i) => i.code === "nudo:interface-conflict")?.severity).toBe("error");
  });

  it("有限集有交集（x = 42 ∧ x ∈ {42,43}）→ 不报矛盾", () => {
    const r = check(
      `import { fn, lit, union } from "@nudojs/core";\nexport const f = fn({ x: union(lit(42), lit(43)) });\n`,
    );
    const conflicts = r.issues.filter((i) => i.code === "nudo:interface-conflict");
    // 有交集 ⇒ 不是「不可满足」：不得出现 unsatisfiable / error。
    // （合取能力边界仍可印一条 undecidable warning——那是既有的显式留痕。）
    expect(conflicts.filter((i) => i.severity === "error")).toEqual([]);
    expect(conflicts.some((i) => i.message.includes("unsatisfiable"))).toBe(false);
    expect(r.ok).toBe(true);
  });
});
