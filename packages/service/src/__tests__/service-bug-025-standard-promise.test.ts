/**
 * BUG-025 —— `nudo export --format standard` 的 `promise` 分支**放行一切**
 * ⇒ 非 Promise 值被校验器接受，而同一份 Abs 的 zod 面（`z.promise`）与 guard
 * 面（`data instanceof Promise`）都拒绝 ⇒ 同一 Abs 在两个方言里给出相反裁决。
 *
 * 根因：`standard-schema.ts` 的 `case "promise": return;` 把「不展开 thenable」
 * 误实现成「不做任何检查」（库函数版与内联进产物的拷贝各一处）。
 *
 * 本钉：promise 节点必须判「是不是 Promise」（值域不展开，但类型判据在）。
 */
import { describe, it, expect } from "vitest";
import { validateSchemaNode, type SchemaNode } from "../emit/standard-schema.ts";

const promiseNode: SchemaNode = { k: "promise", inner: { k: "unknown" } };

describe("BUG-025 — standard 方言的 promise 节点不再放行一切", () => {
  it("非 Promise 值被拒绝（42 / 'str' / {}）", () => {
    for (const bad of [42, "str", {}, null, undefined]) {
      const r = validateSchemaNode(promiseNode, bad);
      expect("issues" in r && r.issues.length > 0).toBe(true);
    }
  });

  it("Promise 与 thenable 的判据与 zod 面同口径（真 Promise 放行）", () => {
    const r = validateSchemaNode(promiseNode, Promise.resolve(1));
    expect("issues" in r).toBe(false);
  });

  it("负控制：unknown 节点仍放行一切（不把 promise 的收窄扩散）", () => {
    const r = validateSchemaNode({ k: "unknown" }, 42);
    expect("issues" in r).toBe(false);
  });
});
