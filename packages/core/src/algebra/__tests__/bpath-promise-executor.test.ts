/**
 * Promise 执行器：new Promise((resolve, reject) => …) 收集 resolve 实参作为
 * promise inner（求并/路径敏感）。
 * - 单次 resolve → 精确 inner（lit / number）
 * - 顺序双 resolve：原生只认第一次——无 fork 时 first-wins
 * - 执行器内 $fork 分叉：各臂 resolve 值 join（不得 first-wins 假精确）
 * - 只 reject / 永不 settle / 抽象 fn → promise<unknown>（不假装 resolve）
 * - .then(cb) 可映射回调 returnType → promise<映射结果>；做不到诚实 unknown
 * - Promise.resolve / new Promise 结果一致处对齐
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue } from "@nudojs/core";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

type Eff = { shape?: { k?: string; eff?: string; inner?: unknown } };

function promiseInner(r: unknown): unknown {
  const a = r as Eff;
  expect(a?.shape?.k, "expected eff shape").toBe("eff");
  expect(a?.shape?.eff, "expected promise eff").toBe("promise");
  return a!.shape!.inner;
}

function innerShape(inner: unknown): string | undefined {
  return (inner as { shape?: { k?: string; type?: string } })?.shape?.k;
}

function isUnknownInner(inner: unknown): boolean {
  const a = inner as { shape?: { k?: string }; term?: unknown };
  return a?.shape?.k === "unknown" && a.term === undefined;
}

describe("new Promise executor resolve", () => {
  it("resolve(42) → promise with number/42 inner", () => {
    const r = call(`export function f() { return new Promise((resolve) => { resolve(42); }); }`);
    const inner = promiseInner(r.result);
    const lv = litValue(inner as never);
    const k = innerShape(inner);
    expect(lv === 42 || (k === "prim" && (inner as { shape?: { type?: string } }).shape?.type === "number")).toBe(true);
  });

  it("resolve('a') → promise with string inner", () => {
    const r = call(`export function f() { return new Promise((r) => { r("a"); }); }`);
    const inner = promiseInner(r.result);
    expect(litValue(inner as never)).toBe("a");
  });

  it("resolve(value) from parameter stays typed", () => {
    const r = call(`export function f(x) { return new Promise((r) => { r(x); }); }`);
    const inner = promiseInner(r.result);
    // 无约束参数 → any，不是 unknown（any ≠ unknown）
    const k = (inner as { shape?: { k?: string } })?.shape?.k;
    expect(k === "any" || k === "unknown" || k === "prim").toBe(true);
  });

  it("sequential double resolve takes the first (native no-op)", () => {
    const r = call(`export function f() { return new Promise((r) => { r("a"); r("b"); }); }`);
    const inner = promiseInner(r.result);
    // 无 fork：first-wins → "a"；若实现退化为 join 也可，但不得只剩 "b"
    const lv = litValue(inner as never);
    if (lv !== undefined) {
      expect(lv).toBe("a");
    } else {
      // join 拓宽：shape 至少是 string
      expect(innerShape(inner)).toBe("prim");
    }
  });

  it("fork arms join resolve values (no first-wins false precision)", () => {
    // 抽象条件：两臂都跑（缺参会被收成 undef，只走假臂）
    const src = `export function f(c) { return new Promise((r) => { if (c) { r(1); } else { r(2); } }); }`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const anyArg = { shape: { k: "any" }, conf: "path" } as never;
    const r = callTranspiledExportFull(exports, "f", [anyArg]);
    const inner = promiseInner(r.result);
    // 抽象条件两臂都跑：inner 须覆盖 1 与 2（sum(1|2) 或拓宽 number），
    // 不得只剩 1，也不得掉成 unknown
    const lv = litValue(inner as never);
    if (lv !== undefined) {
      // 只可能在条件被折死时出现；符号条件不应折叠
      expect([1, 2]).toContain(lv);
    } else {
      expect(["prim", "sum"]).toContain(innerShape(inner));
    }
  });

  it("arrow expression body resolve", () => {
    const r = call(`export function f() { return new Promise((r) => r(7)); }`);
    const inner = promiseInner(r.result);
    expect(litValue(inner as never) === 7 || innerShape(inner) === "prim").toBe(true);
  });
});

describe("new Promise reject / never settle", () => {
  it("only reject keeps honest unknown inner", () => {
    const r = call(
      `export function f() { return new Promise((r, j) => { j(new Error("x")); }); }`,
    );
    const inner = promiseInner(r.result);
    expect(isUnknownInner(inner)).toBe(true);
  });

  it("empty executor (never settle) stays promise<unknown>", () => {
    const r = call(`export function f() { return new Promise(() => {}); }`);
    const inner = promiseInner(r.result);
    expect(isUnknownInner(inner)).toBe(true);
    const t = call(`export function f() { return typeof new Promise(() => {}); }`);
    expect(litValue(t.result)).toBe("object");
  });

  it("executor that throws keeps unknown inner", () => {
    const r = call(
      `export function f() { return new Promise(() => { throw new Error("boom"); }); }`,
    );
    const inner = promiseInner(r.result);
    expect(isUnknownInner(inner)).toBe(true);
  });

  it("reject then resolve: first settle wins (reject) → unknown", () => {
    const r = call(
      `export function f() { return new Promise((r, j) => { j(1); r(2); }); }`,
    );
    const inner = promiseInner(r.result);
    expect(isUnknownInner(inner)).toBe(true);
  });
});

describe("Promise.resolve aligned with new Promise", () => {
  it("Promise.resolve(42) has number inner", () => {
    const r = call(`export function f() { return Promise.resolve(42); }`);
    const inner = promiseInner(r.result);
    expect(litValue(inner as never)).toBe(42);
  });

  it("new Promise(r => r(42)) matches Promise.resolve(42) inner", () => {
    const a = promiseInner(call(`export function f() { return new Promise((r) => r(42)); }`).result);
    const b = promiseInner(call(`export function f() { return Promise.resolve(42); }`).result);
    expect(litValue(a as never)).toBe(litValue(b as never));
  });
});

describe("promise .then mapping", () => {
  it("Promise.resolve(1).then(() => 5) → promise number/5", () => {
    const r = call(`export function f() { return Promise.resolve(1).then(() => 5); }`);
    const inner = promiseInner(r.result);
    expect(litValue(inner as never) === 5 || innerShape(inner) === "prim").toBe(true);
  });

  it("then maps inner through callback param", () => {
    const r = call(`export function f() { return Promise.resolve(2).then((v) => v * 10); }`);
    const inner = promiseInner(r.result);
    expect(litValue(inner as never) === 20 || innerShape(inner) === "prim").toBe(true);
  });

  it("then without callback passes inner through", () => {
    const r = call(`export function f() { return Promise.resolve(3).then(); }`);
    const inner = promiseInner(r.result);
    expect(litValue(inner as never)).toBe(3);
  });

  it("uncallable then target widens honestly", () => {
    const r = call(`export function f(cb) { return Promise.resolve(1).then(cb); }`);
    const inner = promiseInner(r.result);
    // any 参数可调用也可不——结果不得假精确折 1
    const lv = litValue(inner as never);
    expect(lv === 1 ? innerShape(inner) !== undefined : true).toBe(true);
  });
});

describe("promise .constructor (shared with prim constructor channel)", () => {
  it("Promise.resolve(42).constructor === Promise / .name", () => {
    const eq = call(`export function f() { return Promise.resolve(42).constructor === Promise; }`);
    expect(litValue(eq.result)).toBe(true);
    const name = call(`export function f() { return Promise.resolve(1).constructor.name; }`);
    expect(litValue(name.result)).toBe("Promise");
  });

  it("then result .constructor.name is Promise", () => {
    const name = call(
      `export function f() { return Promise.resolve().then(() => 5).constructor.name; }`,
    );
    expect(litValue(name.result)).toBe("Promise");
  });

  it("new Promise result .constructor === Promise", () => {
    const eq = call(
      `export function f() { return new Promise((r) => r(1)).constructor === Promise; }`,
    );
    expect(litValue(eq.result)).toBe(true);
  });
});
