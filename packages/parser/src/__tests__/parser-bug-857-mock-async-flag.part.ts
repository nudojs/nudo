/**
 * Bug 857 —— `@nudo:mock f = async (x) => x + 1` 的 **async 语义被静默丢弃**
 * ⇒ mock 被建模成**同步**函数 ⇒ 调用点 `f(1).then(…)` 报「method 'then'
 * missing on number receiver」⇒ **error 级** `nudo:entry-may-throw` **假红**
 * （native 不抛：native 返回 Promise）。
 *
 * 根因（expr-scan.ts `parseArrowFunctionExpr`）：解析层只取箭头的**参数与体**，
 * `init.async` **根本没有被读出来** ⇒ service 据此把 mock 建成同步函数
 * （`mock-abs.ts` 的 `async: false` 硬编码——**service 侧改动见交付报告**）。
 *
 * 修法（parser 侧）：扫描结果带上 `async` 标志（`async (x) => …` ⇒ true），
 * 消费面（service 的 mock 构造）据此把 mock 建成 async 函数。
 */
import { describe, it, expect } from "vitest";
import { parse } from "../parse.ts";
import { extractDirectives, type MockDirective } from "../directives.ts";
import { parseArrowFunctionExpr } from "../directives/expr-scan.ts";

function mockOf(source: string): MockDirective {
  const fns = extractDirectives(parse(source));
  const mocks = fns.flatMap((f) =>
    f.directives.filter((d): d is MockDirective => d.kind === "mock"),
  );
  expect(mocks).toHaveLength(1);
  return mocks[0]!;
}

describe("Bug 857: async arrow payload keeps its async flag", () => {
  it("`async (x) => x + 1` is scanned as async", () => {
    const r = parseArrowFunctionExpr("async (x) => x + 1");
    expect(r).not.toBeNull();
    expect(r!.async).toBe(true);
    expect(r!.params).toEqual(["x"]);
  });

  it("sync arrow is scanned as sync (negative control)", () => {
    const r = parseArrowFunctionExpr("(x) => x + 1");
    expect(r).not.toBeNull();
    expect(r!.async).toBe(false);
  });

  it("async arrow without params is still async", () => {
    const r = parseArrowFunctionExpr("async () => 1");
    expect(r).not.toBeNull();
    expect(r!.async).toBe(true);
    expect(r!.params).toEqual([]);
  });

  it("`async function` expression is scanned as async", () => {
    const r = parseArrowFunctionExpr("async function (x) { return x; }");
    expect(r).not.toBeNull();
    expect(r!.async).toBe(true);
  });

  it("the `@nudo:mock` directive carries the async flag", () => {
    const mock = mockOf(
      `/**
 * @nudo:mock f = async (x) => x + 1
 */
export function caller() { return f(1); }`,
    );
    expect(mock.arrowFn).toBeDefined();
    expect(mock.arrowFn!.async).toBe(true);
  });

  it("a sync mock directive stays sync (negative control)", () => {
    const mock = mockOf(
      `/**
 * @nudo:mock f = (x) => x + 1
 */
export function caller() { return f(1); }`,
    );
    expect(mock.arrowFn).toBeDefined();
    expect(mock.arrowFn!.async).toBe(false);
  });

  it("the sinon `stub().callsFake(…)` path also keeps the async flag", async () => {
    // 857 的**第三处**（sinon 路径）：`mock-expr.ts` 的 `stub.callsFake({… async: false})`
    // 此前同样把 async 硬编码成 false ⇒ `stub().callsFake(async (x) => …)`
    // 被建模成同步函数 ⇒ 调用点 `.then(…)` 报「method 'then' missing」。
    const { parseNudoMockExpr } = await import("../directives/mock-expr.ts");
    const asyncHelper = parseNudoMockExpr("stub().callsFake(async (x) => x + 1)");
    expect(asyncHelper).not.toBeNull();
    expect(asyncHelper!.callsFakeImpl).toBeDefined();
    expect(asyncHelper!.callsFakeImpl!.async).toBe(true);

    const syncHelper = parseNudoMockExpr("stub().callsFake((x) => x + 1)");
    expect(syncHelper).not.toBeNull();
    expect(syncHelper!.callsFakeImpl!.async).toBe(false);
  });
});
