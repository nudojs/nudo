/**
 * Bug 410 —— guard 投影（`denoteGuard`）**丢掉结构义务**：object 形状**把数组
 * 当对象接受**、**required 键缺失不报**、string **长度界整段消失** → 同一次
 * `nudo export --format all` 里 zod / standard 面**都保真**，只有 guard 面
 * **比它们宽松**（假绿）。
 *
 * 根因：`packages/core/src/algebra/denote.ts` → `denoteShape` 的 `case "obj"`
 * 与 `predAsJs`：
 * ① obj 分支缺 `!Array.isArray(v)`；② required 键的存在性没有独立检查；
 * ③ `predAsJs` 对 `app` 项落到 `return "true"` ⇒ 作用在 `length(self)` 上的
 *    界（`length()` / `min()` / `max()`）整段丢失。
 *
 * 报告末尾「第 80 轮主持人复核补充」块的**第三形态**：必填槽**值域恰为
 * `undefined`** ⇒ 存在性必须是**独立子句**，**不能**写成 `v.a !== undefined`
 * （会误拒「存在但为 undefined」）。
 *
 * 本钉覆盖：① 值域含 undefined 的必填槽（独立存在性子句 + 运行时判定）；
 * ② 长度界（`length(3)` / `max(3)` / `min(2)`）的文本与运行时判定；
 * ③ 负控制：非 length 的 app 项 / 非自指锚点**不得**被投影成长度界。
 */
import { describe, it, expect } from "vitest";
import {
  abs as makeAbs,
  and,
  app,
  ge,
  le,
  lit,
  numLit,
  unknown,
  v as termVar,
  type Abs,
} from "@nudojs/core";
import { denoteGuard } from "@nudojs/core/internal";

/** obj 形态 Abs */
const objOfSlots = (
  slots: Record<string, { value: Abs; optional?: boolean }>,
): Abs => makeAbs({ k: "obj", slots }, undefined, undefined, "exact");

/** 把守卫表达式当运行时函数跑 */
const runner = (g: string): ((v: unknown) => boolean) =>
  new Function("data", `return ${g};`) as (v: unknown) => boolean;

describe("Bug 410 — guard 投影必须保真结构义务", () => {
  it("必填槽值域恰为 undefined：存在性是独立子句（不是 v.a !== undefined）", () => {
    const undefAbs = makeAbs({ k: "unknown" }, lit(undefined), undefined, "exact");
    const g = denoteGuard(
      objOfSlots({ a: { value: undefAbs }, b: { value: numLit(1) } }),
      "data",
    );
    // 独立存在性子句
    expect(g).toContain('Object.hasOwn(data, "a")');
    expect(g).toContain('"a" in data');
    // 值子句仍在
    expect(g).toContain("data.a === undefined");
    // 不得用值子句反推存在性
    expect(g).not.toContain("data.a !== undefined");
  });

  it("必填槽值域恰为 undefined：缺键被拒、存在但为 undefined 被放行", () => {
    const undefAbs = makeAbs({ k: "unknown" }, lit(undefined), undefined, "exact");
    const check = runner(
      denoteGuard(
        objOfSlots({ a: { value: undefAbs }, b: { value: numLit(1) } }),
        "data",
      ),
    );
    expect(check({ a: undefined, b: 1 })).toBe(true);
    expect(check({ b: 1 })).toBe(false);
    expect(check({ a: 1, b: 1 })).toBe(false);
    expect(check({ a: undefined })).toBe(false);
  });

  it("长度界 length(3) 被投影成 v.length 比较（不再整段蒸发）", () => {
    const lenTerm = termVar("s");
    const a = makeAbs(
      { k: "prim", type: "string" },
      lenTerm,
      and(
        ge(app("length", [lenTerm]), lit(3)),
        le(app("length", [lenTerm]), lit(3)),
      ),
      "exact",
    );
    const g = denoteGuard(a, "data");
    expect(g).toContain("data.length >= 3");
    expect(g).toContain("data.length <= 3");
    const check = runner(g);
    expect(check("abc")).toBe(true);
    expect(check("ab")).toBe(false);
    expect(check("abcd")).toBe(false);
    expect(check("")).toBe(false);
  });

  it("单边长度界：max(3) ⇒ <= ，min(2) ⇒ >=", () => {
    const lenTerm = termVar("s");
    const max = makeAbs(
      { k: "prim", type: "string" },
      lenTerm,
      le(app("length", [lenTerm]), lit(3)),
      "exact",
    );
    const min = makeAbs(
      { k: "prim", type: "string" },
      lenTerm,
      ge(app("length", [lenTerm]), lit(2)),
      "exact",
    );
    expect(denoteGuard(max, "data")).toContain("data.length <= 3");
    expect(denoteGuard(min, "data")).toContain("data.length >= 2");
    expect(runner(denoteGuard(max, "data"))("abc")).toBe(true);
    expect(runner(denoteGuard(max, "data"))("abcd")).toBe(false);
    expect(runner(denoteGuard(min, "data"))("ab")).toBe(true);
    expect(runner(denoteGuard(min, "data"))("a")).toBe(false);
  });

  it("负控制：非 length 的 app 项 / 非自指锚点不得被投影成长度界", () => {
    const lenTerm = termVar("s");
    const other = makeAbs(
      { k: "prim", type: "string" },
      lenTerm,
      ge(app("get", [lenTerm]), lit(3)),
      "exact",
    );
    expect(denoteGuard(other, "data")).not.toContain("data.length");
    const foreign = makeAbs(
      { k: "prim", type: "string" },
      lenTerm,
      ge(app("length", [termVar("other")]), lit(3)),
      "exact",
    );
    expect(denoteGuard(foreign, "data")).not.toContain("data.length");
  });

  it("负控制：unknown 形状仍恒真（结构义务只对有形状的 Abs 生效）", () => {
    expect(denoteGuard(unknown, "data")).toBe("true");
  });
});
