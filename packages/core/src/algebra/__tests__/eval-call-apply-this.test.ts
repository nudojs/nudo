/**
 * Function.prototype.call/apply/bind 的 thisArg 被丢弃：
 * 求值引擎函数体 this 恒折 undefined，g.call(5) 里 typeof this 折 "undefined"
 * （原生 strict 下 this === 5 → "number"）；bind 的 bound this 同样丢失。
 * 修复：函数体含 this 时用宿主 this（$rawThis）注入，
 * call/apply/bind 把 thisArg 作为宿主 this 传递。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";
import { runTranspiled, callTranspiledExportFull, setEvalCallCollector, type EvalCallRecord } from "../index.ts";

describe("evaluator call/apply/bind thisArg", () => {
  it("call passes primitive thisArg (strict: no boxing)", () => {
    const g = "function g(){ return typeof this; }";
    expect(litValue(call(`export function f() { ${g} return g.call(5); }`).result)).toEqual({ ok: true, value: "number" });
    expect(litValue(call(`export function f() { ${g} return g.call("x"); }`).result)).toEqual({ ok: true, value: "string" });
    expect(litValue(call(`export function f() { ${g} return g.call(true); }`).result)).toEqual({ ok: true, value: "boolean" });
    expect(litValue(call(`export function f() { ${g} return g.call(null); }`).result)).toEqual({ ok: true, value: "object" });
    expect(litValue(call(`export function f() { ${g} return g.call(undefined); }`).result)).toEqual({ ok: true, value: "undefined" });
  });

  it("apply passes thisArg", () => {
    const g = "function g(){ return typeof this; }";
    expect(litValue(call(`export function f() { ${g} return g.apply(5, []); }`).result)).toEqual({ ok: true, value: "number" });
    expect(litValue(call(`export function f() { ${g} return g.apply(null, []); }`).result)).toEqual({ ok: true, value: "object" });
  });

  it("call with identity check", () => {
    expect(litValue(call(`export function f() { function g(){ return this === 5; } return g.call(5); }`).result)).toEqual({ ok: true, value: true });
    expect(litValue(call(`export function f() { function g(){ return this === null; } return g.call(null); }`).result)).toEqual({ ok: true, value: true });
  });

  it("bind remembers bound this and args", () => {
    expect(litValue(call(`export function f() { function add(a, b){ return this + a + b; } const g = add.bind(10, 1); return g(2); }`).result)).toEqual({ ok: true, value: 13 });
    expect(litValue(call(`export function f() { function add(a, b){ return this + a + b; } return add.bind(10, 1, 2)(); }`).result)).toEqual({ ok: true, value: 13 });
    expect(litValue(call(`export function f() { function g(){ return typeof this; } const h = g.bind(5); return h(); }`).result)).toEqual({ ok: true, value: "number" });
  });

  it("function expression receiver", () => {
    expect(litValue(call(`export function f() { const g = function(){ return typeof this; }; return g.call(5); }`).result)).toEqual({ ok: true, value: "number" });
  });

  it("method call passes object thisArg", () => {
    const r = call(`export function f() { const o = {n: 9, get(){ return this.n; }}; return o.get.call({n: 1}); }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("plain call keeps strict undefined this", () => {
    expect(litValue(call(`export function f() { function g(){ return typeof this; } return g(); }`).result)).toEqual({ ok: true, value: "undefined" });
  });
});

/**
 * BUG-127：自有访问器 `length`（对象字面量 getter / Object.defineProperty）
 * 在 `$len` 与 `f.apply` 的 array-like 展开处绕过 accessorTable——`$len` 折
 * exact undefined、apply 按 0 实参调用（NaN），getter 副作用丢失；而
 * Array.from 的同款访问器已走 accessorReadDomain（两面结论相反）。修复：
 * 两个消费点与 Array.from 同口径（读一次、副作用一次）。
 */
describe("自有访问器 length 的读取（$len / Function.prototype.apply）（BUG-127）", () => {
  it("$len 求值对象字面量 / defineProperty 的自有 getter", () => {
    expect(
      litValue(call(`export function f() { const o = { get length() { return 2; } }; return o.length; }`).result),
    ).toEqual({ ok: true, value: 2 });
    expect(
      litValue(
        call(
          `export function f() { let n = 0; const o = { get length() { n++; return 3; } }; const x = o.length; return x + ":" + n; }`,
        ).result,
      ),
    ).toEqual({ ok: true, value: "3:1" });
    expect(
      litValue(
        call(
          `export function f() { const o = {}; Object.defineProperty(o, "length", { get() { return 7; }, configurable: true }); return o.length; }`,
        ).result,
      ),
    ).toEqual({ ok: true, value: 7 });
  });

  it("apply 的 array-like 实参按访问器 length / 索引展开", () => {
    expect(
      litValue(
        call(
          `export function f() { const o = { get length() { return 3; }, 0: 1, 1: 2, 2: 3 }; function g(a, b, c) { return a + b + c; } return g.apply(null, o); }`,
        ).result,
      ),
    ).toEqual({ ok: true, value: 6 });
  });

  it("对照：数据槽 array-like 与真数组实参不变", () => {
    expect(
      litValue(
        call(
          `export function f() { const o = { length: 3, 0: 1, 1: 2, 2: 3 }; function g(a, b, c) { return a + b + c; } return g.apply(null, o); }`,
        ).result,
      ),
    ).toEqual({ ok: true, value: 6 });
    expect(
      litValue(
        call(
          `export function f() { function g(a, b, c) { return a + b + c; } return g.apply(null, [1,2,3]); }`,
        ).result,
      ),
    ).toEqual({ ok: true, value: 6 });
  });
});

/**
 * BUG-1071：`.call` / `.apply` / bind 产物调用的调用点见证（BUG-045）此前只在
 * 成功路径发——调用抛出时 `finally` 之前的 `noteIndirectCall` 根本没执行 ⇒
 * `nudo test` 里这条间接调用的现场像「从没执行过」。修复：调用包进 thunk，
 * 记录在 `finally` 发（`threw: true` + `throwPayloadOf(e)`，与类方法/属性值
 * 派发同形）。
 */
describe("间接调用抛出也发调用点见证（BUG-1071）", () => {
  function recordsOf(src: string, fnName = "f"): EvalCallRecord[] {
    const records: EvalCallRecord[] = [];
    const prev = setEvalCallCollector((r) => records.push(r));
    try {
      const run = runTranspiled(src, { mode: "analyze" });
      callTranspiledExportFull(run, fnName, []);
    } finally {
      setEvalCallCollector(prev);
    }
    return records;
  }

  const THROWING = `function boom() { throw new TypeError("x"); }`;

  it(".call 抛出：record.threw = true，载荷为 TypeError brand", () => {
    const rec = recordsOf(`export function f() { ${THROWING} boom.call(null); }`).find(
      (r) => r.fnName === "boom",
    );
    expect(rec).toBeDefined();
    expect(rec!.threw).toBe(true);
    expect(rec!.result.shape.k).toBe("brand");
    expect((rec!.result.shape as { name?: string }).name).toBe("TypeError");
  });

  it(".apply 抛出同款见证", () => {
    const rec = recordsOf(`export function f() { ${THROWING} boom.apply(null, []); }`).find(
      (r) => r.fnName === "boom",
    );
    expect(rec).toBeDefined();
    expect(rec!.threw).toBe(true);
  });

  it("bind 产物调用抛出同款见证", () => {
    const rec = recordsOf(`export function f() { ${THROWING} const g = boom.bind(null); g(); }`).find(
      (r) => r.fnName === "boom",
    );
    expect(rec).toBeDefined();
    expect(rec!.threw).toBe(true);
  });

  it("对照：未抛的 .call 见证仍 threw = false", () => {
    const rec = recordsOf(
      `export function f() { function ok() { return 1; } ok.call(null); }`,
    ).find((r) => r.fnName === "ok");
    expect(rec).toBeDefined();
    expect(rec!.threw).toBe(false);
  });
});
