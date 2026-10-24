/**
 * Bug 270 — `Array.prototype.toSpliced()` 的删除窗口：`skipCount` **缺省**与
 * `skipCount` **显式 undefined** 被混为一谈（`toIOI` 对两者都返回
 * undefined）⇒ `toSpliced()` / `toSpliced(0, undefined)` 把整个数组删空
 * （原生**原样保留**）。
 *
 * 原生规则（ES2023 Array.prototype.toSpliced）：
 * - `toSpliced()` **start 缺省** ⇒ `actualSkipCount = 0`（不删）；
 * - `toSpliced(0)` skipCount 缺省 ⇒ 删到尾；
 * - `toSpliced(0, undefined)` skipCount **在场** ⇒ `ToIntegerOrInfinity(undefined) = 0`
 *   ⇒ 不删。
 *
 * 根修：删除窗口走 `spliceWindow`（arr-methods.ts）——splice / toSpliced 两臂
 * 共用同一实现；`toIOIArg` 提供「缺省 / 显式 undefined / 数值」第三态。
 */
import { describe, it, expect } from "vitest";
import { call } from "./eval-helpers.ts";

const val = (body: string): unknown => {
  const r = call(`export function f() {\n${body}\n}`);
  return (r.result as { term?: { op?: string; value?: unknown } })?.term?.value;
};

describe("Bug 270 · toSpliced 删除窗口（零实参 / 显式 undefined）", () => {
  it("toSpliced() 零实参：原样保留（原生 1,2,3）", () => {
    expect(val(`return [1,2,3].toSpliced().join(",");`)).toBe("1,2,3");
  });

  it("toSpliced(0, undefined)：skipCount 在场（undefined ⇒ 0）⇒ 原样保留", () => {
    expect(val(`return [1,2,3].toSpliced(0, undefined).join(",");`)).toBe("1,2,3");
  });

  it("对照：toSpliced(0) skipCount 缺省 ⇒ 删到尾（原生空）", () => {
    expect(val(`return [1,2,3].toSpliced(0).join(",");`)).toBe("");
  });

  it("对照：toSpliced(1,1) ⇒ 删一个（原生 1,3）", () => {
    expect(val(`return [1,2,3].toSpliced(1, 1).join(",");`)).toBe("1,3");
  });

  it("对照：splice() 零实参 ⇒ 原生不删（被删数组为空）", () => {
    expect(val(`const a=[1,2,3]; return a.splice().join(",");`)).toBe("");
  });

  it("对照：splice(0, undefined) ⇒ deleteCount 在场（0）⇒ 不删（被删数组为空）", () => {
    expect(val(`const a=[1,2,3]; return a.splice(0, undefined).join(",");`)).toBe("");
  });

  it("对照：splice(1) ⇒ deleteCount 缺省 ⇒ 删到尾（被删 2,3）", () => {
    expect(val(`const a=[1,2,3]; return a.splice(1).join(",");`)).toBe("2,3");
  });
});
