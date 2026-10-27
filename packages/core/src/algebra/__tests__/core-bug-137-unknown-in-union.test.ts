/**
 * BUG-137：`nudo:unknown-inference`（引擎债诊断）在 **unknown 出现在 union 里**
 * 时漏报 ⇒ 同一个 `document` 对象上「一个报一个不报」；违反设计文档
 * `cli-semantics` 的**禁止条款**「在 check 中对 unknown（失败）静默通过而不报
 * 引擎债相关诊断」。
 *
 * env 把未建模的宿主对象建模成 `unknown | null`（`web.ts` 的
 * `unionOf(prim.unknown, nullLit())`、`es.ts` 等）——本套件用同一形态的
 * sum Abs 注入 envGlobals（等价于 env 面产出），钉：
 * - `unknown | null` ⇒ 报（旧口径只认裸 unknown ⇒ 漏报）；
 * - 裸 unknown ⇒ 仍报（对照组）；
 * - 有值证据（`lit` term，如 `undefined`）不是引擎债 ⇒ 不报。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { abs, num, unknown } from "../abs.ts";
import { $lit } from "../exec/runtime/state.ts";
import { lit } from "../term.ts";
import { resetCheckSourceMemo } from "../check.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { takeInterfaceDiags } from "../interface.ts";
import { takeRefineDiags } from "../refine.ts";

/**
 * env 面「未建模宿主对象」形态：`unionOf(prim.unknown, nullLit())`
 * （`packages/env/src/abs-helpers.ts:68` 的 nullLit = brand("null") + lit term）
 */
const NULL_BRAND = abs(
  { k: "brand", name: "null", shape: abs({ k: "unknown" }, lit(null), undefined, "exact") },
  lit(null),
  undefined,
  "exact",
);
const UNKNOWN_OR_NULL = abs(
  { k: "sum", members: [unknown, NULL_BRAND] },
  undefined,
  undefined,
  "exact",
);

function check(globals: Record<string, unknown>) {
  return checkSource(
    "/t/w.js",
    `export function q(sel) {\n  return ${Object.keys(globals)[0]};\n}\n`,
    pTrue,
    { inject: { envGlobals: globals as never } },
  );
}

describe("BUG-137 union 里的 unknown 同样算引擎债", () => {
  beforeEach(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeInterfaceDiags();
    takeRefineDiags();
  });

  it("unknown | null 的返回 ⇒ nudo:unknown-inference", () => {
    const r = check({ doc: UNKNOWN_OR_NULL });
    const warn = r.issues.filter((i) => i.code === "nudo:unknown-inference");
    expect(warn).toHaveLength(1);
    expect(warn[0]!.severity).toBe("warning");
    expect(warn[0]!.fn).toBe("q");
  });

  it("裸 unknown ⇒ 仍报（对照组，行为不变）", () => {
    const r = check({ doc: unknown });
    expect(r.issues.filter((i) => i.code === "nudo:unknown-inference")).toHaveLength(1);
  });

  it("有值证据（unknown 形状 + lit(undefined) term）不是引擎债 ⇒ 不报", () => {
    const r = check({ doc: $lit(undefined) });
    expect(r.issues.filter((i) => i.code === "nudo:unknown-inference")).toEqual([]);
  });

  it("具体类型不受影响 ⇒ 不报", () => {
    const r = check({ doc: num() });
    expect(r.issues.filter((i) => i.code === "nudo:unknown-inference")).toEqual([]);
  });
});
