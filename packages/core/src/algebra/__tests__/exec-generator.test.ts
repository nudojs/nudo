import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  $lit,
  litValue,
  absToString,
  transpile,
  formatAbs,
  anyAbs,
} from "@nudojs/core";

describe("evaluator generators", () => {
  it("function* collects yields into tuple", () => {
    const src = `
export function* gen() {
  yield 1;
  yield 2;
  yield 3;
}
export function go() {
  const xs = gen();
  return xs[0] + xs[1] + xs[2];
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const r = callTranspiledExportFull(exports, "go", []);
    expect(litValue(r.result)).toEqual({ ok: true, value: 6 });
  });

  it("for-of over generator", () => {
    const src = `
export function* nums() {
  yield 1;
  yield 2;
}
export function sum() {
  let t = 0;
  for (const x of nums()) {
    t = t + x;
  }
  return t;
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const r = callTranspiledExportFull(exports, "sum", []);
    expect(litValue(r.result)).toEqual({ ok: true, value: 3 });
  });

  it("transpiles generator to $gen/$yield", () => {
    const out = transpile(`export function* g() { yield 1; }`);
    expect(out).toContain("$gen(");
    expect(out).toContain("$yield(");
  });

  // Bug 82：yield* 委托——读 delegate 标志，元素逐个压入（不是整个可迭代
  // 值）；迭代性校验同 $elems 分类器；表达式值 = 内层迭代器 return 值
  //（保守 unknown）。生成器**调用**原生全量（Bug 58：体内 throw 属首个
  // next() 迭代期，调用期吞掉）——故 definite 抛在此只体现为值域前缀截断。
  it("yield* tuple / string → yields ELEMENTS (native: [...j()] === [1, 2])", () => {
    const src = `
export function* j() { yield* [1, 2]; }
export function* k() { yield* "ab"; }
export function spreadJ() { return [...j()]; }
export function spreadK() { return [...k()]; }
export function sum() {
  let t = 0;
  for (const v of j()) t += v;
  return t;
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    // Bug 22：生成器对象是带迭代器协议面的 obj（不再是 yield 元组数组）——
    // 值域断言经原生迭代面（spread）消费
    const rj = callTranspiledExportFull(exports, "spreadJ", []);
    expect(formatAbs(rj.result as never)).toContain("[1, 2]");
    const rk = callTranspiledExportFull(exports, "spreadK", []);
    expect(formatAbs(rk.result as never)).toContain('["a", "b"]');
    const rs = callTranspiledExportFull(exports, "sum", []);
    expect(litValue(rs.result)).toEqual({ ok: true, value: 3 });
  });

  it("yield* prim-lit 接收者：委托前抛出 → 值域前缀为空（native 前缀语义）", () => {
    const src = `
export function* g() { yield 1; yield* 2; yield 3; }
export function* i() { yield* null; }
export function spreadG() { return [...g()]; }
export function spreadI() { return [...i()]; }
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const rg = callTranspiledExportFull(exports, "spreadG", []);
    expect(formatAbs(rg.result as never)).toContain("[1]");
    const ri = callTranspiledExportFull(exports, "spreadI", []);
    expect(formatAbs(ri.result as never)).toContain("[]");
  });

  it("yield* any 接收者 → 元素 any（无约束，不是 unknown 引擎债）", () => {
    const exports = runTranspiled(
      `export function* h(x) { yield* x; }
export function spreadH(x) { return [...h(x)]; }`,
      { mode: "analyze" },
    );
    const r = callTranspiledExportFull(exports, "spreadH", [anyAbs]);
    expect(formatAbs(r.result as never)).toContain("[any]");
  });

  it("yield* 表达式值 = 内层迭代器 return 值（保守 unknown）", () => {
    const exports = runTranspiled(
      `export function* g() { const v = yield* [1]; yield v; }`,
      { mode: "analyze" },
    );
    const r = callTranspiledExportFull(exports, "g", []);
    expect(formatAbs(r.result as never)).toContain("unknown");
  });

  it("generator 方法体同样委托元素（class 方法）", () => {
    const src = `
class C { *m() { yield* "xy"; } }
export function f() { const it = new C().m(); return it[0] + it[1]; }
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const r = callTranspiledExportFull(exports, "f", []);
    expect(litValue(r.result)).toEqual({ ok: true, value: "xy" });
  });

  it("generator 对象方法同样委托元素（对象方法）", () => {
    const src = `
export const o = { *m() { yield* "xy"; } };
export function f() { const it = o.m(); return it[0] + it[1]; }
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const r = callTranspiledExportFull(exports, "f", []);
    expect(litValue(r.result)).toEqual({ ok: true, value: "xy" });
  });

  it("transpiles object generator method to $gen/$yield", () => {
    const out = transpile(`export const o = { *g() { yield 1; } };`);
    expect(out).toContain("$gen(");
    expect(out).toContain("$yield(");
  });

  it("transpile reads the delegate flag ($yieldStar vs $yield)", () => {
    expect(transpile(`export function* g() { yield* [1]; }`)).toContain("$yieldStar(");
    expect(transpile(`export function* g() { yield 1; }`)).not.toContain("$yieldStar(");
  });
});
