/**
 * Bug 412 —— 返回 inlay 把**内部 term id**（`len#N`）当返回类型上屏。
 *
 * 改前：`formatReturnDisplay` 的 term 渲染路径直接吐 `termToString` 的内部串
 * ⇒ `len#N`（`exec/runtime/containers/arr-index.ts` 的**模块级自增**计数器
 * `lenVarSeq` 铸造）出现在 IDE 提示里：
 *
 *   : len#0  · derived
 *
 * 而同一份源码的 hover / `nudo check` 面给的是 `number` ⇒ 三个面口径矛盾。
 *
 * 改后：内部 id 统一映射成**稳定可读**标识 `len`：
 *
 *   : len  · derived
 *
 * ⚠ 勘误（按实测）：报告称「同一份源码每次给出不同编号」——**不成立**：
 * `generalizeFromAst` 有源码级 memo ⇒ 完全相同的源码命中缓存、编号**稳定**；
 * 只有**缓存未命中**（源码改动 / 依赖指纹变化）才递增。
 * ⇒ 本钉断言「提示文本不得含内部 id」+「同一份源码多次调用文本逐字相同」，
 * **不**断言「同源码必漂移」。
 */
import { describe, it, expect } from "vitest";
import { collectAbsInlays } from "../inlay.ts";

const retLabel = (src: string): string => {
  const inlays = collectAbsInlays(src, { fromFile: "/t/a.js" });
  const ret = inlays.find((i) => i.kind === "type");
  expect(ret).toBeDefined();
  return ret!.label;
};

const LEN_SRC = `export function restLen(...xs) {\n  return xs.length;\n}`;

describe("Bug 412：返回 inlay 不得上屏内部 term id", () => {
  it("提示文本不含 `len#N` 这类内部 id", () => {
    const label = retLabel(LEN_SRC);
    expect(label).not.toMatch(/len#/);
    // 通用口径：任何 `<小写词>#<数字>` 形态的内部 id 都不许出现
    expect(label).not.toMatch(/[a-z]+#\d+/);
  });

  it("内部 id 换成稳定可读标识 `len`", () => {
    const label = retLabel(LEN_SRC);
    expect(label).toContain(": len");
    expect(label).not.toContain("len#");
  });

  it("同一份源码多次调用：提示文本逐字相同（稳定）", () => {
    const a = retLabel(LEN_SRC);
    const b = retLabel(LEN_SRC);
    const c = retLabel(LEN_SRC);
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("缓存未命中（源码改动 ⇒ 计数器递增）时也不泄漏内部 id", () => {
    // 另一份源码 ⇒ `lenVarSeq` 递增（改前会给出 `len#1` / `len#2` …）
    const other = `export function otherLen(...ys) {\n  return ys.length;\n}`;
    const first = retLabel(LEN_SRC);
    const second = retLabel(other);
    expect(second).not.toMatch(/len#/);
    expect(second).toContain(": len");
    // 两份不同源码给出**逐字相同**的可读标识（不随内部计数器漂移）
    expect(second).toBe(first);
  });
});
