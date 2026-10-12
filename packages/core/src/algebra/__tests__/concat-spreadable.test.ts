/**
 * Bug 83：Array.prototype.concat 的 Symbol.isConcatSpreadable 语义。
 * native 对每个实参先查 o[Symbol.isConcatSpreadable]（计算符号键投影槽
 * "@@isConcatSpreadable"，只有 obj / brand inner 槽面可携带）：
 * - lit true（ToBoolean）→ 按 array-like 展开（length 槽 ToLength +
 *   逐位 String(i) 索引槽，缺席位 native Get 得 undefined）
 * - lit false → 单元素追加
 * - 槽缺席 → 默认：tuple/arr 展开、其余单元素
 * - 槽抽象 / length 非字面量 → 展开性未知 → 整体降 arr（sound）
 *
 * 已知不可表达子面：tuple 实参的抑制展开——tuple shape 无 slots 字段，
 * `a[Symbol.isConcatSpreadable] = false` 经 $set 非索引键写直接降级 arr
 * （widenTupleToArr），见 class.ts concat 臂注释。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue } from "../index.ts";

/** 隐式 return 语句体 → __run 包装 → exec 求值（同 differential/harness.ts 口径） */
function evalExec(body: string): unknown {
  const exports = runTranspiled(`export function __run() {\n${body}\n}`, {
    mode: "exec",
    maxLoopIters: 2000,
  });
  const full = callTranspiledExportFull(exports, "__run", []);
  const lvR = litValue(full.result as never);
  return lvR.ok ? lvR.value : undefined;
}

/** 带抽象实参的调用（raw Abs 传参，同 array-proto-method-read.test.ts 口径） */
function callWith(src: string, args: unknown[]) {
  const exports = runTranspiled(src, { mode: "exec", maxLoopIters: 2000 });
  return callTranspiledExportFull(exports, "f", args as never);
}

describe("Array.prototype.concat @@isConcatSpreadable (Bug 83)", () => {
  it("spreadable obj without length spreads zero elements", () => {
    expect(
      evalExec(`const o = { [Symbol.isConcatSpreadable]: true }; return [].concat(o).length;`),
    ).toBe(0);
  });

  it("spreadable array-like spreads indexed slots", () => {
    expect(
      evalExec(
        `const o = { length: 2, 0: "a", 1: "b", [Symbol.isConcatSpreadable]: true };` +
          ` const r = [].concat(o); return r.length + ":" + r.join(",");`,
      ),
    ).toBe("2:a,b");
  });

  it("lit false suppresses spreading: single element even with length/indexes", () => {
    expect(
      evalExec(
        `return [].concat({ length: 2, 0: "a", 1: "b", [Symbol.isConcatSpreadable]: false }).length;`,
      ),
    ).toBe(1);
  });

  it("absent index slots spread as undefined elements (native Get)", () => {
    expect(
      evalExec(
        `return [].concat({ length: 3, 1: "x", [Symbol.isConcatSpreadable]: true }).join(",");`,
      ),
    ).toBe(",x,");
  });

  it("length follows ToLength: truncate fraction, clamp negative/NaN to 0, undefined → 0", () => {
    expect(
      evalExec(
        `return [].concat({ length: 2.7, 0: "a", 1: "b", [Symbol.isConcatSpreadable]: true }).length;`,
      ),
    ).toBe(2);
    expect(
      evalExec(
        `return [].concat({ length: -1, 0: "a", [Symbol.isConcatSpreadable]: true }).length;`,
      ),
    ).toBe(0);
    expect(
      evalExec(
        `return [].concat({ length: NaN, 0: "a", [Symbol.isConcatSpreadable]: true }).length;`,
      ),
    ).toBe(0);
    expect(
      evalExec(
        `return [].concat({ length: undefined, 0: "a", [Symbol.isConcatSpreadable]: true }).length;`,
      ),
    ).toBe(0);
  });

  it("slot value goes through ToBoolean: 1 → spread, \"\" → suppress", () => {
    expect(
      evalExec(`return [].concat({ length: 1, 0: "a", [Symbol.isConcatSpreadable]: 1 }).length;`),
    ).toBe(1);
    expect(
      evalExec(
        `return [].concat({ length: 1, 0: "a", [Symbol.isConcatSpreadable]: "" }).length;`,
      ),
    ).toBe(1);
  });

  it("arr receiver joins spread elements the same way", () => {
    expect(
      evalExec(`return [7].concat({ length: 1, 0: "a", [Symbol.isConcatSpreadable]: true }).join(",");`),
    ).toBe("7,a");
    expect(
      evalExec(`return [7].concat({ length: 1, 0: "a", [Symbol.isConcatSpreadable]: false }).length;`),
    ).toBe(2);
  });

  it("abstract slot value degrades to arr (sound), not a false concrete", () => {
    const r = callWith(`export function f(o) { return [].concat(o); }`, [
      {
        shape: {
          k: "obj",
          slots: {
            length: { value: { shape: { k: "prim", type: "number" }, conf: "path" } },
            "0": {
              value: {
                shape: { k: "prim", type: "string" },
                term: { op: "lit", value: "a" },
                conf: "exact",
              },
            },
            "@@isConcatSpreadable": {
              value: { shape: { k: "prim", type: "boolean" }, conf: "path" },
            },
          },
        },
        conf: "exact",
      } as never,
    ]);
    expect(r.result.shape.k).toBe("arr");
    expect(litValue(r.result).ok).toBe(false);
  });

  it("abstract length with lit-true slot degrades to arr (sound)", () => {
    const r = callWith(`export function f(o) { return [].concat(o); }`, [
      {
        shape: {
          k: "obj",
          slots: {
            length: { value: { shape: { k: "prim", type: "number" }, conf: "path" } },
            "@@isConcatSpreadable": {
              value: {
                shape: { k: "prim", type: "boolean" },
                term: { op: "lit", value: true },
                conf: "exact",
              },
            },
          },
        },
        conf: "exact",
      } as never,
    ]);
    expect(r.result.shape.k).toBe("arr");
    expect(litValue(r.result).ok).toBe(false);
  });

  it("tuple suppression is not expressible: symbol write widens tuple to arr (accepted approximation)", () => {
    // native 结果 [a] 长 1；引擎里 a[Symbol.isConcatSpreadable] = false 走
    // $set 非索引键写 → widenTupleToArr，concat 降 arr、长度非具体——
    // 不可表达子面，非具体即 sound。
    const r = evalExec(
      `const a = [1, 2]; a[Symbol.isConcatSpreadable] = false; return [].concat(a).length;`,
    );
    expect(r).toBeUndefined();
  });

  describe("regressions (Bug 66 default behavior preserved)", () => {
    it("array args still spread by default", () => {
      expect(evalExec(`return [].concat([1,2],[3]).join(",");`)).toBe("1,2,3");
    });

    it("plain object stays single element", () => {
      expect(evalExec(`return [].concat({}).length;`)).toBe(1);
    });

    it("string arg is not spread", () => {
      expect(evalExec(`return [].concat("ab").length;`)).toBe(1);
    });
  });
});
