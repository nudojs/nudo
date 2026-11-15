/**
 * BUG-098 —— guard 面把 brand 的**观测字面量**钉死（`source === "abc"` /
 * `flags === "g"` / `message === "boom"` …）⇒ 同一个 brand 的其它实例被拒
 * （`/abc/i`、`new TypeError(…)`），而 `.d.ts` / zod / standard 三面只判
 * **brand 身份**（`instanceof`）⇒ 四面接受集相反（假红）。
 *
 * 根因：`denote.ts` 的 `case "brand"` 直接递归内层 shape，而内层槽在 Abs 里
 * 是**观测到的字面量**；`widenUncertainLiteral` 只放宽顶层 term，不递归槽位。
 *
 * 本钉：brand 内层只保留**类型**子句 ⇒ 同 brand 的任意实例都放行。
 */
import { describe, it, expect } from "vitest";
import { abs, obj, strLit, numLit, type Abs } from "@nudojs/core";
import { denoteGuard } from "@nudojs/core/internal";

/** `new RegExp("abc", "g")` 的观测形态：brand + 内层字面量槽 */
function regexpAbs(): Abs {
  return abs(
    {
      k: "brand",
      name: "RegExp",
      shape: obj({
        source: { value: strLit("abc") },
        flags: { value: strLit("g") },
        lastIndex: { value: numLit(0) },
      }),
    },
    undefined,
    undefined,
    "exact",
  );
}

function errorAbs(): Abs {
  return abs(
    {
      k: "brand",
      name: "Error",
      shape: obj({
        message: { value: strLit("boom") },
        name: { value: strLit("Error") },
      }),
    },
    undefined,
    undefined,
    "exact",
  );
}

const runner = (g: string): ((data: unknown) => boolean) =>
  new Function("data", `return ${g};`) as (data: unknown) => boolean;

describe("BUG-098 — brand 内层的观测字面量不得钉成出口域", () => {
  it("RegExp：同 brand 的任意实例都放行（`/abc/i`、`/xyz/g`）", () => {
    const g = denoteGuard(regexpAbs(), "data");
    expect(g).not.toContain('=== "abc"');
    const check = runner(g);
    expect(check(/abc/g)).toBe(true);
    expect(check(/abc/i)).toBe(true);
    expect(check(/xyz/g)).toBe(true);
    // 负控制：身份仍在
    expect(check({})).toBe(false);
    expect(check([])).toBe(false);
  });

  it("Error：`new TypeError('boom')` 也是 Error（身份判据，不钉 message/name）", () => {
    const check = runner(denoteGuard(errorAbs(), "data"));
    expect(check(new Error("boom"))).toBe(true);
    expect(check(new Error("other"))).toBe(true);
    expect(check(new TypeError("boom"))).toBe(true);
    expect(check({ message: "boom", name: "Error" })).toBe(false);
  });
});
