/**
 * Bug 3 回归：`.length` 在 nullish 接收者上必须与 $get 同口径——
 * 记 throws 域并硬抛 TypeError；any 接收者（无约束入口参）记 L2
 * entry-may-throw。此前转译器把 `.length` 路由到 $len（而非 $get），
 * $len 无 nullish/any 守卫直落形状分发尾 unknown——catch 永不触发、
 * `x.length` 是唯一不记 may-throw 的常见成员读（gate 假阴性）。
 *
 * 对照组：`null.x`（$get 路径）一直正确；可选链 `a?.length` 由
 * shortCircuitHop 先 $removeNullish 且 silent，保持静默不抛、不记。
 */
import { describe, it, expect } from "vitest";
// 相对路径引 src 引擎面（不经 @nudojs/core 别名——本 worktree 的 vite8
// 别名解析会把裸包名落到 dist 旧产物，见文件尾注）。
import { runTranspiled, callTranspiledExportFull } from "../exec/run.ts";
import { checkSource } from "../check.ts";
import { pTrue } from "../pred.ts";
import { litValue } from "../abs.ts";
import { $lit } from "../exec/runtime/state.ts";
import { withStdImport, stdOpts } from "./nudo-constraints.ts";

function run(src: string, args: unknown[] = []) {
  const exports = runTranspiled(src, { mode: "exec", maxLoopIters: 2000 });
  return callTranspiledExportFull(exports, "f", args.map((a) => $lit(a as never)));
}

function val(src: string, args?: unknown[]) {
  return litValue(run(src, args).result);
}

/** 原生：null/undefined 接收者成员读定抛 TypeError（catch 面接住） */
function expectCaught(src: string) {
  expect(val(src), `caught for: ${src}`).toEqual({ ok: true, value: "caught" });
}

/** 定抛 TypeError：throws 面是 TypeError brand（无 try/catch 时） */
function expectTypeError(src: string) {
  const r = run(src);
  const name = r.throws?.shape?.k === "brand"
    ? (r.throws as { shape: { name: string } }).shape.name
    : r.throws?.shape?.k;
  expect(name, `throws for: ${src}`).toBe("TypeError");
}

/** 可选链：精确 undefined、不抛 */
function expectExactUndefined(src: string) {
  const r = run(src);
  expect(r.throws?.shape?.k, `throws for: ${src}`).toBe("never");
  expect(litValue(r.result), `lit for: ${src}`).toEqual({ ok: true, value: undefined });
}

function check(src: string) {
  return checkSource("/t/eval-len-nullish.js", withStdImport(src), pTrue, stdOpts);
}

/** L2 entry-may-throw issue 数（按函数名过滤） */
function l2Issues(r: ReturnType<typeof check>, fn: string) {
  return r.issues.filter((i) => i.code === "nudo:entry-may-throw" && i.fn === fn);
}

describe("Bug 3：nullish 接收者 .length 定抛 TypeError", () => {
  it("null.length in try/catch → caught（原生 TypeError）", () => {
    expectCaught(`export function f() { try { return null.length; } catch (e) { return "caught"; } }`);
  });

  it("undefined.length in try/catch → caught", () => {
    expectCaught(`export function f() { try { return undefined.length; } catch (e) { return "caught"; } }`);
  });

  it("var n = null; n.length in try/catch → caught", () => {
    expectCaught(`export function f() { var n = null; try { return n.length; } catch (e) { return "caught"; } }`);
  });

  it("null.length 无 try/catch → throws 面 TypeError", () => {
    expectTypeError(`export function f() { return null.length; }`);
  });

  it("undefined.length 无 try/catch → throws 面 TypeError", () => {
    expectTypeError(`export function f() { return undefined.length; }`);
  });

  it("对照：null.x（$get 路径）保持 caught", () => {
    expectCaught(`export function f() { try { return null.x; } catch (e) { return "caught"; } }`);
  });

  it("a?.b.length：a 非 nullish 但 b 为 null → 仍抛（后续跳非可选）", () => {
    expectTypeError(`export function f() { const a = { b: null }; return a?.b.length; }`);
  });
});

describe("Bug 3：any 接收者（无约束入口参）的 L2 gate", () => {
  it("x.length → nudo:entry-may-throw（TypeError，点名 length）", () => {
    const r = check(`export function f(x) { return x.length; }`);
    const issues = l2Issues(r, "f");
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((i) => i.message.includes("TypeError"))).toBe(true);
    expect(issues.some((i) => i.suggestion.includes("'length'"))).toBe(true);
  });

  it("对照：x.prop 同样记（$get 路径不回退）", () => {
    const r = check(`export function f(x) { return x.prop; }`);
    expect(l2Issues(r, "f").length).toBeGreaterThan(0);
  });

  it("x?.length 可选链 → 静默不记（原生恒不抛）", () => {
    const r = check(`export function f(x) { return x?.length; }`);
    expect(l2Issues(r, "f").length).toBe(0);
  });

  it("x.foo.bar 对照仍记", () => {
    const r = check(`export function f(x) { return x.foo.bar; }`);
    expect(l2Issues(r, "f").length).toBeGreaterThan(0);
  });
});

describe("Bug 3：可选链与精确面不回退", () => {
  it("o?.length on null → 精确 undefined，不抛", () => {
    expectExactUndefined(`export function f() { const o = null; return o?.length; }`);
  });

  it("o?.length on 字符串|null sum（剪 nullish）→ 2，不抛", () => {
    expect(val(`export function f(c) { const o = c ? "ab" : null; return o?.length; }`, [true]))
      .toEqual({ ok: true, value: 2 });
  });

  it("字符串 .length 精确折叠", () => {
    expect(val(`export function f() { return "abc".length; }`)).toEqual({ ok: true, value: 3 });
  });

  it("元组/数组 .length 精确折叠", () => {
    expect(val(`export function f() { const a = [1, 2]; return a.length; }`)).toEqual({ ok: true, value: 2 });
  });
});

/**
 * 尾注（相对 import 的原因）：本 worktree 内 `@nudojs/core` 裸包名在
 * vitest（vite8）下不经 workspace-aliases 别名，经 package.json 自引用
 * 落到 dist 旧产物（`import.meta.resolve("@nudojs/core")` → dist/index.js，
 * 与 src containers.ts 的 $len 身份不等可证）。dist 由编排者按轮构建，
 * 单文件验证期间恒滞后于 src——引擎行为断言必须相对 import src。
 * CI 不受影响（先 build 后 test，dist 恒新）。
 */
