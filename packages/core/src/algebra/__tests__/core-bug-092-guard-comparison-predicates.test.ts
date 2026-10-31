/**
 * BUG-092 —— guard 面把契约里的**比较类谓词**整段蒸发（`.int()` 的整性谓词 +
 * 嵌套字段的数值界）⇒ guard 放行契约外值（`3.5` / `NaN` / `{n:0}`），而同一
 * 份源码的 zod / standard 面拒绝 ⇒ 三个产物面对同一个值给出相反裁决。
 *
 * 根因：`denote.ts` 的 `predAsJs` 只认「左端是值本身」的比较；`.int()` 的
 * 左端是 `app("%", [x, lit(1)])`、嵌套界左端是 `app("get", [parent, lit(k)])`
 * ⇒ 两个分支全部落空 ⇒ 谓词被抹成 `"true"`。
 *
 * 本钉：两种可判定形态都必须投影出来，且**运行时接受集**与契约域一致。
 */
import { describe, it, expect } from "vitest";
import { abs, eq, gt, app, lit, obj, v, type Abs } from "@nudojs/core";
import { denoteGuard } from "@nudojs/core/internal";

const SELF = v("__nudo_self__");

/** `number().int()` 的 Abs 形态：`eq(app("%", [self, lit(1)]), lit(0))` */
function intAbs(): Abs {
  return abs(
    { k: "prim", type: "number" },
    SELF,
    eq(app("%", [SELF, lit(1)]), lit(0)),
    "path",
  );
}

/** `shape({ n: number().gt(0) })` 的槽 Abs 形态：`gt(app("get", [self, "n"]), lit(0))` */
function nestedBoundAbs(): Abs {
  const field = app("get", [SELF, lit("n")]);
  return obj({
    n: {
      value: abs({ k: "prim", type: "number" }, field, gt(field, lit(0)), "path"),
    },
  });
}

const runner = (g: string): ((data: unknown) => boolean) =>
  new Function("data", `return ${g};`) as (data: unknown) => boolean;

describe("BUG-092 — guard 面保留比较类谓词", () => {
  it("`.int()` ⇒ `Number.isInteger`（不是恒真）", () => {
    const g = denoteGuard(intAbs(), "data");
    expect(g).toContain("Number.isInteger(data)");
    const check = runner(g);
    expect(check(3)).toBe(true);
    expect(check(-3)).toBe(true);
    expect(check(3.5)).toBe(false);
    expect(check(Number.NaN)).toBe(false);
    expect(check(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it("嵌套字段数值界 ⇒ `data.n > 0`（不是恒真）", () => {
    const g = denoteGuard(nestedBoundAbs(), "data");
    expect(g).toContain("data.n > 0");
    const check = runner(g);
    expect(check({ n: 1 })).toBe(true);
    expect(check({ n: 0 })).toBe(false);
    expect(check({ n: -5 })).toBe(false);
    expect(check({})).toBe(false);
  });
});
