/**
 * Bug 36 回归：TypedArray 原型回调族（forEach/map/filter/reduce/every/some/
 * find + 同族 findIndex/findLast/findLastIndex/reduceRight）。
 *
 * 此前 TA 实例是 $new 宿主兜底的空 brand（evalBuiltinInstanceMethod 与
 * BUILTIN_BRAND_METHODS 两层派发表皆无 TA 条目），HOF 调用落 $get →
 * undef → unknown：
 * - 非函数回调不抛（native GetCallback 先于任何迭代定抛 TypeError——
 *   零长度 TA 也抛，node 实测）；
 * - 回调闭包体静默不跑（副作用计数器折 wrong-exact 0、回调内 throw 被吞）；
 * - L2 gate 假阴（Array 孪生 [1].forEach(x) 已正确记 may TypeError）。
 *
 * 修复口径：TA brand 按抽象数组视图复用数组 HOF 机器（invokeArrMethod）——
 * 元素域 = TYPED_ARRAY_ELEMENT 的 prim（BigInt64/BigUint64 → bigint），
 * GetCallback 前置校验 + 代表元素回调执行（副作用/抛错传播）+ 返回面对齐
 * 数组 HOF 抽象数组口径（forEach→undefined、every/some→boolean、
 * filter/find→元素域∪undefined、reduce→回调累加域、map→元素域收敛回
 * 元素 prim——native ToNumber/ToBigInt 收敛，回调返回 string 不渗入）。
 */
import { describe, it, expect } from "vitest";
// 相对路径引 src 引擎面（不经 @nudojs/core 别名——本 worktree 的 vite8
// 别名解析会把裸包名落到 dist 旧产物，同 eval-non-callable.test.ts）。
import { runTranspiled, callTranspiledExportFull } from "../exec/run.ts";
import { checkSource } from "../check.ts";
import { litValue, anyAbs, type Abs } from "../abs.ts";
import { formatShape } from "../format.ts";
import { $lit } from "../exec/runtime/state.ts";
import {
  runWithMayThrowSession,
  setMayThrowCollector,
  type MayThrowEffect,
} from "../may-throw.ts";

function run(src: string, args: Abs[] = []) {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, "f", args);
}

function val(src: string, args?: Abs[]) {
  return litValue(run(src, args).result);
}

function shape(src: string, args?: Abs[]) {
  return formatShape(run(src, args).result);
}

/** 原生：GetCallback 非函数定抛 TypeError（try/catch 吸收） */
function expectCaught(src: string) {
  expect(val(src), `caught for: ${src}`).toEqual({ ok: true, value: "caught" });
}

/** 定抛 TypeError：无 try/catch 时 throws 面是 TypeError brand */
function expectTypeError(src: string) {
  const r = run(src);
  const name = r.throws?.shape?.k === "brand"
    ? (r.throws as { shape: { name: string } }).shape.name
    : r.throws?.shape?.k;
  expect(name, `throws for: ${src}`).toBe("TypeError");
}

function check(src: string) {
  return checkSource("/t/eval-ta-hofs.js", src);
}

/** L2 entry-may-throw issue 数（按函数名过滤可选） */
function l2Count(r: ReturnType<typeof check>, fn?: string): number {
  return r.issues.filter(
    (i) => i.code === "nudo:entry-may-throw" && (!fn || i.fn === fn),
  ).length;
}

/** any 实参运行时效果（may-throw 收集器面） */
function effects(src: string): string[] {
  const exports = runTranspiled(src, { mode: "analyze" });
  const eff: MayThrowEffect[] = [];
  runWithMayThrowSession(() => {
    setMayThrowCollector((e) => eff.push(e));
    try {
      callTranspiledExportFull(exports, "f", [anyAbs]);
    } catch {
      /* 入口整抛：效果经 throws 面表达 */
    }
    setMayThrowCollector(null);
  });
  return [...new Set(eff.map((e) => e.kind))];
}

describe("Bug 36：TA HOF 非函数回调定抛 TypeError（GetCallback 前置）", () => {
  it.each([
    ["forEach", `new Uint8Array([1]).forEach(1)`],
    ["map", `new Uint8Array([1]).map(1)`],
    ["filter", `new Uint8Array([1]).filter(1)`],
    ["reduce", `new Uint8Array([1]).reduce(1)`],
    ["every", `new Uint8Array([1]).every(1)`],
    ["some", `new Uint8Array([1]).some(1)`],
    ["find", `new Uint8Array([1]).find(1)`],
  ])("%s(1) → TypeError", (_name, expr) => {
    expectCaught(`export function f() { try { ${expr}; return "no-throw"; } catch (e) { return "caught"; } }`);
    expectTypeError(`export function f() { ${expr}; }`);
  });

  it("零长度 TA 也抛（GetCallback 先于迭代，node 实测）", () => {
    expectCaught(`export function f() { try { new Uint8Array(0).forEach(1); return "no-throw"; } catch (e) { return "caught"; } }`);
  });

  it("undefined / null 回调同抛（HOF 无 undefinedOk 豁免）", () => {
    expectCaught(`export function f() { try { new Uint8Array([1]).forEach(undefined); return "no-throw"; } catch (e) { return "caught"; } }`);
    expectCaught(`export function f() { try { new Uint8Array([1]).map(null); return "no-throw"; } catch (e) { return "caught"; } }`);
  });

  it("对象/数组回调同抛", () => {
    expectCaught(`export function f() { try { new Uint8Array([1]).filter({}); return "no-throw"; } catch (e) { return "caught"; } }`);
    expectCaught(`export function f() { try { new Uint8Array([1]).reduce([1]); return "no-throw"; } catch (e) { return "caught"; } }`);
  });

  it("BigInt 家族同口径（元素域 bigint）", () => {
    expectCaught(`export function f() { try { new BigInt64Array([1n]).map(1); return "no-throw"; } catch (e) { return "caught"; } }`);
    expectCaught(`export function f() { try { new BigUint64Array([1n]).forEach("s"); return "no-throw"; } catch (e) { return "caught"; } }`);
  });

  it("同族其余回调方法（findIndex/findLast/reduceRight）同抛", () => {
    expectCaught(`export function f() { try { new Uint8Array([1]).findIndex(1); return "no-throw"; } catch (e) { return "caught"; } }`);
    expectCaught(`export function f() { try { new Uint8Array([1]).findLast(1); return "no-throw"; } catch (e) { return "caught"; } }`);
    expectCaught(`export function f() { try { new Uint8Array([1]).reduceRight(1); return "no-throw"; } catch (e) { return "caught"; } }`);
  });
});

describe("Bug 36：TA HOF 回调闭包体执行（副作用/抛错传播）", () => {
  it("forEach 回调跑（报告 repro：计数器 wrong-exact 0 → 1）", () => {
    expect(val(`export function f() { let n = 0; new Uint8Array([1]).forEach(() => { n++; }); return n; }`))
      .toEqual({ ok: true, value: 1 });
  });

  it("map 回调跑（计数 + 值使用）", () => {
    expect(val(`export function f() { let n = 0; new Uint8Array([1]).map((x) => { n++; return x; }); return n; }`))
      .toEqual({ ok: true, value: 1 });
  });

  it("回调内外部对象写可见", () => {
    expect(val(`export function f() { const o = { n: 0 }; new Uint8Array([1]).forEach(() => { o.n = 1; }); return o.n; }`))
      .toEqual({ ok: true, value: 1 });
  });

  it("回调元素实参是元素域 number（+ 使用不 NaN 化）", () => {
    expect(shape(`export function f() { let s; new Uint8Array([1]).forEach((v) => { s = v + 1; }); return s; }`))
      .toBe("number");
  });

  it("回调内 throw 传播（TypeError 定抛面）", () => {
    expectCaught(`export function f() { try { new Uint8Array([1]).forEach(() => { throw new TypeError("boom"); }); return "no-throw"; } catch (e) { return "caught"; } }`);
    expectTypeError(`export function f() { new Uint8Array([1]).forEach(() => { throw new TypeError("boom"); }); }`);
  });

  it("回调内 throw 自定义 Error 同传播", () => {
    expectCaught(`export function f() { try { new Uint8Array([1]).map(() => { throw new Error("x"); }); return "no-throw"; } catch (e) { return "caught"; } }`);
  });

  it("every 短路后不再跑回调（谓词具体真值）", () => {
    expect(val(`export function f() { let n = 0; new Uint8Array([1]).some(() => { n++; return true; }); return n; }`))
      .toEqual({ ok: true, value: 1 });
  });
});

describe("Bug 36：TA HOF 返回面对齐数组 HOF 口径", () => {
  it("forEach → undefined", () => {
    expect(shape(`export function f() { return new Uint8Array([1]).forEach(() => {}); }`)).toBe("undefined");
  });

  it("map → 元素域 number[]（ToNumber 收敛，回调返回 string 不渗入）", () => {
    expect(shape(`export function f() { return new Uint8Array([1]).map((x) => x + 1); }`)).toBe("number[]");
    expect(shape(`export function f() { return new Uint8Array([1]).map(() => "s"); }`)).toBe("number[]");
  });

  it("map → BigInt 家族元素域 bigint[]", () => {
    expect(shape(`export function f() { return new BigInt64Array([1n]).map((x) => x + 1n); }`)).toBe("bigint[]");
  });

  it("filter → 元素域 number[]", () => {
    expect(shape(`export function f() { return new Uint8Array([1]).filter((x) => x > 0); }`)).toBe("number[]");
  });

  it("every/some → boolean（长度未建模，诚实不精确）", () => {
    expect(shape(`export function f() { return new Uint8Array([1]).every((x) => x > 0); }`)).toBe("boolean");
    expect(shape(`export function f() { return new Uint8Array([1]).some((x) => x > 0); }`)).toBe("boolean");
  });

  it("find → 元素域 ∪ undefined", () => {
    const s = shape(`export function f() { return new Uint8Array([1]).find((x) => x > 0); }`);
    expect(s).toContain("number");
    expect(s).toContain("undefined");
  });

  it("reduce（带初值）→ 回调累加域 number", () => {
    expect(shape(`export function f() { return new Uint8Array([1]).reduce((a, b) => a + b, 0); }`)).toBe("number");
  });

  it("reduce 无初值 → may TypeError（空 TA 原生抛，与数组口径一致）", () => {
    expect(effects(`export function f() { new Uint8Array([1]).reduce((a, b) => a + b); }`)).toContain("TypeError");
  });
});

describe("Bug 36：L2 gate 面（any 回调记 may TypeError）", () => {
  it("forEach(x)/map(x) 抽象回调 → entry-may-throw", () => {
    const r = check(`
      export function fe(x) { return new Uint8Array([1]).forEach(x); }
      export function mp(x) { return new Uint8Array([1]).map(x); }
      export function fl(x) { return new Uint8Array([1]).filter(x); }
      export function rd(x) { return new Uint8Array([1]).reduce(x); }
      export function ev(x) { return new Uint8Array([1]).every(x); }
      export function sm(x) { return new Uint8Array([1]).some(x); }
      export function fd(x) { return new Uint8Array([1]).find(x); }
    `);
    for (const fn of ["fe", "mp", "fl", "rd", "ev", "sm", "fd"]) {
      expect(l2Count(r, fn), `${fn} L2 issue`).toBeGreaterThan(0);
      expect(
        r.issues.some((i) => i.code === "nudo:entry-may-throw" && i.fn === fn && i.message.includes("TypeError")),
        `${fn} message 含 TypeError`,
      ).toBe(true);
    }
  });

  it("运行时 any 回调效果含 TypeError", () => {
    expect(effects(`export function f(x) { return new Uint8Array([1]).forEach(x); }`)).toContain("TypeError");
    expect(effects(`export function f(x) { return new Uint8Array([1]).map(x); }`)).toContain("TypeError");
  });

  it("具体可调用回调 → gate 静默", () => {
    const r = check(`
      export function ok1() { new Uint8Array([1]).forEach(() => {}); }
      export function ok2() { return new Uint8Array([1]).map((x) => x + 1); }
    `);
    expect(l2Count(r)).toBe(0);
  });

  it("Array 孪生控制组不回退（[1].forEach(x) 仍报）", () => {
    const r = check(`export function af(x) { return [1].forEach(x); }`);
    expect(l2Count(r, "af")).toBeGreaterThan(0);
  });
});

describe("Bug 36：控制组与边界", () => {
  it("typeof ta.forEach === \"function\"（方法值读通道）", () => {
    expect(val(`export function f() { return typeof new Uint8Array([1]).forEach; }`))
      .toEqual({ ok: true, value: "function" });
  });

  it("\"forEach\" in ta → true", () => {
    expect(val(`export function f() { return "forEach" in new Uint8Array([1]); }`))
      .toEqual({ ok: true, value: true });
  });

  it("元素读保持诚实不精确（number ∪ undefined，报告控制行）", () => {
    const s = shape(`export function f() { return new Uint8Array(8)[0]; }`);
    expect(s).toContain("number");
    expect(s).toContain("undefined");
  });

  it("非回调 TA 方法维持 unknown 口径（fill 未建模，不假抛）", () => {
    expect(val(`export function f() { try { new Uint8Array(8).fill(1); return "no-throw"; } catch (e) { return "caught"; } }`))
      .toEqual({ ok: true, value: "no-throw" });
  });
});
