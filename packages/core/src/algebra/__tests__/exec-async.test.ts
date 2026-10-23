import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  $lit,
  $await,
  litValue,
  absToString,
} from "@nudojs/core";

describe("evaluator async / await", () => {
  it("await async call unwraps to concrete", () => {
    const src = `
export async function f(n) {
  return n + 1;
}
export async function go(n) {
  return await f(n);
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const r = callTranspiledExportFull(exports, "go", [$lit(1)]);
    // go 是 async → 外层 promise
    expect(absToString(r.result)).toContain("promise");
    expect(litValue($await(r.result))).toEqual({ ok: true, value: 2 });
  });

  it("async wraps return as promise", () => {
    const src = `
export async function f() {
  return 42;
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const r = callTranspiledExportFull(exports, "f", []);
    expect(absToString(r.result)).toContain("promise");
    expect(litValue($await(r.result))).toEqual({ ok: true, value: 42 });
  });

  it("transpiles async and await", async () => {
    const { transpile } = await import("@nudojs/core");
    // Bug 201：async 体（**直接含 await**）编译成宿主生成器——`await` 发射
    // `yield`（真挂起点），由 `$asyncGen` 驱动恢复 ⇒ await 之后的语句不在
    // 调用点内联跑完（原生：恢复点是微任务）。
    const out = transpile(`export async function f(n) { return await g(n); }`);
    expect(out).toContain("$asyncGen(");
    expect(out).toContain("function* ()");
    expect(out).toContain("yield ");
    // 无 await 的 async 体没有挂起点 ⇒ 沿用既有同步路径（$async(thunk)）
    const noAwait = transpile(`export async function f(n) { return n + 1; }`);
    expect(noAwait).toContain("$async(");
  });
});
