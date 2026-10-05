/**
 * 算子守卫 throws 域回归（bug-report wave 1：Bug 2/3/4/5/10/12/14/70）。
 * 不变量：原生异常不得折成 result=unknown/any, throws=never（假「保证不抛」）；
 * 反向（Bug 3/14/70 控制组）：总函数不得假报 may-throw。
 * 原生语义以 node v26 为准（delete (1).a 原生**不抛**——装箱临时对象上
 * delete 恒 true；bug 报告中 prim 接收者恒抛的表述以 node 实测为准）。
 */
import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  $call,
  $in,
  $instanceof,
  $instanceofNonIdent,
  $delRes,
  $idx,
  $arr,
  $lit,
  abs,
  formatAbs,
  litValue,
  isNudoThrow,
} from "@nudojs/core";
import {
  runWithMayThrowSession,
  setMayThrowCollector,
  type MayThrowEffect,
} from "../exec/may-throw.ts";

const anyAbs = abs({ k: "any" }, undefined, undefined, "path");
const objAbs = abs(
  { k: "obj", slots: { a: { value: $lit(1) } } },
  undefined,
  undefined,
  "exact",
);

function throwsNudoThrow(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch (e) {
    return isNudoThrow(e);
  }
}

function collectEffects(fn: () => unknown): MayThrowEffect[] {
  const effects: MayThrowEffect[] = [];
  runWithMayThrowSession(() => {
    setMayThrowCollector((e) => effects.push(e));
    try {
      fn();
    } catch {
      /* NudoThrow 由调用边界收成 throws，不进效果列表 */
    }
    setMayThrowCollector(null);
  });
  return effects;
}

/** 源级求值：返回 { value, throws, effects } 三面 */
function evalSrc(
  src: string,
  fnName = "f",
  args: unknown[] = [anyAbs],
): { value: string; throws: string; effects: string[] } {
  const run = runTranspiled(src, { mode: "analyze" });
  const effects: MayThrowEffect[] = [];
  let result: { result?: unknown; throws?: unknown } = {};
  runWithMayThrowSession(() => {
    setMayThrowCollector((e) => effects.push(e));
    try {
      result = callTranspiledExportFull(run, fnName, args as never[]) as never;
    } catch {
      /* 入口整抛：效果经 throws 面表达 */
    }
    setMayThrowCollector(null);
  });
  const norm = (a: unknown): string => formatAbs(a as never)?.replace(/\s+#[a-z]+$/, "") ?? "";
  return {
    value: norm(result.result ?? $lit(undefined)),
    throws: norm(result.throws),
    effects: [...new Set(effects.map((e) => e.kind))],
  };
}

// --- Bug 2：$call / $new 非函数 callee -----------------------------------

describe("Bug 2: $call/$new on non-function callee", () => {
  it("prim / nullish 字面量 callee → hard NudoThrow（definite TypeError）", () => {
    expect(throwsNudoThrow(() => $call($lit(null), []))).toBe(true);
    expect(throwsNudoThrow(() => $call($lit(1), []))).toBe(true);
    expect(throwsNudoThrow(() => $call($lit("s"), []))).toBe(true);
  });

  it("any callee → may TypeError；unknown（引擎令牌）不记；值域保持 unknown", () => {
    const effects = collectEffects(() => $call(anyAbs, []));
    expect(effects.map((e) => e.kind)).toContain("TypeError");
    const unknownCallee = abs({ k: "unknown" }, undefined, undefined, "path");
    expect(collectEffects(() => $call(unknownCallee, [])).length).toBe(0);
    const r = $call(abs({ k: "unknown" }, undefined, undefined, "path"), []);
    expect(formatAbs(r)).toContain("unknown");
  });

  it("source: null() / (1)() / new null() → entry throws TypeError", () => {
    expect(evalSrc(`export function f() { return null(); }`, "f", []).throws).toContain("TypeError");
    expect(evalSrc(`export function f() { return (1)(); }`, "f", []).throws).toContain("TypeError");
    expect(evalSrc(`export function f() { return new null(); }`, "f", []).throws).toContain("TypeError");
  });

  it("source: cb() 无约束 callee → may TypeError（效果通道）", () => {
    const r = evalSrc(`export function f(cb) { return cb(); }`);
    expect(r.effects).toContain("TypeError");
  });
});

// --- Bug 3：可选链 x?.a 不得假报 may-throw -------------------------------

describe("Bug 3: optional chain single guarded access is total", () => {
  it("x?.a → 无 TypeError 效果（此前 noteAnyMemberMayThrow 假报）", () => {
    const r = evalSrc(`export function f(x) { return x?.a; }`);
    expect(r.effects).not.toContain("TypeError");
    expect(r.throws).not.toContain("TypeError");
  });

  it("x?.[0] → 无 TypeError 效果（计算键首跳同守卫）", () => {
    const r = evalSrc(`export function f(x) { return x?.[0]; }`);
    expect(r.effects).not.toContain("TypeError");
  });

  it("null?.a → undefined，无效果", () => {
    const r = evalSrc(`export function f() { return null?.a; }`, "f", []);
    expect(r.effects).not.toContain("TypeError");
  });

  it("x?.a.b / x?.() / x?.a() 仍 may TypeError（不过度抑制）", () => {
    expect(evalSrc(`export function f(x) { return x?.a.b; }`).effects).toContain("TypeError");
    expect(evalSrc(`export function f(x) { return x?.(); }`).effects).toContain("TypeError");
    expect(evalSrc(`export function f(x) { return x?.a(); }`).effects).toContain("TypeError");
  });
});

// --- Bug 4：in 非对象 RHS -------------------------------------------------

describe("Bug 4: 'in' on non-object RHS", () => {
  it("prim/nullish RHS → hard NudoThrow（definite TypeError）", () => {
    expect(throwsNudoThrow(() => $in($lit("a"), $lit(null)))).toBe(true);
    expect(throwsNudoThrow(() => $in($lit("a"), $lit(1)))).toBe(true);
    expect(throwsNudoThrow(() => $in($lit("a"), $lit(true)))).toBe(true);
  });

  it("any RHS → may TypeError，值域 boolean", () => {
    const effects = collectEffects(() => $in($lit("a"), anyAbs));
    expect(effects.map((e) => e.kind)).toContain("TypeError");
    expect(litValue($in($lit("a"), objAbs))).toEqual({ ok: true, value: true });
  });

  it("source: 'a' in null → entry throws；'a' in {} → total", () => {
    expect(evalSrc(`export function f() { return "a" in null; }`, "f", []).throws).toContain("TypeError");
    const ok = evalSrc(`export function f() { return "a" in {}; }`, "f", []);
    expect(ok.throws).not.toContain("TypeError");
    expect(ok.effects).not.toContain("TypeError");
  });
});

// --- Bug 5：instanceof RHS 校验 + nullish LHS 精确 false ------------------

describe("Bug 5: instanceof non-object RHS / nullish LHS", () => {
  it("非对象 RHS → hard NudoThrow（ident 与 non-ident 两路）", () => {
    expect(throwsNudoThrow(() => $instanceof($lit(1), "C", $lit(null)))).toBe(true);
    expect(throwsNudoThrow(() => $instanceof($lit(1), "undefined", $lit(undefined)))).toBe(true);
    expect(throwsNudoThrow(() => $instanceofNonIdent($lit(1), $lit(1)))).toBe(true);
  });

  it("any RHS → may TypeError；boolean 值域保持", () => {
    const effects = collectEffects(() => $instanceof(anyAbs, "C", anyAbs));
    expect(effects.map((e) => e.kind)).toContain("TypeError");
  });

  it("nullish LHS → 精确 false（原生不抛，此前折 unknown）", () => {
    const r = $instanceof($lit(null), "Object");
    expect(litValue(r)).toEqual({ ok: true, value: false });
    const r2 = $instanceof($lit(undefined), "Object");
    expect(litValue(r2)).toEqual({ ok: true, value: false });
  });

  it("source: x instanceof null/undefined/1 → throws TypeError", () => {
    expect(evalSrc(`export function f(x) { return x instanceof null; }`).throws).toContain("TypeError");
    expect(evalSrc(`export function f(x) { return x instanceof undefined; }`).throws).toContain("TypeError");
    expect(evalSrc(`export function f(x) { return x instanceof 1; }`).throws).toContain("TypeError");
  });

  it("source: null instanceof Object → 精确 false，无效果", () => {
    const r = evalSrc(`export function f() { return null instanceof Object; }`, "f", []);
    expect(r.value).toBe("false");
    expect(r.effects).not.toContain("TypeError");
  });
});

// --- Bug 10：delete 非对象接收者 ------------------------------------------

describe("Bug 10: delete on nullish/any receiver", () => {
  it("nullish 接收者 → hard NudoThrow（definite TypeError）", () => {
    expect(throwsNudoThrow(() => $delRes($lit(null), $lit("a")))).toBe(true);
    expect(throwsNudoThrow(() => $delRes($lit(undefined), $lit("a")))).toBe(true);
  });

  it("非 nullish prim 接收者原生不抛（装箱临时对象 delete 恒 true）→ 不硬抛", () => {
    expect(throwsNudoThrow(() => $delRes($lit(1), $lit("a")))).toBe(false);
    expect(throwsNudoThrow(() => $delRes($lit("s"), $lit("a")))).toBe(false);
  });

  it("any 接收者 → may TypeError", () => {
    const effects = collectEffects(() => $delRes(anyAbs, $lit("a")));
    expect(effects.map((e) => e.kind)).toContain("TypeError");
  });

  it("source: delete null.a → throws；delete (1).a → total（node 实测）", () => {
    expect(evalSrc(`export function f() { delete null.a; return 1; }`, "f", []).throws).toContain("TypeError");
    const ok = evalSrc(`export function f() { delete (1).a; return 1; }`, "f", []);
    expect(ok.throws).not.toContain("TypeError");
    expect(ok.value).toBe("1");
  });
});

// --- Bug 12：计算成员读 $idx 守卫 -----------------------------------------

describe("Bug 12: computed member read $idx guards", () => {
  it("nullish 接收者 → hard NudoThrow（与 $get 同源）", () => {
    expect(throwsNudoThrow(() => $idx($lit(null), $lit(0)))).toBe(true);
    expect(throwsNudoThrow(() => $idx($lit(undefined), $lit("k")))).toBe(true);
  });

  it("any 接收者 → may TypeError，结果保持 any", () => {
    const effects = collectEffects(() => $idx(anyAbs, $lit(0)));
    expect(effects.map((e) => e.kind)).toContain("TypeError");
  });

  it("数组接收者照常精确（不误伤）", () => {
    const r = $idx($arr([$lit(7)]), $lit(0));
    expect(litValue(r)).toEqual({ ok: true, value: 7 });
  });

  it("source: null[0] → throws；x[0] → may（效果通道）；null['a'] 控制组不变", () => {
    expect(evalSrc(`export function f() { return null[0]; }`, "f", []).throws).toContain("TypeError");
    const may = evalSrc(`export function f(x) { return x[0]; }`);
    expect(may.effects).toContain("TypeError");
    expect(evalSrc(`export function f() { return null["a"]; }`, "f", []).throws).toContain("TypeError");
  });
});

// --- Bug 14：typeof 未声明标识符豁免 --------------------------------------

describe("Bug 14: typeof undeclared identifier is total", () => {
  it("typeof undeclaredX → 'undefined'，无 ReferenceError", () => {
    const r = evalSrc(`export function f() { return typeof undeclaredX; }`, "f", []);
    expect(r.value).toBe('"undefined"');
    expect(r.effects).not.toContain("ReferenceError");
    expect(r.throws).not.toContain("ReferenceError");
  });

  it("typeof window !== 'undefined' → false（feature-detection 惯用形）", () => {
    const r = evalSrc(`export function g() { return typeof window !== "undefined"; }`, "g", []);
    expect(r.value).toBe("false");
    expect(r.effects).not.toContain("ReferenceError");
  });

  it("裸读未声明 → 仍 ReferenceError；TDZ typeof → 仍 ReferenceError", () => {
    expect(evalSrc(`export function f() { return undeclaredX; }`, "f", []).throws).toContain("ReferenceError");
    expect(evalSrc(`export function f() { return typeof x; let x = 1; }`, "f", []).throws).toContain("ReferenceError");
  });

  it("绑定标识符 typeof 值不变", () => {
    expect(evalSrc(`export function f() { const x = 1; return typeof x; }`, "f", []).value).toBe('"number"');
  });
});

// --- Bug 70：prim 接收者缺失方法调用 --------------------------------------

describe("Bug 70: method call missing on prim receiver", () => {
  it("'ab'.map(fn) / (1).foo() / (true).x() → may TypeError", () => {
    expect(evalSrc(`export function f() { return "ab".map((c) => c); }`, "f", []).effects).toContain("TypeError");
    expect(evalSrc(`export function f() { return (1).foo(); }`, "f", []).effects).toContain("TypeError");
    expect(evalSrc(`export function f() { return (true).x(); }`, "f", []).effects).toContain("TypeError");
  });

  it("原型上真实存在（含未建模/装箱 Object.prototype）的方法不得假报", () => {
    // trimStart 未建模（Bug 72）但原生存在 → 不得 TypeError
    expect(evalSrc(`export function f() { return " ab".trimStart(); }`, "f", []).effects).not.toContain("TypeError");
    expect(evalSrc(`export function f() { return (1).toFixed(2); }`, "f", []).effects).not.toContain("TypeError");
    expect(evalSrc(`export function f() { return (1).hasOwnProperty("a"); }`, "f", []).effects).not.toContain("TypeError");
    expect(evalSrc(`export function f() { return "ab".charAt(0); }`, "f", []).effects).not.toContain("TypeError");
  });

  it("控制组：值域不变（charAt 精确 / toFixed 精确）", () => {
    expect(evalSrc(`export function f() { return "ab".charAt(0); }`, "f", []).value).toBe('"a"');
    expect(evalSrc(`export function f() { return (1).toFixed(2); }`, "f", []).value).toBe('"1.00"');
  });
});
