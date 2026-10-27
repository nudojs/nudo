/**
 * 快照身份图（$copy memo）与直接 const 别名回归。
 *
 * 旧实现按绑定逐个深拷贝：`const b = a` 在 fork/循环出口后断开别名；
 * 自引用容器（`o.self = o`）在快照时无限递归，RangeError 被调用边界记成
 * 用户 throws（L2 假红）。本文件钉住：
 * - fork 后别名读写一致、`a === b` 保持 true；
 * - 循环 pack/unpack 后别名一致；
 * - 调用边界 `f(obj, obj)` 保持同一副本；
 * - `o.self = o` 快照不抛；
 * - 共享身份图只复制一次（副本内部自引用仍指向副本自身）。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull } from "../run.ts";
import { $lit } from "../runtime/state.ts";
import { litValue } from "../../abs.ts";

function runF(src: string, args: unknown[] = []) {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, "f", args as never);
}

function val(src: string, args: unknown[] = []) {
  const r = runF(src, args);
  return litValue(r.result);
}

describe("$copy identity graph", () => {
  it("keeps direct const aliases across an if snapshot", () => {
    const src = `
      function f(c) {
        const a = { x: 0 };
        const b = a;
        if (c) { a.x = 5; }
        return b.x;
      }
      export { f };
    `;
    expect(val(src, [$lit(true)])).toEqual({ ok: true, value: 5 });
  });

  it("keeps direct const aliases after a loop pack/unpack", () => {
    const src = `
      function f(n) {
        const a = { x: 0 };
        const b = a;
        for (let i = 0; i < n; i++) { a.x = a.x + 1; }
        a.x = 99;
        return b.x;
      }
      export { f };
    `;
    expect(val(src, [$lit(3)])).toEqual({ ok: true, value: 99 });
  });

  it("keeps aliases when the arm writes and reads through the partner", () => {
    const src = `
      function f(c) {
        const a = { x: 0 };
        const b = a;
        if (c) { a.x = 5; return b.x; }
        return b.x;
      }
      export { f };
    `;
    expect(val(src, [$lit(true)])).toEqual({ ok: true, value: 5 });
  });

  it("keeps strict identity across a fork", () => {
    const src = `
      function f(c) {
        const a = { x: 0 };
        const b = a;
        if (c) { a.x = 2; }
        return a === b;
      }
      export { f };
    `;
    expect(val(src, [$lit(true)])).toEqual({ ok: true, value: true });
  });

  it("keeps alias identity between call arguments", () => {
    const src = `
      function f(p, q) { p.x = 2; return q.x; }
      export { f };
    `;
    const obj = {
      shape: { k: "obj", slots: { x: { value: $lit(1) } } },
      conf: "exact",
    };
    expect(val(src, [obj, obj])).toEqual({ ok: true, value: 2 });
  });

  it("does not overflow on a self-referential object snapshot", () => {
    const src = `
      function f(c) {
        const o = {};
        o.self = o;
        if (c) { o.x = 1; }
        return 1;
      }
      export { f };
    `;
    const r = runF(src, [$lit(true)]);
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
    expect(r.throws.shape.k).toBe("never");
  });
});
