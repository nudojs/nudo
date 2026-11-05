/**
 * A2 残余 · 类构造器作 `JSON.stringify` replacer 从 `may-throw` 升为**定抛**。
 *
 * 台账 `architecture-debt.md` A2 的残余口径：运行时裸调用定抛已由 Bug 272
 * 闭合，但 `builtins/json.ts::brandCallable` 靠 `class-mark` WeakMap 只记
 * `recordMayThrow` ⇒ sound 但非确定抛（L2 假红）。本批次改读
 * `facets.callable === false`（随值搬运，覆盖快照 / subst / harvest 回放）。
 *
 * 类名唯一：类注册表按名进程级驻留。
 */
import { describe, it, expect } from "vitest";
import { call, effects, isNever, throwsError } from "./eval-helpers.ts";

const wrap = (body: string) =>
  `class A2JsonReplacerZ {}\nexport function f() { ${body} }`;

describe("A2 残余 · 类值作 replacer 确定抛 TypeError", () => {
  it("用户 class 值作 replacer ⇒ result never + throws TypeError", () => {
    const r = call(wrap(`return JSON.stringify({ a: 1 }, A2JsonReplacerZ);`), "f");
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("不再记 may-throw（旧口径 = recordMayThrow + partial string）", () => {
    expect(effects(wrap(`return JSON.stringify({ a: 1 }, A2JsonReplacerZ);`))).not.toContain(
      "Error",
    );
  });

  it("负控：类实例 / 普通函数作 replacer 不定抛", () => {
    const inst = call(wrap(`return JSON.stringify({ a: 1 }, new A2JsonReplacerZ());`), "f");
    expect(isNever(inst.result)).toBe(false);
    expect(throwsError(inst.throws, "TypeError")).toBe(false);
    const plain = call(
      wrap(`return JSON.stringify({ a: 1 }, function () { return 1; });`),
      "f",
    );
    expect(isNever(plain.result)).toBe(false);
  });
});
