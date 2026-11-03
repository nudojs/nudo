/**
 * Array.prototype generic 借用臂 ↔ invokeArrMethod 直达臂互钉（drift-gate）。
 *
 * 同名 mutator 的两条触发路径：
 * 1. **方法面**（直达臂）：`a.push(x)` —— $invoke 按接收者 shape 分派到
 *    invokeArrMethod（arr-methods.ts）；
 * 2. **借用/摘下面**（class/invoke.ts setProtoMethodDispatch home=Array 的
 *    generic 借用臂）：`Array.prototype.push.call(o, x)`、对 Method 值摘下后
 *    `m.call(o, x)`。
 *
 * 互钉口径（固定方法族：push/pop/splice + reverse/fill/copyWithin + concat/with）：
 * - **tuple/arr 接收者**：借用面 recv 是 tuple ⇒ dispatch 落回方法面 ⇒ 两路
 *   必须同门同结果（frozen/sealed 的 TypeError 门 + 结果形态）。任何一条
 *   路径漂移（改 invokeArrMethod 不改借用分派，或反之）⇒ 本钉翻红。
 * - **array-like obj 接收者**：两路都进 invokeArrMethod 的 generic 借用臂
 *   （mutateArrayLike 写面，Bug 243）——钉当前行为。已知与原生的差异
 *   （见各断言注释）：mutateArrayLike 不查 extState ⇒ frozen/sealed 的
 *   array-like 不设门（原生 TypeError）；若未来补门，本钉翻红提醒同步。
 * - **非 array-like 接收者**：concat 种子 [recv]（Bug 262）、with 越界
 *   RangeError（Bug 268）、push 对 string 原始值 TypeError（Bug 259）。
 *
 * 只经公共面触发（runTranspiled + callTranspiledExportFull，eval-helpers），
 * 不 import class/invoke.ts 内部（该文件由兄弟域重构中——本钉跨内部重构
 * 稳定）。
 */
import { describe, it, expect } from "vitest";
import { call, isNever, throwsError, tupleEls } from "./eval-helpers.ts";
import { litValue } from "../abs.ts";

/** 定抛 TypeError 探针（结果 never + throws 面 brand TypeError） */
function hardTypeError(src: string): boolean {
  const r = call(src);
  return isNever(r.result) && throwsError(r.throws, "TypeError");
}

function hardRangeError(src: string): boolean {
  const r = call(src);
  return isNever(r.result) && throwsError(r.throws, "RangeError");
}

/** tuple/arr 接收者上「方法面 vs 借用面」同门互钉的形态对 */
const TUPLE_GATE_PAIRS: readonly [string, string, string][] = [
  ["push", `export function f() { const a = [1, 2]; Object.freeze(a); a.push(9); return a.length; }`,
            `export function f() { const a = [1, 2]; Object.freeze(a); Array.prototype.push.call(a, 9); return a.length; }`],
  ["pop", `export function f() { const a = [1, 2]; Object.freeze(a); return a.pop(); }`,
           `export function f() { const a = [1, 2]; Object.freeze(a); return Array.prototype.pop.call(a); }`],
  ["splice", `export function f() { const a = [1, 2]; Object.seal(a); a.splice(0, 1); return a.length; }`,
              `export function f() { const a = [1, 2]; Object.seal(a); Array.prototype.splice.call(a, 0, 1); return a.length; }`],
  ["reverse", `export function f() { const a = [1, 2]; Object.freeze(a); a.reverse(); return a[0]; }`,
               `export function f() { const a = [1, 2]; Object.freeze(a); Array.prototype.reverse.call(a); return a[0]; }`],
  ["fill", `export function f() { const a = [1, 2]; Object.freeze(a); a.fill(0); return a[0]; }`,
            `export function f() { const a = [1, 2]; Object.freeze(a); Array.prototype.fill.call(a, 0); return a[0]; }`],
  ["copyWithin", `export function f() { const a = [1, 2]; Object.freeze(a); a.copyWithin(0, 1); return a[0]; }`,
                  `export function f() { const a = [1, 2]; Object.freeze(a); Array.prototype.copyWithin.call(a, 0, 1); return a[0]; }`],
];

describe("Array.prototype 借用臂 ↔ invokeArrMethod 直达臂互钉", () => {
  describe("tuple/arr 接收者：方法面 vs 借用面同门（frozen/sealed TypeError）", () => {
    for (const [name, methodFace, borrowFace] of TUPLE_GATE_PAIRS) {
      it(`${name}：两路都定抛 TypeError`, () => {
        expect(hardTypeError(methodFace), `${name} 方法面缺 frozen/sealed 门`).toBe(true);
        expect(hardTypeError(borrowFace), `${name} 借用面（Array.prototype.${name}.call）缺同门`).toBe(true);
      });
    }

    it("splice frozen 同样定抛（sealed 之外的 frozen 变体）", () => {
      expect(hardTypeError(`export function f() { const a = [1, 2]; Object.freeze(a); a.splice(0, 0, 3); return a.length; }`)).toBe(true);
      expect(hardTypeError(`export function f() { const a = [1, 2]; Object.freeze(a); Array.prototype.splice.call(a, 0, 0, 3); return a.length; }`)).toBe(true);
    });

    it("未冻结时两路都成功且结果一致（push/pop 对照）", () => {
      expect(call(`export function f() { const a = [1, 2]; a.push(9); return [a.length, a[2]]; }`).result)
        .toEqual(call(`export function f() { const a = [1, 2]; Array.prototype.push.call(a, 9); return [a.length, a[2]]; }`).result);
      expect(call(`export function f() { const a = [1, 2]; const v = a.pop(); return [v, a.length]; }`).result)
        .toEqual(call(`export function f() { const a = [1, 2]; const v = Array.prototype.pop.call(a); return [v, a.length]; }`).result);
    });
  });

  describe("tuple/arr 接收者：复制族结果形态两路一致", () => {
    it("concat：元素序 [recv…, args…] 两路一致", () => {
      const r1 = call(`export function f() { const a = [1, 2]; return a.concat([3]); }`);
      const r2 = call(`export function f() { const a = [1, 2]; return Array.prototype.concat.call(a, [3]); }`);
      expect(r1.result).toEqual(r2.result);
      expect(JSON.stringify(r1.result)).toContain("3");
    });

    it("with：合法下标两路同形，越界两路同抛 RangeError", () => {
      expect(call(`export function f() { const a = [1, 2]; return a.with(0, 9); }`).result)
        .toEqual(call(`export function f() { const a = [1, 2]; return Array.prototype.with.call(a, 0, 9); }`).result);
      expect(hardRangeError(`export function f() { const a = [1, 2]; return a.with(5, 9); }`)).toBe(true);
      expect(hardRangeError(`export function f() { const a = [1, 2]; return Array.prototype.with.call(a, 5, 9); }`)).toBe(true);
    });
  });

  describe("array-like obj 接收者：generic 借用臂写面（Bug 243 家族）", () => {
    it("push：length 增长 + 新键可读回（借下面 + Method 值摘下面同果）", () => {
      const borrow = `export function f() { const o = { length: 1, 0: "a" }; Array.prototype.push.call(o, "b"); return o.length; }`;
      const detached = `export function f() { const m = Array.prototype.push; const o = { length: 1, 0: "a" }; m.call(o, "b"); return o.length; }`;
      expect(call(borrow).result).toEqual(call(detached).result);
      expect(call(`export function f() { const o = { length: 1, 0: "a" }; Array.prototype.push.call(o, "b"); return o[1]; }`).result)
        .toEqual(call(`export function f() { const o = { length: 1, 0: "a" }; Array.prototype.push.call(o, "b", "c"); return o[1]; }`).result);
    });

    it("pop：返回末元素 + length 收缩", () => {
      const popped = call(`export function f() { const o = { length: 2, 0: "a", 1: "b" }; return Array.prototype.pop.call(o); }`);
      expect(litValue(popped.result)).toEqual({ ok: true, value: "b" });
      const len = call(`export function f() { const o = { length: 2, 0: "a", 1: "b" }; Array.prototype.pop.call(o); return o.length; }`);
      expect(litValue(len.result)).toEqual({ ok: true, value: 1 });
    });

    it("splice：返回被删元素 + 移位后首键", () => {
      const removed = call(`export function f() { const o = { length: 3, 0: "a", 1: "b", 2: "c" }; const r = Array.prototype.splice.call(o, 0, 1); return r[0]; }`);
      expect(litValue(removed.result)).toEqual({ ok: true, value: "a" });
      const after = call(`export function f() { const o = { length: 3, 0: "a", 1: "b", 2: "c" }; Array.prototype.splice.call(o, 0, 1); return [o.length, o[0]]; }`);
      // o.length 读带 pred {true}（非纯 lit）——tupleEls 按元素抽取
      expect(tupleEls(after.result)).toEqual([2, "b"]);
    });

    it("reverse/fill/copyWithin：写面落回接收者", () => {
      expect(call(`export function f() { const o = { length: 2, 0: "a", 1: "b" }; Array.prototype.reverse.call(o); return o[0]; }`).result)
        .toEqual(call(`export function f() { return "b"; }`).result);
      expect(call(`export function f() { const o = { length: 3, 0: "a", 1: "b", 2: "c" }; Array.prototype.fill.call(o, "x", 1); return o[1]; }`).result)
        .toEqual(call(`export function f() { return "x"; }`).result);
      expect(call(`export function f() { const o = { length: 3, 0: "a", 1: "b", 2: "c" }; Array.prototype.copyWithin.call(o, 0, 1); return o[0]; }`).result)
        .toEqual(call(`export function f() { return "b"; }`).result);
    });

    it("frozen/sealed 的 array-like：generic 借用臂与直达臂同门（TypeError）", () => {
      // 完整性门已上提到 $arrMutContainer 的 shape 分派前（原口径：obj 接收者
      // 走 mutateArrayLike 写面不查 extState ⇒ frozen array-like 的 push 静默
      // 成功，原生定抛 TypeError——假绿）。原生语义（node）：frozen/sealed
      // array-like 上的结构性扩展 mutator 定抛。
      expect(hardTypeError(`export function f() { const o = { length: 1, 0: "a" }; Object.freeze(o); Array.prototype.push.call(o, "b"); return o.length; }`)).toBe(true);
      expect(hardTypeError(`export function f() { const o = { length: 1, 0: "a" }; Object.seal(o); Array.prototype.push.call(o, "b"); return o.length; }`)).toBe(true);
      expect(hardTypeError(`export function f() { const o = { length: 2, 0: "a", 1: "b" }; Object.freeze(o); Array.prototype.reverse.call(o); return o[0]; }`)).toBe(true);
    });

    it("sealed array-like 的 pop/shift：Bug 223 own-槽分析与 tuple 臂同口径", () => {
      // pop 删末元素：末槽存在（自有属性）⇒ 抛；空 array-like ⇒ 不抛。
      expect(hardTypeError(`export function f() { const o = { length: 2, 0: "a", 1: "b" }; Object.seal(o); return Array.prototype.pop.call(o); }`)).toBe(true);
      expect(hardTypeError(`export function f() { const o = { length: 0 }; Object.seal(o); return Array.prototype.pop.call(o); }`)).toBe(false);
      // shift：任一自有索引 ⇒ 抛。
      expect(hardTypeError(`export function f() { const o = { length: 2, 1: "b" }; Object.seal(o); return Array.prototype.shift.call(o); }`)).toBe(true);
    });

    it("with：array-like 接收者同走 copy 族（合法下标成功）", () => {
      expect(call(`export function f() { const o = { length: 2, 0: "a", 1: "b" }; return Array.prototype.with.call(o, 0, "z")[0]; }`).result)
        .toEqual(call(`export function f() { return "z"; }`).result);
    });
  });

  describe("非 array-like 接收者（brand/原始值）分派", () => {
    it("concat：非 array-exotic 接收者当单元素种子（Bug 262）", () => {
      const r = call(`export function f() { const o = { length: 1 }; return Array.prototype.concat.call(o, 1); }`);
      expect(JSON.stringify(r.result)).toContain("length");
    });

    it("concat：string 原始值接收者当单元素（非字符拆分）", () => {
      const r = call(`export function f() { return Array.prototype.concat.call("ab"); }`);
      expect(JSON.stringify(r.result)).toContain("ab");
    });

    it("with：原始值数字接收者越界定抛 RangeError（Bug 268 口径）", () => {
      expect(hardRangeError(`export function f() { return Array.prototype.with.call(1, 0, 2); }`)).toBe(true);
    });

    it("push：string 原始值接收者定抛 TypeError（Bug 259）；number 接收者按 length 键路径成功", () => {
      expect(hardTypeError(`export function f() { return Array.prototype.push.call("ab", 1); }`)).toBe(true);
      const r = call(`export function f() { return Array.prototype.push.call(5, 1); }`);
      expect(isNever(r.result)).toBe(false);
    });
  });
});
