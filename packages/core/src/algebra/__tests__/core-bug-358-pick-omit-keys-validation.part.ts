/**
 * Bug 358 —— `pick()` / `omit()` 的 `keys` 实参**零类型校验**：
 * 字符串可迭代 ⇒ `for…of` / `new Set(keys)` 把它当字符列表逐字迭代。
 * 同一笔误（`"id"` 应为 `["id"]`）在 `pick` 上把契约**放松成空**（假绿），
 * 在 `omit` 上让约束**变更严**（假红），两向都错且零诊断。
 *
 * 修法（core/algebra/constraint.ts）：`pick` / `omit` 运行时校验 `keys`
 * 必须是**字符串数组**，否则抛一条可读的 DSL 错误（不是宿主的
 * "is not iterable" TypeError）。
 */
import { describe, it, expect } from "vitest";
import { number, omit, pick, shape } from "../constraint.ts";

describe("Bug 358：pick / omit 的 keys 必须是字符串数组", () => {
  it("pick 收到字符串 → 报错点名（不再逐字符迭代放松成空契约）", () => {
    expect(() => pick(shape({ id: number() }), "id" as never)).toThrow(
      /keys must be an array of strings/,
    );
  });

  it("omit 收到字符串 → 报错点名（不再逐字符迭代让约束变更严）", () => {
    expect(() => omit(shape({ id: number() }), "id" as never)).toThrow(
      /keys must be an array of strings/,
    );
  });

  it("keys 数组里混入非字符串 → 报错点名", () => {
    expect(() => pick(shape({ id: number() }), [42] as never)).toThrow(
      /keys must be an array of strings/,
    );
    expect(() => omit(shape({ id: number() }), [42] as never)).toThrow(
      /keys must be an array of strings/,
    );
  });

  it("keys 收到非数组（非字符串）→ 报错点名", () => {
    expect(() => pick(shape({ id: number() }), 42 as never)).toThrow(
      /keys must be an array of strings/,
    );
  });

  it("合法数组形态照旧：pick 取子形状、omit 去字段", () => {
    const picked = pick(shape({ id: number(), name: number() }), ["id"]);
    expect(Object.keys(picked.fields ?? {})).toEqual(["id"]);
    const omitted = omit(shape({ id: number(), name: number() }), ["id"]);
    expect(Object.keys(omitted.fields ?? {})).toEqual(["name"]);
  });
});
