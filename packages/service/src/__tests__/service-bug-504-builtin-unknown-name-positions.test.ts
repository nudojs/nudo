/**
 * Bug 504：nudo:builtin-unknown 把「导入/导出的别名」与「标签名」当成
 * 「未被覆盖的内建 API」误报。
 *
 * 原生 oracle（tmp/probe/fix-r24-m/native504.mjs / native504b.mjs）：
 * - `import { alpha as betaAlias }` → 正常执行，无 ReferenceError
 * - `export { y as renamed }` → 正常执行（导出名不是模块作用域绑定，但也不
 *   是自由全局引用）
 * - `outer:` / `break outer` → 正常执行（标签是独立命名空间）
 *
 * 修法（service 侧 eval-diagnostics）：这些位置是**名字位**不是**引用位**——
 * imported / exported / label 与既有的 key / property / local / id 同归名字位。
 *
 * 负控制：真正的自由全局仍要报；`export * as ns` 的**体内引用**仍要报，
 * 且锚点落在真正的引用位（原生下 ns 不是模块作用域绑定 ⇒ ReferenceError）。
 */
import { describe, it, expect } from "vitest";
import { collectEvalDiagnostics } from "../eval-diagnostics.ts";

const names = (src: string): string[] =>
  collectEvalDiagnostics(src).builtinUnknown.map((b) => b.name);

describe("Bug 504 — import/export alias and label are name positions", () => {
  it("does not flag an import alias source name (imported)", () => {
    const src = `
import { alpha as betaAlias, default as def } from "./m.js";
export function f() {
  return betaAlias + def;
}
`;
    expect(names(src)).not.toContain("alpha");
    expect(names(src)).not.toContain("default");
    expect(names(src)).toEqual([]);
  });

  it("does not flag an export alias name (exported)", () => {
    const src = `
import { y } from "./m.js";
export { y as renamed };
export function f() {
  return y;
}
`;
    expect(names(src)).not.toContain("renamed");
    expect(names(src)).toEqual([]);
  });

  it("does not flag a label name (labeled / break / continue)", () => {
    const src = `
export function f() {
  outer: for (let i = 0; i < 3; i++) {
    if (i === 1) continue outer;
    break outer;
  }
  return 1;
}
`;
    expect(names(src)).not.toContain("outer");
    expect(names(src)).toEqual([]);
  });

  it("does not flag a namespace-import binding local name", () => {
    const src = `
import * as helpers from "./m.js";
export function f() {
  return helpers.greet();
}
`;
    expect(names(src)).toEqual([]);
  });

  it("negative control: a real free global is still reported", () => {
    const src = `
export function f() {
  return someUndeclaredGlobal;
}
`;
    expect(names(src)).toContain("someUndeclaredGlobal");
  });

  it("negative control: export * as ns body reference is still reported, anchored at the reference", () => {
    // 原生：`export * as ns from` 不创建模块作用域绑定 → 体内引用 ns 是自由全局
    const src = `
export * as ns from "./m.js";
export function f() {
  return ns.alpha;
}
`;
    const hits = collectEvalDiagnostics(src).builtinUnknown.filter((b) => b.name === "ns");
    expect(hits).toHaveLength(1);
    // 锚点落在真正的引用位（第 4 行 `return ns.alpha`），不是名字位（第 2 行）
    expect(hits[0]!.range.start.line).toBe(4);
  });

  it("negative control: export { y as renamed } body reference is still reported", () => {
    // 原生：`renamed` 不是模块作用域绑定 → 体内引用是自由全局
    const src = `
import { y } from "./m.js";
export { y as renamed };
export function f() {
  return renamed;
}
`;
    const hits = collectEvalDiagnostics(src).builtinUnknown.filter((b) => b.name === "renamed");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.range.start.line).toBe(5);
  });

  it("negative control: computed keys / members stay live references", () => {
    const src = `
export function f(o) {
  const a = {[missing]: 1};
  const b = o[alsoMissing];
  return a + b;
}
`;
    const got = names(src);
    expect(got).toContain("missing");
    expect(got).toContain("alsoMissing");
  });

  it("negative control: non-computed property names stay name positions", () => {
    const src = `
export function f(o) {
  const a = {key: 1};
  const {key} = a;
  return a.key + o.name + key;
}
`;
    expect(names(src)).toEqual([]);
  });
});
