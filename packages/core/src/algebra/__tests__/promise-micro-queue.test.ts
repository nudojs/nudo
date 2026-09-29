/**
 * BUG-013 promise 微队列：模块级 then 排队不得窜到后续文件；队列有上限。
 *
 * 此前 promiseMicros 全局队列只在具名调用出口 drain——模块求值
 * （runTranspiled / tryRunEval）排队的 then/catch 回调会滞留到下一个任意
 * 文件的 callTranspiledExportFull 出口才执行（跨会话脏写），且队列无上限。
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  litValue,
  queuePromiseMicro,
  drainPromiseMicros,
  resetEvalCallBudget,
} from "@nudojs/core";
import {
  getPromiseMicrosLength,
  MAX_PROMISE_MICROS,
  setAbsTruncationCollector,
} from "@nudojs/core/internal";

afterEach(() => {
  drainPromiseMicros();
  resetEvalCallBudget();
  setAbsTruncationCollector(null);
});

describe("BUG-013 promise micro queue", () => {
  it("module-level Promise.then is drained at runTranspiled exit (does not leak to the next file)", () => {
    // 文件 A：只求值、不做具名调用——then 回调必须在 A 的求值出口排空
    const srcA = `export const p = Promise.resolve(1).then((x) => { return x + 1; });`;
    runTranspiled(srcA, { mode: "analyze" });
    // 求值出口已 drain：队列为空
    expect(getPromiseMicrosLength()).toBe(0);

    // 文件 B 的调用窗口：不得再执行 A 的微任务
    const runB = runTranspiled(`export function f() { return 42; }`, {
      mode: "analyze",
    });
    const r = callTranspiledExportFull(runB, "f", []);
    expect(litValue(r.result)).toBe(42);
    expect(getPromiseMicrosLength()).toBe(0);
  });

  it("named-call .then is drained at call exit", () => {
    const run = runTranspiled(
      `export function f() { return Promise.resolve(1).then((x) => { return x + 1; }); }`,
      { mode: "analyze" },
    );
    callTranspiledExportFull(run, "f", []);
    expect(getPromiseMicrosLength()).toBe(0);
  });

  it("queue has a hard cap (overflow is dropped and recorded, not unbounded)", () => {
    const seen: string[] = [];
    setAbsTruncationCollector((l) => seen.push(l));
    // 直接灌爆队列（不经 drain）：长度封顶在 MAX_PROMISE_MICROS
    for (let i = 0; i < MAX_PROMISE_MICROS + 64; i++) {
      queuePromiseMicro(() => {});
    }
    expect(getPromiseMicrosLength()).toBe(MAX_PROMISE_MICROS);
    expect(seen).toContain("#promise-micro-overflow");
  });

  it("queue length is observable and stays bounded after many eval-only runs", () => {
    const src = `export const p = Promise.resolve(1).then((x) => { return x; });`;
    for (let i = 0; i < 8; i++) {
      runTranspiled(src, { mode: "analyze" });
      expect(getPromiseMicrosLength()).toBe(0);
    }
  });

  it("drain-time callback errors are recorded, not silently swallowed", () => {
    const seen: string[] = [];
    setAbsTruncationCollector((l) => seen.push(l));
    const run = runTranspiled(
      `export function f() {
        return Promise.resolve(1).then((x) => { throw new Error("boom"); });
      }`,
      { mode: "analyze" },
    );
    callTranspiledExportFull(run, "f", []);
    expect(getPromiseMicrosLength()).toBe(0);
    expect(seen).toContain("#promise-micro-error");
  });

  it("many then-chains in one call stay within the cap and still drain", () => {
    const n = MAX_PROMISE_MICROS + 64;
    const src = `export function f() {
      let acc = 0;
      for (let i = 0; i < ${n}; i++) {
        Promise.resolve(i).then((x) => { acc = x; });
      }
      return acc;
    }`;
    const run = runTranspiled(src, { mode: "analyze" });
    callTranspiledExportFull(run, "f", []);
    expect(getPromiseMicrosLength()).toBe(0);
  });
});
