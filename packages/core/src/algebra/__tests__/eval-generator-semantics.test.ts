/**
 * Bug 2 / Bug 34（生成器语义两连，同族）：
 * - Bug 2：终末 return 值——`$gen(body)` 此前把生成器体当 thunk 跑并丢弃
 *   返回值，done:true 的 value 恒 undefined。native（node 实测）：
 *   `{yield 1; return 9}` 第二个 next() → {value: 9, done: true}；裸
 *   `return 5` 同理；值只在首个 done:true 交付一次（此后 next →
 *   value undefined）。
 * - Bug 34：体内异常——`yield*` 非可迭代 / 显式 throw / 运行时抛错此前被
 *   $gen 调用期 catch 静默吞掉（迭代截断成前缀或空，异常丢失、gate 静默）。
 *   native：异常延迟到首个触达抛点的 next()/迭代消费抛出（此后 done），
 *   g() 本身永不抛。gate 面：体内 soft may-throw（`yield* x`、x:any）挂
 *   生成器对象、消费点重记——仅构造不消费仍静默（Bug 58 口径保持）。
 * 每条断言与 node 真实执行对齐（值域 + throws 域双钉）。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull } from "../exec/run.ts";
import { anyAbs, litValue, type Abs } from "../abs.ts";
import { formatAbs } from "../format.ts";
import {
  runWithMayThrowSession,
  setMayThrowCollector,
  type MayThrowEffect,
} from "../may-throw.ts";

/** 源级求值三面：值 / throws 面 / soft may-throw 效果 kind 集 */
function evalSrc(
  src: string,
  fnName: string,
  args: Abs[] = [],
): { value: string; throws: string; kinds: string[] } {
  const run = runTranspiled(src, { mode: "analyze" });
  const effects: MayThrowEffect[] = [];
  let result: { result?: Abs; throws?: Abs } = {};
  runWithMayThrowSession(() => {
    setMayThrowCollector((e) => effects.push(e));
    try {
      result = callTranspiledExportFull(run, fnName, args) as {
        result?: Abs;
        throws?: Abs;
      };
    } catch {
      /* 入口整抛：NudoThrow 由调用边界收成 throws 面 */
    }
    setMayThrowCollector(null);
  });
  const norm = (a: Abs | undefined): string =>
    (a ? formatAbs(a) : "").replace(/\s+#[a-z]+$/, "");
  return {
    value: norm(result.result),
    throws: norm(result.throws),
    kinds: [...new Set(effects.map((e) => e.kind))],
  };
}

/** 值域字面量断言助手（litValue 折出的具体值） */
function litOf(src: string, fnName: string, args: Abs[] = []): { ok: boolean; value: unknown; throws: string } {
  const run = runTranspiled(src, { mode: "analyze" });
  const r = callTranspiledExportFull(run, fnName, args);
  const lv = litValue(r.result);
  return {
    ok: lv.ok,
    value: lv.ok ? lv.value : undefined,
    throws: r.throws ? formatAbs(r.throws).replace(/\s+#[a-z]+$/, "") : "",
  };
}

describe("Bug 2: generator terminal return value survives to the first done:true", () => {
  it("yield 1; return 9 → 第二个 next() 的 value 是 9（native 9，引擎此前 undefined）", () => {
    const r = litOf(
      `export function f() { function* g() { yield 1; return 9; } const it = g(); it.next(); return it.next().value; }`,
      "f",
    );
    expect(r.ok).toBe(true);
    expect(r.value).toBe(9);
  });

  it("交付 next 的 done:true（值域 + 完成位同钉）", () => {
    const r = evalSrc(
      `export function f() { function* g() { yield 1; return 9; } const it = g(); it.next(); const n = it.next(); return [n.value, n.done]; }`,
      "f",
    );
    expect(r.value).toBe("[9, true]");
  });

  it("裸 return：g().next() → {value: 5, done: true}（native 5，引擎此前 undefined）", () => {
    const r = litOf(
      `export function f() { function* g() { return 5; } return g().next().value; }`,
      "f",
    );
    expect(r.ok).toBe(true);
    expect(r.value).toBe(5);
  });

  it("终末值只交付一次：之后的 next → value undefined（node 实测 {done:true}）", () => {
    const r = litOf(
      `export function f() { function* g() { yield 1; return 9; } const it = g(); it.next(); it.next(); const n = it.next(); return n.done && n.value === undefined; }`,
      "f",
    );
    expect(r.ok).toBe(true);
    expect(r.value).toBe(true);
  });

  it("it.return(9) 后的 next → value undefined（node 实测）", () => {
    const r = litOf(
      `export function f() { function* g() { yield 1; } const it = g(); it.return(9); const n = it.next(); return n.done && n.value === undefined; }`,
      "f",
    );
    expect(r.ok).toBe(true);
    expect(r.value).toBe(true);
  });

  it("控制组：首个 next 仍产出 yield 值（链不回退）", () => {
    const r = litOf(
      `export function f() { function* g() { yield 1; return 9; } return g().next().value; }`,
      "f",
    );
    expect(r.ok).toBe(true);
    expect(r.value).toBe(1);
  });

  it("控制组：早退 return（具体条件分支）→ {value: 42, done: true}", () => {
    const r = litOf(
      `export function f() { function* g() { yield 0; if (true) { return 42; } yield 1; } const it = g(); it.next(); return it.next().value; }`,
      "f",
    );
    expect(r.ok).toBe(true);
    expect(r.value).toBe(42);
  });

  it("控制组：空生成器 / 无 return 体的终末值保持 undefined（不回退）", () => {
    const empty = litOf(
      `export function f() { function* g() {} const n = g().next(); return n.done && n.value === undefined; }`,
      "f",
    );
    expect(empty.ok).toBe(true);
    expect(empty.value).toBe(true);
    const noRet = litOf(
      `export function f() { function* g() { yield 1; } const it = g(); it.next(); const n = it.next(); return n.done && n.value === undefined; }`,
      "f",
    );
    expect(noRet.ok).toBe(true);
    expect(noRet.value).toBe(true);
  });

  it("控制组：yield* 委托表达式值仍保守 unknown（既有口径，Bug 82 注释）", () => {
    const r = evalSrc(
      `export function f() { function* inner() { return 42; } function* outer() { const v = yield* inner(); yield v; } return [...outer()]; }`,
      "f",
    );
    expect(r.value).toContain("unknown");
  });
});

describe("Bug 34: generator-body exceptions propagate to the consumer, not silently truncated", () => {
  it("yield* {}：首个 next() 抛 TypeError（native TypeError，引擎此前 {done:true}）", () => {
    const r = evalSrc(
      `export function f() { function* g() { yield* {}; } return g().next().done; }`,
      "f",
    );
    expect(r.throws).toContain("TypeError");
  });

  it("yield* {}：消费方 catch 到 TypeError（e.name 面）", () => {
    const r = litOf(
      `export function f() { function* g() { yield* {}; } try { g().next(); return "no"; } catch (e) { return e.name; } }`,
      "f",
    );
    expect(r.ok).toBe(true);
    expect(r.value).toBe("TypeError");
  });

  it("[...g()] 矩阵：yield* {} / yield* 1 / yield* null → TypeError（引擎此前 []）", () => {
    for (const operand of ["{}", "1", "null"]) {
      const r = evalSrc(
        `export function f() { function* g() { yield* ${operand}; } return [...g()].length; }`,
        "f",
      );
      expect(r.throws).toContain("TypeError");
    }
  });

  it("显式 throw new Error(\"x\")：[...g()] 抛 Error（native 抛 \"x\"；名字面精度）", () => {
    const r = evalSrc(
      `export function f() { function* g() { throw new Error("x"); } return [...g()].length; }`,
      "f",
    );
    expect(r.throws).toContain("Error");
  });

  it("运行时抛错（null.x）：首个 next 产出 yield 前缀，第二个 next 抛 TypeError", () => {
    const prefix = litOf(
      `export function f() { function* g() { yield 1; null.x; } const it = g(); return it.next().value; }`,
      "f",
    );
    expect(prefix.ok).toBe(true);
    expect(prefix.value).toBe(1);
    const boom = litOf(
      `export function f() { function* g() { yield 1; null.x; } const it = g(); it.next(); try { it.next(); return "no"; } catch (e) { return e.name; } }`,
      "f",
    );
    expect(boom.ok).toBe(true);
    expect(boom.value).toBe("TypeError");
  });

  it("静默截断修复：yield 1; yield* {} → [...g()].join() 抛 TypeError（引擎此前 \"1\"）", () => {
    const r = evalSrc(
      `export function f() { function* g() { yield 1; yield* {}; } return [...g()].join(); }`,
      "f",
    );
    expect(r.throws).toContain("TypeError");
  });

  it("for-of 消费：yield* {} 的生成器迭代抛 TypeError（引擎此前 0 次迭代）", () => {
    const r = evalSrc(
      `export function f() { function* g() { yield* {}; } let t = 0; for (const v of g()) { t++; } return t; }`,
      "f",
    );
    expect(r.throws).toContain("TypeError");
  });

  it("异常交付后生成器 done：后续 next → {done:true}（node 实测）", () => {
    const r = litOf(
      `export function f() { function* g() { throw new TypeError("t"); } const it = g(); try { it.next(); } catch (e) {} const n = it.next(); return n.done; }`,
      "f",
    );
    expect(r.ok).toBe(true);
    expect(r.value).toBe(true);
  });

  it("委托链传播：outer yield* 内层抛错生成器 → [...outer()] 抛 TypeError", () => {
    const r = evalSrc(
      `export function f() { function* inner() { yield* {}; } function* outer() { yield 1; yield* inner(); } return [...outer()].length; }`,
      "f",
    );
    expect(r.throws).toContain("TypeError");
  });

  it("数组解构消费：const [a] = g()（体内抛错）→ TypeError（GetIterator + next 链路）", () => {
    const r = evalSrc(
      `export function f() { function* g() { yield* {}; } const [a] = g(); return a; }`,
      "f",
    );
    expect(r.throws).toContain("TypeError");
  });

  it("Array.from 消费：体内抛错 → TypeError（迭代链路同口径）", () => {
    const r = evalSrc(
      `export function f() { function* g() { yield 1; yield* {}; } return Array.from(g()).length; }`,
      "f",
    );
    expect(r.throws).toContain("TypeError");
  });

  it("构造期全操作：g() 本身不抛（Bug 58 口径保持）", () => {
    const r = evalSrc(
      `export function f() { function* g() { yield* {}; throw new Error("x"); } const it = g(); return typeof it.next; }`,
      "f",
    );
    expect(r.value).toBe('"function"');
    // 空 throws 面折 never（空生成器无延迟异常、构造期不表面）
    expect(r.throws).toBe("never");
    expect(r.kinds).toEqual([]);
  });

  it("gate 面：yield* x（x:any）在被消费的生成器内 → may-throw FLAGGED（此前静默）", () => {
    const r = evalSrc(
      `export function f(x) { function* g() { yield* x; } return [...g()].length; }`,
      "f",
      [anyAbs],
    );
    expect(r.kinds).toContain("TypeError");
  });

  it("gate 面：next() 消费同样重记体内 soft may-throw", () => {
    const r = evalSrc(
      `export function f(x) { function* g() { yield* x; yield 1; } const it = g(); return it.next().done; }`,
      "f",
      [anyAbs],
    );
    expect(r.kinds).toContain("TypeError");
  });

  it("gate 控制组：for (const v of x)（x:any）→ FLAGGED（既有口径）", () => {
    const r = evalSrc(
      `export function f(x) { for (const v of x) {} return 1; }`,
      "f",
      [anyAbs],
    );
    expect(r.kinds).toContain("TypeError");
  });

  it("Bug 58 张力钉：仅构造不消费（生成器自身为入口）→ 调用面仍静默", () => {
    const r = evalSrc(
      `export function* g(x) { yield x.a; }`,
      "g",
      [anyAbs],
    );
    expect(r.kinds).toEqual([]);
    expect(r.throws).not.toContain("TypeError");
  });

  it("控制组：yield* [1,2] 有效委托 → \"1,2\"（迭代路径不回退）", () => {
    const r = evalSrc(
      `export function f() { function* g() { yield* [1, 2]; } return [...g()].join(); }`,
      "f",
    );
    expect(r.value).toBe("\"1,2\"");
  });

  it("控制组（生成器外，既有行为）：for-of/spread/解构非可迭代仍 TypeError", () => {
    const forOf = evalSrc(`export function f() { for (const x of {}) { } return 1; }`, "f");
    expect(forOf.throws).toContain("TypeError");
    const spread = evalSrc(`export function f() { return [...{}].length; }`, "f");
    expect(spread.throws).toContain("TypeError");
    const destructure = evalSrc(`export function f() { const [a] = {}; return a; }`, "f");
    expect(destructure.throws).toContain("TypeError");
  });
});
