/**
 * 类 D（语义特判遗漏）回归（Bug 13/14/17/18/20/25/33/34/36/37/40/42/44/60）：
 * - Bug 13：s.split(/re/) 假 may-throw（RegExp 分隔符走 @@split 委托，
 *   从不 ToString(separator)）。
 * - Bug 14：Reflect.apply(f, thisArg, argsList) 假 unknown + 假 may-throw
 *   （镜像 $invoke 的 apply 真复放；fn target 恒可调用）。
 * - Bug 17/20：JSON.stringify 闭内建 brand / 闭 obj·prim 槽 / arr·
 *   non-bigint 元素 → 假 may-throw（三由头——BigInt 成员/循环/抛错
 *   toJSON——均不可能）。
 * - Bug 18：o?.m?.()（prim string/number 接收者 + 原型方法）→ 错误具体值
 *   undefined（T4 的方法值读通道已根治——本文件钉住该面防回归）。
 * - Bug 25：算术算子以内建 brand 为操作数 → 假 unknown + 假 may-throw
 *   （+ 错误域 number|string）；ToPrimitive 折 prim（Date → time value、
 *   装箱 → [[PrimitiveValue]]、其余 → toString → string）。
 * - Bug 33：表达式位 [1,2,3].splice(1,1,9) / copyWithin → unknown。
 * - Bug 34：arr-of-union 渲染缺括号（3 | 1 | 2[] → (3 | 1 | 2)[]）。
 * - Bug 36/37：Promise 拒绝通道（reject(v)/executor reject(v)/catch/两参
 *   then）+ then 的 nullish handler ≡ Identity。
 * - Bug 40：BigInt(x)（抽象 number/string prim）漏报 may-throw
 *   RangeError/SyntaxError。
 * - Bug 42：new URL(...).toJSON() → 假 unknown（原生 href string）。
 * - Bug 44：rest 形参签名符号执行塌缩固定 1 元组 → 开放数组注入。
 * - Bug 60：delete o?.a 引擎假抛（原生恒 true——nullish 短路）。
 *
 * 原生 ground truth：node v26 实测对照。
 */
import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  litValue,
  formatAbs,
  abs,
  formatShape,
  checkSource,
  pTrue,
} from "@nudojs/core";
import {
  runWithMayThrowSession,
  setMayThrowCollector,
  type MayThrowEffect,
} from "../exec/may-throw.ts";
import { STD_NUDO_SRC, stdOpts } from "./nudo-constraints.ts";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

function fmt(a: unknown): string {
  return formatAbs(a as never)?.replace(/\s+#[a-z]+$/, "") ?? "";
}

function evalWithArgs(
  src: string,
  args: unknown[],
  fnName = "f",
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
    value: norm(result.result),
    throws: norm(result.throws),
    effects: [...new Set(effects.map((e) => e.kind))],
  };
}

const strAbs = abs({ k: "prim", type: "string" }, undefined, undefined, "path");
const numAbs = abs({ k: "prim", type: "number" }, undefined, undefined, "path");

describe("Bug 13: s.split(/re/)（RegExp 分隔符）不记假 ToString may-throw", () => {
  it("抽象 string 接收者 × RegExp brand 分隔符：string[] 域 + 零 throws 效果", () => {
    const r = evalWithArgs(`export function f(s) { return s.split(/a/); }`, [strAbs]);
    expect(r.value).toBe("string[]");
    expect(r.effects).toEqual([]); // 原生 GetMethod(@@split) 委托，从不 ToString(separator)
  });

  it("字符串分隔符控制组不变；obj 分隔符 may 面保持", () => {
    const ctrl = evalWithArgs(`export function f(s) { return s.split("a"); }`, [strAbs]);
    expect(ctrl.value).toBe("string[]");
    expect(ctrl.effects).toEqual([]);
    // obj 分隔符（无 @@split）回退路径 ToString may throw（Symbol 载体）——保持
    const objMay = evalWithArgs(
      `export function f(s, sep) { return s.split(sep); }`,
      [strAbs, abs({ k: "obj", slots: {} }, undefined, undefined, "path")],
    );
    expect(objMay.effects).toContain("TypeError");
  });
});

describe("Bug 14: Reflect.apply 字面量 fn + argsList 精确复放", () => {
  it("Math.max / 箭头 fn：exact 折叠 + 零 throws 效果（fn target 恒可调用）", () => {
    const r = call(`export function f() { return Reflect.apply(Math.max, null, [1, 2]); }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: 2 });
    const r2 = call(`export function f() { const g = (x) => x + 1; return Reflect.apply(g, null, [1]); }`);
    expect(litValue(r2.result)).toEqual({ ok: true, value: 2 });
  });

  it("抽象 argsList（arr）→ 单元素槽位保守；不可调用 prim target 定抛", () => {
    const r = evalWithArgs(
      `export function f(xs) { return Reflect.apply(Math.max, null, xs); }`,
      [abs({ k: "arr", element: numAbs }, undefined, undefined, "path")],
    );
    expect(r.throws).toBe("never");
    const bad = call(`export function f() { return Reflect.apply(1, null, []); }`);
    expect(fmt(bad.throws)).toContain("TypeError");
  });
});

describe("Bug 17/20: JSON.stringify 三由头不可能面不记 may-throw", () => {
  it("Bug 17：闭内建 brand 接收者——精确折叠 + 零 throws 效果", () => {
    // RegExp/Map/Set/Error 家族 → "{}"；URL → href；Date(tv) → ISO 串
    const cases: Array<[string, string]> = [
      [`export function f() { return JSON.stringify(/a/g); }`, `"{}"`],
      [`export function f() { return JSON.stringify(new Map()); }`, `"{}"`],
      [`export function f() { return JSON.stringify(new Set()); }`, `"{}"`],
      [`export function f() { return JSON.stringify(new Error("m")); }`, `"{}"`],
      // URL → JSON 文本（串内容含引号）；formatAbs 再 JSON.stringify 展示
      [`export function f() { return JSON.stringify(new URL("https://x.com/a")); }`, JSON.stringify('"https://x.com/a"')],
    ];
    for (const [src, want] of cases) {
      const r = evalWithArgs(src, []);
      expect(r.value).toBe(want);
      expect(r.effects).toEqual([]);
    }
    // Date 带 tv 槽 → toISOString 精确；无 tv → string 域（均 total）
    const d0 = evalWithArgs(`export function f() { return JSON.stringify(new Date(0)); }`, []);
    expect(d0.value).toBe(JSON.stringify('"1970-01-01T00:00:00.000Z"'));
    expect(d0.effects).toEqual([]);
  });

  it("Bug 20：闭 obj·prim 槽 / arr·non-bigint 元素——string 域不记 may-throw", () => {
    const r = evalWithArgs(
      `export function f(o) { return JSON.stringify(o); }`,
      [
        abs(
          { k: "obj", slots: { a: { value: numAbs } } },
          undefined,
          undefined,
          "path",
        ),
      ],
    );
    expect(r.value).toBe("string");
    expect(r.effects).toEqual([]);
    const r2 = evalWithArgs(
      `export function f(xs) { return JSON.stringify(xs); }`,
      [abs({ k: "arr", element: numAbs }, undefined, undefined, "path")],
    );
    expect(r2.value).toBe("string");
    expect(r2.effects).toEqual([]);
  });

  it("any 接收者 may-throw 面保持（可携带 BigInt）", () => {
    const r = evalWithArgs(`export function f(x) { return JSON.stringify(x); }`, [
      abs({ k: "any" }, undefined, undefined, "path"),
    ]);
    expect(r.effects).toContain("TypeError");
  });
});

describe("Bug 18: o?.m?.() prim 接收者 + 原型方法（T4 通道钉住）", () => {
  it("可选调用链对 prim string/number 接收者路由原方法派发（无 undefined 臂）", () => {
    const up = evalWithArgs(`export function f(s) { return s?.toUpperCase?.(); }`, [strAbs]);
    expect(up.value).toBe("string");
    expect(up.effects).toEqual([]);
    const split = evalWithArgs(`export function f(s) { return s?.split?.("a"); }`, [strAbs]);
    expect(split.value).toBe("string[]");
    const fixed = evalWithArgs(`export function f(x) { return x?.toFixed?.(2); }`, [numAbs]);
    expect(fixed.value).toBe("string");
  });

  it("方法值读 s.toUpperCase → 一等 fn（原生 function）", () => {
    const r = evalWithArgs(`export function f(s) { return s.toUpperCase; }`, [strAbs]);
    expect(r.value).toContain("=>");
    expect(r.value).not.toContain("undefined");
  });
});

describe("Bug 25: 内建 brand 算术操作数 ToPrimitive 折叠", () => {
  it("Date：数值算子 → time value 精确；+ → string 域；< → boolean", () => {
    const sub = call(`export function f() { return new Date(0) - 1; }`);
    expect(litValue(sub.result)).toEqual({ ok: true, value: -1 });
    expect(fmt(sub.throws)).toBe("never");
    const mul = call(`export function f() { return new Date(0) * 1; }`);
    expect(litValue(mul.result)).toEqual({ ok: true, value: 0 });
    const add = call(`export function f() { return new Date(0) + 1; }`);
    expect(fmt(add.result)).toBe("string"); // @@toPrimitive default=string（ES 特判）
    expect(fmt(add.throws)).toBe("never");
    const cmp = call(`export function f() { return new Date(0) < new Date(1); }`);
    expect(litValue(cmp.result)).toEqual({ ok: true, value: true });
    const neg = call(`export function f() { return -new Date(0); }`);
    expect(litValue(neg.result)).toEqual({ ok: true, value: -0 });
    const num = call(`export function f() { return Number(new Date(0)); }`);
    expect(litValue(num.result)).toEqual({ ok: true, value: 0 });
  });

  it("RegExp/Map/Set：toString → string → 数值算子 ToNumber（NaN 精确 / number 域）", () => {
    const re = call(`export function f() { return /a/ - 1; }`);
    expect(litValue(re.result)).toEqual({ ok: true, value: NaN });
    const map = call(`export function f() { return new Map() - 1; }`);
    expect(fmt(map.result)).toBe("number");
    expect(fmt(map.throws)).toBe("never");
    // + 恒走 toString（number 臂不可能）
    const add = call(`export function f() { return new Map() + 1; }`);
    expect(fmt(add.result)).toBe("string");
  });

  it("装箱 brand（T2 移交）：new Number(5) 算术 → 数值臂", () => {
    const r = call(`export function f() { return new Number(5) + 1; }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: 6 });
    const r2 = call(`export function f() { return new Number(5) * 2; }`);
    expect(litValue(r2.result)).toEqual({ ok: true, value: 10 });
  });
});

describe("Bug 33: 表达式位 splice / copyWithin 精确折叠", () => {
  it("splice：被删元素 tuple（native [2] / [3] / [1,2,3] / []）", () => {
    expect(fmt(call(`export function f() { return [1,2,3].splice(1,1,9); }`).result)).toBe("[2]");
    expect(fmt(call(`export function f() { return [1,2,3].splice(-1,1); }`).result)).toBe("[3]");
    expect(fmt(call(`export function f() { return [1,2,3].splice(0); }`).result)).toBe("[1, 2, 3]");
    expect(fmt(call(`export function f() { return [1,2,3].splice(1,0,9); }`).result)).toBe("[]");
    expect(fmt(call(`export function f() { return [1,2,3].splice(99,1); }`).result)).toBe("[]");
    const varRecv = call(`export function f() { const a = [1,2,3]; return a.splice(1,1); }`);
    expect(fmt(varRecv.result)).toBe("[2]");
  });

  it("copyWithin：复制后容器（native [2,3,3] / [1,1,2,4] / [1,2,4,4]）", () => {
    expect(fmt(call(`export function f() { return [1,2,3].copyWithin(0,1); }`).result)).toBe("[2, 3, 3]");
    expect(fmt(call(`export function f() { return [1,2,3,4].copyWithin(1,0,2); }`).result)).toBe("[1, 1, 2, 4]");
    expect(fmt(call(`export function f() { return [1,2,3,4].copyWithin(-2,-1); }`).result)).toBe("[1, 2, 4, 4]");
  });

  it("语句位控制组：mutator 重绑路径不变", () => {
    const r = call(`export function f() { const a = [1,2,3,4]; a.copyWithin(0,2); return a; }`);
    expect(fmt(r.result)).toBe("[3, 4, 3, 4]");
  });
});

describe("Bug 34: arr-of-union 渲染加括号", () => {
  it("arr(sum) 元素 → (A | B)[]；单 prim 元素不加冗余括号", () => {
    const r = call(`export function f() { return [3,1,2].sort((a, b) => a - b); }`);
    expect(fmt(r.result)).toBe("(3 | 1 | 2)[]");
    expect(formatShape(abs({ k: "arr", element: strAbs }, undefined, undefined, "path"))).toBe("string[]");
  });
});

describe("Bug 36/37: Promise 拒绝通道 + nullish handler 恒等", () => {
  it("Bug 36：Promise.reject(v) → 拒绝域 never + reason 通道", () => {
    const r = call(`export function f() { return Promise.reject(1); }`);
    expect(fmt(r.result)).toBe("promise<never>");
  });

  it("Bug 36：executor reject(v) → 拒绝通道；catch 回调实参 = reason", () => {
    const ctor = call(`export function f() { return new Promise((res, rej) => rej(1)); }`);
    expect(fmt(ctor.result)).toBe("promise<never>");
    const id = call(`export function f() { return Promise.reject(1).catch((e) => e); }`);
    expect(fmt(id.result)).toBe("promise<1>");
    const konst = call(`export function f() { return Promise.reject(1).catch(() => 5); }`);
    // fulfilled 臂不可能——不 join 原 inner（凭空 unknown 臂消失）
    expect(fmt(konst.result)).toBe("promise<5>");
  });

  it("Bug 36：两参 then 的 onRejected 读实参（此前从未被读取）", () => {
    const r = call(`export function f() { return Promise.reject(1).then(null, (e) => e + 1); }`);
    expect(fmt(r.result)).toBe("promise<2>");
  });

  it("Bug 37：nullish onFulfilled ≡ Identity 透传", () => {
    expect(fmt(call(`export function f() { return Promise.resolve(1).then(null); }`).result)).toBe("promise<1>");
    expect(fmt(call(`export function f() { return Promise.resolve(1).then(undefined); }`).result)).toBe("promise<1>");
    expect(fmt(call(`export function f() { return Promise.resolve(1).then(null, (e) => e); }`).result)).toBe("promise<1>");
    // 缺省 handler 控制组（既有面）
    expect(fmt(call(`export function f() { return Promise.resolve(3).then(); }`).result)).toBe("promise<3>");
  });

  it("resolved 通道控制组：then 映射精度不变", () => {
    expect(fmt(call(`export function f() { return Promise.resolve(1).then((x) => x + 1); }`).result)).toBe("promise<2>");
    expect(fmt(call(`export function f() { return new Promise((r) => r(1)); }`).result)).toBe("promise<1>");
  });
});

describe("Bug 40: BigInt(x) 抽象 prim 漏报 may-throw", () => {
  it("抽象 number → may RangeError；抽象 string → may SyntaxError", () => {
    const r = evalWithArgs(`export function f(x) { return BigInt(x); }`, [numAbs]);
    expect(r.value).toBe("bigint");
    expect(r.effects).toEqual(["RangeError"]); // NumberToBigInt 非整数 → RangeError
    const r2 = evalWithArgs(`export function f(s) { return BigInt(s); }`, [strAbs]);
    expect(r2.value).toBe("bigint");
    expect(r2.effects).toEqual(["SyntaxError"]);
  });

  it("字面量臂 / any 臂控制组不变", () => {
    const lit = call(`export function f() { return BigInt(1.5); }`);
    expect(fmt(lit.throws)).toContain("RangeError");
    const anyR = evalWithArgs(`export function f(x) { return BigInt(x); }`, [
      abs({ k: "any" }, undefined, undefined, "path"),
    ]);
    expect(anyR.effects).toContain("TypeError");
    expect(anyR.effects).toContain("SyntaxError");
    // boolean prim 恒 total
    const boolR = evalWithArgs(`export function f(b) { return BigInt(b); }`, [
      abs({ k: "prim", type: "boolean" }, undefined, undefined, "path"),
    ]);
    expect(boolR.effects).toEqual([]);
  });
});

describe("Bug 42: new URL(...).toJSON() ≡ href", () => {
  it("字面量输入精确折叠 href；抽象输入 string 域", () => {
    const r = call(`export function f() { return new URL("https://x.com/a").toJSON(); }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "https://x.com/a" });
    expect(fmt(r.throws)).toBe("never");
    const absUrl = evalWithArgs(
      `export function f(s) { return new URL(s).toJSON(); }`,
      [strAbs],
    );
    expect(absUrl.value).toBe("string");
  });
});

describe("Bug 44: rest 形参签名 = 开放数组（不塌缩固定 1 元组）", () => {
  /** 泛化面：checkSource 的 signatures —— rest 函数零实参符号执行 */
  function sigOf(src: string, fnName: string): string {
    const r = checkSource("/t/rest.js", src, pTrue, { ...stdOpts, loadModule: () => STD_NUDO_SRC });
    const sig = r.signatures?.find((s) => s.name === fnName);
    return sig?.display ?? "";
  }

  it("rest 形参体：r.length → number（非字面量 1）；r → any[]（非 [any]）", () => {
    const len = sigOf(`export function sigLen(...r) { return r.length; }`, "sigLen");
    expect(len).toContain("number");
    expect(len).not.toMatch(/=> 1\b/);
    const ret = sigOf(`export function sigRet(...r) { return r; }`, "sigRet");
    expect(ret).toContain("any[]");
    expect(ret).not.toContain("[any]");
  });

  it("箭头 rest 同口径；调用面控制组不变（实参个数精确）", () => {
    const arrow = sigOf(`export const arrowRest = (...r) => r.length;`, "arrowRest");
    expect(arrow).toContain("number");
    expect(arrow).not.toMatch(/=> 1\b/);
    const callSite = call(`export function f() { return sigLen(1, 2, 3); }\nexport function sigLen(...r) { return r.length; }`, "f");
    expect(litValue(callSite.result)).toEqual({ ok: true, value: 3 });
  });
});

describe("Bug 60: delete o?.a 恒 total（nullish 短路 true）", () => {
  it("对象接收者 / null 接收者 → true exact（非 unknown/假抛）", () => {
    const r = call(`export function f() { let o = { a: 1 }; return delete o?.a; }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: true });
    expect(fmt(r.throws)).toBe("never");
    const r2 = call(`export function f() { let o = null; return delete o?.a; }`);
    expect(litValue(r2.result)).toEqual({ ok: true, value: true });
    expect(fmt(r2.throws)).toBe("never");
  });

  it("深链：delete o.a?.b——中缀 nullish 短路 true；非可选面照常", () => {
    const r = call(`export function f() { const o = { a: { b: 1 } }; return delete o.a?.b; }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: true });
    const mid = call(`export function f() { const o = { a: null }; return delete o.a?.b; }`);
    expect(litValue(mid.result)).toEqual({ ok: true, value: true });
    // 普通 delete 控制组
    const plain = call(`export function f() { const o = { a: 1 }; return delete o.a; }`);
    expect(litValue(plain.result)).toEqual({ ok: true, value: true });
  });
});
