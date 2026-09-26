import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  setBCallCollector,
  formatShape,
  type Abs,
} from "../index.ts";

type Rec = { fnName: string; args: Abs[]; result: Abs };

function runCollect(src: string): Rec[] {
  const recs: Rec[] = [];
  const prev = setBCallCollector((r) => {
    recs.push({
      fnName: r.fnName,
      args: r.args,
      result: r.result as Abs,
    });
  });
  try {
    runTranspiled(src, {});
  } finally {
    setBCallCollector(prev);
  }
  return recs;
}

/** D1：optional / find / pop / 下标 的值流残差回归 */
describe("D1 value-flow residuals", () => {
  it("pop on param: pre-mutation arg + last element (no double pop)", () => {
    const recs = runCollect(
      `export function popOnly(xs) {\n  return xs.pop();\n}\npopOnly([1, 2, 3]);\n`,
    );
    const hit = recs.find((r) => r.fnName === "popOnly");
    expect(hit).toBeDefined();
    expect(formatShape(hit!.result)).toBe("3");
    // 入参快照 = 调用点 [1,2,3]（不是二次 pop 后的 [1]）
    expect(formatShape(hit!.args[0]!)).toBe("[1, 2, 3]");
  });

  it("push on param: length is 3 not 4 (no double apply)", () => {
    const recs = runCollect(
      `export function pushThenLen(xs) {\n  xs.push(9);\n  return xs.length;\n}\npushThenLen([1, 2]);\n`,
    );
    const hit = recs.find((r) => r.fnName === "pushThenLen");
    expect(hit).toBeDefined();
    expect(formatShape(hit!.result)).toBe("3");
    expect(formatShape(hit!.args[0]!)).toBe("[1, 2]");
  });

  it("local pop / index stay exact", () => {
    const recs = runCollect(
      `export function a() {\n  const xs = [1, 2, 3];\n  return xs.pop();\n}\nexport function b() {\n  const xs = [9, 8];\n  return xs[0];\n}\na();\nb();\n`,
    );
    const a = recs.find((r) => r.fnName === "a");
    const b = recs.find((r) => r.fnName === "b");
    expect(a && formatShape(a.result)).toBe("3");
    expect(b && formatShape(b.result)).toBe("9");
  });

  it("find first match and no-match", () => {
    const recs = runCollect(
      `export function first(xs) {\n  return xs.find((x) => x > 0);\n}\nexport function none(xs) {\n  return xs.find((x) => x > 100);\n}\nfirst([1, 2, 3]);\nnone([1, 2]);\n`,
    );
    const first = recs.find((r) => r.fnName === "first");
    const none = recs.find((r) => r.fnName === "none");
    expect(first && formatShape(first.result)).toBe("1");
    expect(none && formatShape(none.result)).toBe("undefined");
  });

  it("optional chain on known shape", () => {
    const recs = runCollect(
      `export function opt(o) {\n  return o?.a?.b;\n}\nexport function miss(o) {\n  return o?.a;\n}\nopt({ a: { b: 1 } });\nmiss({});\n`,
    );
    const opt = recs.find((r) => r.fnName === "opt");
    const miss = recs.find((r) => r.fnName === "miss");
    expect(opt && formatShape(opt.result)).toBe("1");
    expect(miss && formatShape(miss.result)).toBe("undefined");
  });
});
