/**
 * 可选链与非可选链的发射一致性回归。
 *
 * 旧的可选链路径自己维护了一套实参/成员键发射：
 * - spread 折成 `$unknown()`（实参个数错误）；
 * - 实参先于成员读求值（非链路径已用 thunk 修过 Bug 152）；
 * - 计算键漏 `Symbol.X → "@@X"` 投影；
 * - 语句级 delete 又补了一次写回（计算键二次求值）。
 * 本文件钉住四条与原生一致的语义。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull } from "../run.ts";
import { litValue } from "../../abs.ts";

function runF(src: string) {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, "f", []);
}

function val(src: string) {
  return litValue(runF(src).result);
}

describe("optional-chain parity", () => {
  it("evaluates the member read before the call arguments", () => {
    const src = `
      function f() {
        const log = [];
        const o = { get m() { log.push("get"); return (...a) => a.length; } };
        o?.m(log.push("arg"));
        return log.join(",");
      }
      export { f };
    `;
    expect(val(src)).toEqual({ ok: true, value: "get,arg" });
  });

  it("expands spread arguments on an optional invoke", () => {
    const src = `
      function f() {
        const xs = [1, 2, 3];
        const o = { m: (...a) => a.length };
        return o?.m(...xs);
      }
      export { f };
    `;
    expect(val(src)).toEqual({ ok: true, value: 3 });
  });

  it("expands spread arguments on an optional call", () => {
    const src = `
      function f() {
        const xs = [1, 2, 3];
        const g = (...a) => a.length;
        return g?.(...xs);
      }
      export { f };
    `;
    expect(val(src)).toEqual({ ok: true, value: 3 });
  });

  it("projects well-known Symbol keys in a computed optional chain", () => {
    const src = `
      function f() {
        const m = new Map([["a", 1]]);
        return typeof m?.[Symbol.iterator];
      }
      export { f };
    `;
    expect(val(src)).toEqual({ ok: true, value: "function" });
  });

  it("evaluates a computed delete key exactly once", () => {
    const src = `
      function f() {
        let n = 0;
        const o = { a: 1 };
        const k = () => { n++; return "a"; };
        delete o?.[k()];
        return n;
      }
      export { f };
    `;
    expect(val(src)).toEqual({ ok: true, value: 1 });
  });

  it("writes the deleted optional member back to its binding", () => {
    const src = `
      function f() {
        const o = { a: 1 };
        delete o?.a;
        return o.a;
      }
      export { f };
    `;
    expect(val(src)).toEqual({ ok: true });
  });

  it("writes an optional delete through an intermediate member path", () => {
    const src = `
      function f() {
        const o = { inner: { a: 1 } };
        delete o.inner?.a;
        return o.inner.a;
      }
      export { f };
    `;
    expect(val(src)).toEqual({ ok: true });
  });
});
