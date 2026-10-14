/**
 * 差分门 unmask 后暴露的五类 wrong-definite（native 抛、引擎折值且
 * throws=never）——本文件为对应修复的永久回归：
 * - M1 null-proto 对象字符串拼接：无 toString/valueOf/@@toPrimitive 可回退
 *   → ToPrimitive 定抛 TypeError（此前折出定值字符串）；
 * - M2 自由 arguments（模块顶层，无函数边界）→ 定抛 ReferenceError；
 *   typeof 自由 arguments → "undefined"（对不可解析引用 typeof 不抛）；
 * - M3 bigint prim 缺失方法调用（方法集封闭：toString/toLocaleString/
 *   valueOf + Object.prototype 名）→ 定抛 TypeError（属性读不抛）；
 * - M4 sort 比较器抛错：effectFree facet（transpile 保守静态判定）回调
 *   真执行——全对抛 → 定抛；副作用回调不执行（多执行不可回滚）；
 *   一致比较器（反对称+传递）稳定插入排序精确折叠；
 * - M5 Object.assign 装箱 prim target：string 字面量下标键 < length →
 *   String wrapper 下标只读 → 定抛；bigint 恒抛；安全 string 源折原始串。
 */
import { describe, it, expect } from "vitest";
// 相对路径引 src（eval-helpers 口径：@nudojs/core 别名在 vitest 下落 dist）
import { litValue } from "../abs.ts";
import { $lit } from "../exec/runtime/state.ts";
import { call, isNever, throwsError } from "./eval-helpers.ts";

const numLit = (n: number) => $lit(n as never);

describe("M1 null-proto object string coercion throws", () => {
  it("concat '' + o (no coercer slots) is a definite TypeError", () => {
    const r = call(`export function f() { const o = Object.create(null); return '' + o; }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("template literal interpolation throws the same way", () => {
    const r = call(`export function f() { const o = Object.create(null); return \`\${o}x\`; }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("String() conversion of null-proto object throws", () => {
    const r = call(`export function f() { const o = Object.create(null); return String(o); }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("own coercer slots keep no-throw (degradation, not false throw)", () => {
    // 用户 coercer 无法内联精折（fn 槽）→ 降级 unknown，但绝不假抛
    const r = call(`export function f() { const o = Object.create(null); o.toString = () => 'own'; return '' + o; }`);
    expect(isNever(r.result)).toBe(false);
  });

  it("normal objects keep exact folding", () => {
    expect(litValue(call(`export function f() { return '' + {a: 1}; }`).result)).toEqual({
      ok: true,
      value: "[object Object]",
    });
  });

  it("try/catch absorbs the throw", () => {
    expect(
      litValue(
        call(`export function f() { try { return '' + Object.create(null); } catch (e) { return 'caught'; } }`).result,
      ),
    ).toEqual({ ok: true, value: "caught" });
  });
});

describe("M2 free arguments (module top level) throws ReferenceError", () => {
  it("arrow reads the enclosing non-arrow binding precisely (call-site args, not arrow's)", () => {
    expect(litValue(call(`export function f() { const g = () => arguments.length; return g(1, 2); }`).result)).toEqual(
      { ok: true, value: 0 },
    );
    const r = call(`export function f(a, b) { const g = () => arguments.length; return g(9, 9, 9); }`, "f", [
      numLit(1),
      numLit(2),
    ]);
    expect(litValue(r.result)).toEqual({ ok: true, value: 2 });
  });

  it("typeof arguments on the bound slot folds object", () => {
    expect(
      litValue(
        call(`export function f() { const g = () => typeof arguments === 'object'; return g(); }`).result,
      ),
    ).toEqual({ ok: true, value: true });
  });
});

describe("M3 bigint prim missing method call throws TypeError", () => {
  it("(5n).toFixed is a definite TypeError", () => {
    const r = call(`export function f() { return (5n).toFixed(1); }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("arbitrary missing bigint methods throw too", () => {
    const r = call(`export function f() { return (5n).foo(); }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("property read stays unknown (no throw)", () => {
    const r = call(`export function f() { return (5n).foo; }`);
    expect(isNever(r.result)).toBe(false);
  });

  it("real BigInt.prototype methods keep folding", () => {
    expect(litValue(call(`export function f() { return (5n).toLocaleString(); }`).result)).toEqual({
      ok: true,
      value: "5",
    });
    expect(litValue(call(`export function f() { return (255n).toString(16); }`).result)).toEqual({
      ok: true,
      value: "ff",
    });
  });

  it("number/string unknown methods keep degrading (no false throw)", () => {
    expect(isNever(call(`export function f() { return (5).nope(1); }`).result)).toBe(false);
    expect(isNever(call(`export function f() { return 'ab'.nope(1); }`).result)).toBe(false);
  });
});

describe("M4 sort comparator throw domain", () => {
  it("all-pairs throwing comparator is a definite throw", () => {
    const r = call(`export function f() { return [1, 2].sort(() => { throw new Error('cmp'); }); }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "Error")).toBe(true);
  });

  it("single comparable element never invokes the comparator (no throw)", () => {
    expect(isNever(call(`export function f() { return [1].sort(() => { throw new Error('x'); }); }`).result)).toBe(false);
    expect(isNever(call(`export function f() { return [undefined, 1].sort(() => { throw new Error('x'); }); }`).result)).toBe(false);
  });

  it("consistent comparators fold exact stable order", () => {
    expect(litValue(call(`export function f() { return [3, 1, 2].sort((a, b) => a - b).join(','); }`).result)).toEqual(
      { ok: true, value: "1,2,3" },
    );
    expect(litValue(call(`export function f() { return [3, 1, 2].sort((a, b) => b - a).join(','); }`).result)).toEqual(
      { ok: true, value: "3,2,1" },
    );
    expect(litValue(call(`export function f() { return [1, 2, 3].sort(() => 0).join(','); }`).result)).toEqual({
      ok: true,
      value: "1,2,3",
    });
    expect(litValue(call(`export function f() { return [3, 1, 2].sort((a, b) => NaN).join(','); }`).result)).toEqual({
      ok: true,
      value: "3,1,2",
    });
  });

  it("stable order for equal keys (obj comparators)", () => {
    expect(
      litValue(
        call(
          `export function f() { const o = [{v:2,i:0},{v:1,i:1},{v:2,i:2},{v:0,i:3}]; return o.sort((a,b)=>a.v-b.v).map(x=>x.i).join(','); }`,
        ).result,
      ),
    ).toEqual({ ok: true, value: "3,1,0,2" });
  });

  it("inconsistent comparators degrade instead of wrong-folding", () => {
    expect(litValue(call(`export function f() { return [3, 2, 1].sort((a, b) => 1).join(','); }`).result).ok).toBe(false);
    expect(litValue(call(`export function f() { return [1, 2, 3].sort((a, b) => -1).join(','); }`).result).ok).toBe(false);
  });

  it("side-effectful comparators are not executed", () => {
    // n++ / push 是副作用面（effectFree facet false）——引擎不执行比较器
    expect(litValue(call(`export function f() { let n = 0; [3, 1, 2].sort((a, b) => { n++; return a - b; }); return n; }`).result)).toEqual(
      { ok: true, value: 0 },
    );
  });

  it("conditional-throw comparator degrades (no false definite throw)", () => {
    expect(isNever(call(`export function f() { return [1, 2].sort((a, b) => (a === 1 && b === 2) ? Symbol() : 0); }`).result)).toBe(false);
    expect(isNever(call(`export function f() { return [1, 2].sort((a, b) => { if (a === 1) { throw new Error('x'); } return 0; }); }`).result)).toBe(false);
  });
});

describe("M5 Object.assign boxed prim target throw domain", () => {
  it("in-range index source key on string target throws TypeError", () => {
    const r = call(`export function f() { return Object.assign('ab', {0: 'x'}); }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("later source with in-range index still throws", () => {
    const r = call(`export function f() { return Object.assign('ab', {a: 1}, {0: 'x'}); }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("array and string sources with index 0 throw", () => {
    for (const src of ["['x', 'y']", "'cd'"]) {
      const r = call(`export function f() { return Object.assign('ab', ${src}); }`);
      expect(isNever(r.result), src).toBe(true);
      expect(throwsError(r.throws, "TypeError"), src).toBe(true);
    }
  });

  it("bigint target always throws (even without sources)", () => {
    expect(isNever(call(`export function f() { return Object.assign(1n); }`).result)).toBe(true);
    expect(isNever(call(`export function f() { return Object.assign(1n, {a: 1}); }`).result)).toBe(true);
  });

  it("out-of-range index / non-index keys keep the primitive (exact)", () => {
    expect(litValue(call(`export function f() { return Object.assign('ab', {5: 'x'}); }`).result)).toEqual({
      ok: true,
      value: "ab",
    });
    expect(litValue(call(`export function f() { return Object.assign('ab', {a: 1}); }`).result)).toEqual({
      ok: true,
      value: "ab",
    });
    expect(litValue(call(`export function f() { return Object.assign('ab'); }`).result)).toEqual({
      ok: true,
      value: "ab",
    });
    expect(litValue(call(`export function f() { return Object.assign(''); }`).result)).toEqual({
      ok: true,
      value: "",
    });
  });

  it("number/boolean targets with sources degrade (native returns wrapper)", () => {
    expect(litValue(call(`export function f() { return Object.assign(5, {a: 1}); }`).result).ok).toBe(false);
    expect(litValue(call(`export function f() { return Object.assign(true, {a: 1}); }`).result).ok).toBe(false);
  });

  it("object targets keep exact merge", () => {
    expect(litValue(call(`export function f() { return Object.assign({a: 1}, {b: 2}).b; }`).result)).toEqual({
      ok: true,
      value: 2,
    });
  });
});
