/**
 * Bug 462：@nudo:pure 的纯度标记必须落在**调用点真正解析到的那个函数值**上。
 *
 * memo 以**对象身份**为键（pureCallMemo / pureMemo：WeakMap<fnObj, argsKey, …>），
 * 标记到"等价但不同一"的对象上不命中。修复前 service 从 globalEnv 取标记对象，
 * 而 globalEnv 从未绑定任何函数（collectBindings 只写 bindings 表）⇒ 标记从未
 * 落下，@nudo:pure 恒为空转（纯函数指令无任何求值语义）。
 *
 * 本测试锁住：
 *   ① 纯函数（无副作用）：加不加指令结果一致（文档承诺："analysis results
 *      stay correct with or without the directive"）
 *   ② 纯度标记落在**分析实例的函数值**上（宿主 JS 函数对象 / Abs fn 值两种形态）
 *
 * 注：端到端的「同实参二次调用命中缓存」还要求**调用面用的实例**也带标记——
 * 调用面当前按用例新建独立模块实例（Bug 472 的 fresh 设计），落点在
 * eval-run 的调用面 / core 转译面（见本轮报告的越界项）。本测试锁住
 * service 侧可独立保证的那一段（标记确实落下）。
 */
import { describe, it, expect } from "vitest";
import { analyzeFile } from "../analyzer.ts";
import { tryRunEval, tryEvalCallFull } from "../eval-run.ts";
import { bindingsOf, formatAbs, pureFnNameOf } from "@nudojs/core";

/** 纯函数：指令不应改变结果 */
const PURE_FN = `/**
 * @nudo:pure
 */
export function double(n) { return n * 2; }
export function useDouble() { return double(21) + double(21); }
`;
const PURE_FN_NO_DIRECTIVE = PURE_FN.replace("@nudo:pure", "");

/** 顶层函数声明（转译面提升为 export → 宿主 JS 函数对象） */
const DECL_FN = `let k = 0;
/**
 * @nudo:pure
 */
function next() { k = k + 1; return k; }
export function use() { const a = next(); const b = next(); return a + b; }
`;

/** const 函数表达式（recordBinding 记录 → Abs fn 值） */
const ARROW_FN = `let k = 0;
/**
 * @nudo:pure
 */
const next = () => { k = k + 1; return k; };
export function use() { const a = next(); const b = next(); return a + b; }
`;

describe("Bug 462 — @nudo:pure marker lands on the call-site function value", () => {
  it("pure function: directive does not change the result (doc promise)", () => {
    const pick = (r: ReturnType<typeof analyzeFile>) => {
      const fn = r.functions.find((f) => f.name === "useDouble");
      const c = fn?.cases.find((x) => x.name.startsWith("entry@") || x.name.startsWith("call@"));
      return c ? formatAbs(c.abs) : "<none>";
    };
    const withDir = pick(analyzeFile("/t/b462/pure-with.js", PURE_FN));
    const without = pick(analyzeFile("/t/b462/pure-without.js", PURE_FN_NO_DIRECTIVE));
    expect(withDir).toBe(without);
    expect(withDir).toContain("84");
  });

  it("marker lands on the analyzed instance (top-level function declaration)", () => {
    const path = "/t/b462/marker-decl.js";
    analyzeFile(path, DECL_FN);
    // 分析实例（eval 缓存槽内的干净实例）——标记必须落在它上面的函数值上
    const run = tryRunEval(DECL_FN, path, { envNames: [], mocks: {} });
    expect(run).toBeDefined();
    const fnVal = run!.exports["next"];
    expect(typeof fnVal).toBe("function");
    expect((fnVal as { _memoize?: string })._memoize).toBe("next");
  });

  it("marker lands on the analyzed instance (const arrow function → Abs fn value)", () => {
    const path = "/t/b462/marker-arrow.js";
    analyzeFile(path, ARROW_FN);
    const run = tryRunEval(ARROW_FN, path, { envNames: [], mocks: {} });
    expect(run).toBeDefined();
    const absVal = bindingsOf(run!.exports)?.get("next");
    expect(absVal).toBeDefined();
    expect(pureFnNameOf(absVal)).toBe("next");
  });

  it("call surface (fresh instance) actually hits the pure memo", () => {
    // 调用面按用例新建**独立模块实例**（fresh 开关）——标记若只落在 memo
    // 里那份旧实例上，这里永远命中不了 memo（k 会自增到 2）。
    const path = "/t/b462/fresh-memo.js";
    const full = tryEvalCallFull(DECL_FN, path, "use", [], { envNames: [], mocks: {} });
    expect(full).toBeDefined();
    // 命中 memo ⇒ 第二次 next() 返回首次结果（1）⇒ a + b = 1 + 1 = 2
    expect(formatAbs(full!.result)).toMatch(/^2(\s|$)/);
    // 负控制：没有 @nudo:pure ⇒ 不 memo ⇒ 1 + 2 = 3
    const noDirective = DECL_FN.replace("@nudo:pure", "");
    const full2 = tryEvalCallFull(noDirective, path, "use", [], { envNames: [], mocks: {} });
    expect(full2).toBeDefined();
    expect(formatAbs(full2!.result)).toMatch(/^3(\s|$)/);
  });
});
