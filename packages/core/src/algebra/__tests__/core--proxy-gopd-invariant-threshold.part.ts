/**
 * Bug 1095 —— Proxy **[[GetOwnProperty]]** 靶一致性不变量的**阈值**回归
 * （ES2024 10.5.5 step 12.f / 24.4.2.1 IsCompatiblePropertyDescriptor）。
 *
 * 症状族：native 不抛，引擎抛 TypeError ⇒ error 级 `nudo:entry-may-throw`
 * ⇒ **CI 闸门假红**（卡死用户仓库）。三处都在
 * `builtins/object/descriptor.ts` 的 `enforceProxyGetOwnPropDescInvariant`
 * （Object 面 / Reflect 面共用此函数）。
 *
 * ── 修前的三处缺陷 ─────────────────────────────────────────────────
 * ① **形态一致性检查（规则 4）没以「靶属性不可配置」为前提**
 *    —— 靶属性**可配置**（默认）时，陷阱报异形态描述符（靶是数据属性、
 *    陷阱报访问器，或反之）⇒ 引擎无条件抛 TypeError；原生**不抛**
 *    （IsCompatiblePropertyDescriptor 只在 current.[[Configurable]] 为
 *    false 时做形态比对）。
 * ② **`frozen` 被当成 `enumerable:false`**
 *    —— `Object.freeze` 只改 writable/configurable，**不改 enumerable**
 *    （原生：`Object.freeze({a:1})` ⇒ writable:false / enumerable:true /
 *    configurable:false）；引擎把 targetEnumerable 算成 false ⇒ 陷阱诚实报
 *    `enumerable:true` ⇒ 规则 3 判不一致 ⇒ 抛 TypeError。
 * ③ **靶侧标志 / extState 只查「内层 obj」，不查「接收者」**
 *    —— defineProperty / freeze / seal 把标志记在**接收者**上（brand 靶 ⇒
 *    记在 brand 上；obj 靶 ⇒ 记在 obj 上），只读内层 obj 的标志表 ⇒ 取不到
 *    ⇒ targetConfigurable 回落成 true ⇒ 与陷阱报的 `configurable:false`
 *    判「不一致」⇒ **即使陷阱报告的描述符与靶完全一致也抛**。
 *
 * ── 修法（descriptor.ts 内，三处最小改动）────────────────────────
 * ① 形态比对收进「靶属性不可配置」分支（与规则 3 同一前提）；
 * ② 靶侧 enumerable 不再叠 `st !== "frozen"`（freeze 不改 enumerable）；
 * ③ 靶侧三标志 + extState 统一走 `currentPropDesc(target, key)`
 *    （**接收者优先、内层兜底**——同文件既有口径，不再漂移）。
 *
 * ── oracle：node v26.10.0 实测（`node -e` 本机跑，2026-10）──────────
 * | # | 靶                                            | 陷阱报告                          | native |
 * |---|-----------------------------------------------|-----------------------------------|--------|
 * | 1 | `{a:1}`（a 可配置·数据）                     | 访问器 {get, configurable:true}     | 不抛   |
 * | 2 | 可配置**访问器** a                           | 数据 {value:2,…,configurable:true} | 不抛   |
 * | 3 | 不可配置数据 a                                | 访问器 {get, configurable:false}    | 抛     |
 * | 4 | 不可配置访问器 a                              | 数据 {value:2,…,configurable:false} | 抛     |
 * | 5 | `Object.freeze({a:1})`                       | {value:1,writable:false,enum:true,cfg:false} | 不抛 |
 * | 6 | `Object.freeze({a:1})`                       | 同上但 writable:true                | 抛     |
 * | 7 | `Object.freeze({a:1})`                       | 同上但 enumerable:false             | 抛     |
 * | 8 | brand 实例 + defineProperty 收紧（非配置·非写） | 与靶完全一致的描述符                | 不抛   |
 * | 9 | 同 8                                         | writable:true                      | 抛     |
 * |10 | 同 8                                         | enumerable:false                   | 抛     |
 * |11 | 同 8                                         | value:2（值不同）                  | 抛     |
 *
 * Object 面与 Reflect 面同口径（node 实测 1/2 两面皆不抛）。
 *
 * ── 已知缺口（**本次不修**：基线同样不抛 ⇒ 非本次回归；新增抛点有
 *    制造新假红的风险 ⇒ 后续单独立项）─────────────────────────────
 * ① 靶不可扩展且该键不存在时，陷阱报 `configurable:true`
 *    ⇒ node v26.10.0 **抛** TypeError，引擎**不抛**（漏抛）。
 * ② 靶不可写 + 不可配置而陷阱**省略 value** 时
 *    ⇒ node v26.10.0 **抛** TypeError，引擎**不抛**（漏抛）。
 * ③ 靶为不可配置**访问器**且陷阱的 get/set 身份与靶不同
 *    ⇒ node v26.10.0 **抛** TypeError，引擎**放过**（漏抛——引擎的访问器
 *    侧表只存 thunk、不存原函数值 ⇒ SameValue 不可判）。
 */
import { describe, it, expect } from "vitest";
import { call, val, throwsError } from "./eval-helpers.ts";
import { issuesOf, l2Count } from "./nudo-constraints.ts";

const wrap = (body: string) => `export function f() { ${body} }`;

/* ── 靶 / 陷阱片段 ─────────────────────────────────────────────── */

/** 可配置的数据属性靶（默认标志：writable/enumerable/configurable 皆 true） */
const DATA_CFG = `const t = { a: 1 };`;

/** 可配置的访问器属性靶 */
const ACC_CFG = `const t = {}; Object.defineProperty(t, "a", { get(){ return 1; }, enumerable: true, configurable: true });`;

/** 不可配置的数据属性靶（writable:true / enumerable:true / configurable:false） */
const DATA_NONCFG = `const t = {}; Object.defineProperty(t, "a", { value: 1, writable: true, enumerable: true, configurable: false });`;

/** 不可配置的访问器属性靶（enumerable 缺省 ⇒ false） */
const ACC_NONCFG = `const t = {}; Object.defineProperty(t, "a", { get(){ return 1; }, configurable: false });`;

/** 冻结靶（writable:false / enumerable:true / configurable:false） */
const FROZEN = `const t = Object.freeze({ a: 1 });`;

/** brand 靶（类实例）+ defineProperty 收紧标志（记在**接收者 brand** 上） */
const BRAND_TIGHT = `class A { constructor(){ this.a = 1; } }
const t = new A();
Object.defineProperty(t, "a", { value: 1, writable: false, enumerable: true, configurable: false });`;

/** 陷阱：报访问器描述符（configurable 决定可配置档） */
const TRAP_ACC = (configurable: boolean) =>
  `const p = new Proxy(t, { getOwnPropertyDescriptor(){ return { get(){ return 2; }, configurable: ${configurable} }; } });`;

/** 陷阱：报数据描述符（value 恒 2 ⇒ 与靶值不同 ⇒ 靶不可写时必抛） */
const TRAP_DATA = (configurable: boolean) =>
  `const p = new Proxy(t, { getOwnPropertyDescriptor(){ return { value: 2, writable: true, enumerable: true, configurable: ${configurable} }; } });`;

/** 陷阱：报「与靶完全一致」的冻结数据描述符 */
const TRAP_FROZEN_HONEST = `const p = new Proxy(t, { getOwnPropertyDescriptor(){ return { value: 1, writable: false, enumerable: true, configurable: false }; } });`;

/** 陷阱：报与 brand 靶完全一致的描述符 */
const TRAP_TIGHT_HONEST = `const p = new Proxy(t, { getOwnPropertyDescriptor(){ return { value: 1, writable: false, enumerable: true, configurable: false }; } });`;

/* ── 组装 / 断言（复用共享 harness，不复刻 helper）───────────────── */

/** 靶 + 陷阱 + 读描述符（field 缺省 ⇒ 读整个描述符；face ⇒ Object / Reflect） */
const read = (
  target: string,
  trap: string,
  face: "Object" | "Reflect" = "Object",
  field?: string,
): string => {
  const m =
    face === "Object" ? "Object.getOwnPropertyDescriptor" : "Reflect.getOwnPropertyDescriptor";
  return `${target} ${trap} return ${m}(p, "a")${field ? `.${field}` : ""};`;
};

/** 该片段在引擎里**不抛 TypeError**（原生亦不抛） */
function expectNoTypeError(body: string): void {
  expect(throwsError(call(wrap(body)).throws, "TypeError")).toBe(false);
}

/** 该片段在引擎里**抛 TypeError**（原生亦抛） */
function expectTypeError(body: string): void {
  expect(throwsError(call(wrap(body)).throws, "TypeError")).toBe(true);
}

describe("Bug 1095 验收 1 — 可配置靶 + 异形态陷阱 ⇒ 不抛（native：不抛）", () => {
  it("Object 面：靶是可配置数据属性 + 陷阱报访问器描述符 ⇒ 不抛", () => {
    expectNoTypeError(read(DATA_CFG, TRAP_ACC(true)));
    // 原生返回**陷阱**的描述符（configurable:true；访问器描述符缺省不可枚举）
    expect(val(wrap(read(DATA_CFG, TRAP_ACC(true), "Object", "configurable")))).toEqual({
      ok: true,
      value: true,
    });
  });

  it("Reflect 面同款 ⇒ 不抛", () => {
    expectNoTypeError(read(DATA_CFG, TRAP_ACC(true), "Reflect"));
    expect(val(wrap(read(DATA_CFG, TRAP_ACC(true), "Reflect", "configurable")))).toEqual({
      ok: true,
      value: true,
    });
  });

  it("Object 面：靶是可配置访问器属性 + 陷阱报数据描述符 ⇒ 不抛", () => {
    expectNoTypeError(read(ACC_CFG, TRAP_DATA(true)));
    expect(val(wrap(read(ACC_CFG, TRAP_DATA(true), "Object", "value")))).toEqual({
      ok: true,
      value: 2,
    });
  });

  it("Reflect 面同款 ⇒ 不抛", () => {
    expectNoTypeError(read(ACC_CFG, TRAP_DATA(true), "Reflect"));
    expect(val(wrap(read(ACC_CFG, TRAP_DATA(true), "Reflect", "value")))).toEqual({
      ok: true,
      value: 2,
    });
  });
});

describe("Bug 1095 验收 2 — 不可配置靶 + 异形态陷阱 ⇒ 抛 TypeError（native：抛）", () => {
  it("Object 面：靶是不可配置数据属性 + 陷阱报访问器描述符 ⇒ 抛", () => {
    expectTypeError(read(DATA_NONCFG, TRAP_ACC(false)));
  });

  it("Reflect 面同款 ⇒ 抛", () => {
    expectTypeError(read(DATA_NONCFG, TRAP_ACC(false), "Reflect"));
  });

  it("Object 面：靶是不可配置访问器属性 + 陷阱报数据描述符 ⇒ 抛", () => {
    expectTypeError(read(ACC_NONCFG, TRAP_DATA(false)));
  });

  it("Reflect 面同款 ⇒ 抛", () => {
    expectTypeError(read(ACC_NONCFG, TRAP_DATA(false), "Reflect"));
  });
});

describe("Bug 1095 验收 3 — frozen 靶（freeze 不改 enumerable）", () => {
  it("陷阱诚实报 enumerable:true ⇒ 不抛（native：不抛）", () => {
    expectNoTypeError(read(FROZEN, TRAP_FROZEN_HONEST));
    expect(val(wrap(read(FROZEN, TRAP_FROZEN_HONEST, "Object", "enumerable")))).toEqual({
      ok: true,
      value: true,
    });
  });

  it("Reflect 面同款 ⇒ 不抛", () => {
    expectNoTypeError(read(FROZEN, TRAP_FROZEN_HONEST, "Reflect"));
  });

  it("陷阱报 writable:true ⇒ 抛（frozen 仍冻结 writable；native：抛）", () => {
    expectTypeError(
      read(
        FROZEN,
        `const p = new Proxy(t, { getOwnPropertyDescriptor(){ return { value: 1, writable: true, enumerable: true, configurable: false }; } });`,
      ),
    );
  });

  it("陷阱报 enumerable:false ⇒ 抛（靶的 enumerable 仍是 true；native：抛）", () => {
    expectTypeError(
      read(
        FROZEN,
        `const p = new Proxy(t, { getOwnPropertyDescriptor(){ return { value: 1, writable: false, enumerable: false, configurable: false }; } });`,
      ),
    );
  });
});

describe("Bug 1095 验收 4 — brand 靶 + defineProperty 收紧标志（记在接收者上）", () => {
  it("陷阱报与靶完全一致的描述符 ⇒ 不抛（native：不抛）", () => {
    expectNoTypeError(read(BRAND_TIGHT, TRAP_TIGHT_HONEST));
    expect(val(wrap(read(BRAND_TIGHT, TRAP_TIGHT_HONEST, "Object", "value")))).toEqual({
      ok: true,
      value: 1,
    });
  });

  it("Reflect 面同款 ⇒ 不抛", () => {
    expectNoTypeError(read(BRAND_TIGHT, TRAP_TIGHT_HONEST, "Reflect"));
  });

  it("陷阱报 writable:true ⇒ 抛（native：抛）", () => {
    expectTypeError(
      read(
        BRAND_TIGHT,
        `const p = new Proxy(t, { getOwnPropertyDescriptor(){ return { value: 1, writable: true, enumerable: true, configurable: false }; } });`,
      ),
    );
  });

  it("陷阱报 enumerable:false ⇒ 抛（native：抛）", () => {
    expectTypeError(
      read(
        BRAND_TIGHT,
        `const p = new Proxy(t, { getOwnPropertyDescriptor(){ return { value: 1, writable: false, enumerable: false, configurable: false }; } });`,
      ),
    );
  });

  it("陷阱报 value:2（值不同）⇒ 抛（native：抛）", () => {
    expectTypeError(
      read(
        BRAND_TIGHT,
        `const p = new Proxy(t, { getOwnPropertyDescriptor(){ return { value: 2, writable: false, enumerable: true, configurable: false }; } });`,
      ),
    );
  });
});

describe("Bug 1095 — CI 闸门面：nudo check 不得报 error 级 nudo:entry-may-throw", () => {
  /** 闸门源（导出函数 ⇒ 入口面参与 may-throw 分析） */
  const gate = (body: string) => `export function f() { ${body} }`;

  it("可配置靶 + 异形态陷阱 ⇒ 零 L2 / 零 error（修前：error 级 1 条 ⇒ 卡 CI）", () => {
    const r = issuesOf(gate(read(DATA_CFG, TRAP_ACC(true))), "/t/proxy-gopd-1.js");
    expect(l2Count(r)).toBe(0);
    expect(r.issues.filter((i) => i.severity === "error")).toHaveLength(0);
  });

  it("frozen 靶 + 陷阱诚实报 ⇒ 零 L2 / 零 error（修前：error 级 1 条）", () => {
    const r = issuesOf(gate(read(FROZEN, TRAP_FROZEN_HONEST)), "/t/proxy-gopd-2.js");
    expect(l2Count(r)).toBe(0);
    expect(r.issues.filter((i) => i.severity === "error")).toHaveLength(0);
  });

  it("brand 靶 + 陷阱报一致描述符 ⇒ 零 L2 / 零 error（修前：error 级 1 条）", () => {
    const r = issuesOf(gate(read(BRAND_TIGHT, TRAP_TIGHT_HONEST)), "/t/proxy-gopd-3.js");
    expect(l2Count(r)).toBe(0);
    expect(r.issues.filter((i) => i.severity === "error")).toHaveLength(0);
  });

  it("负控制：真违约（不可配置靶 + 不可写 + 值不同）⇒ 仍报 error 级 L2（闸门没被关掉）", () => {
    const r = issuesOf(
      gate(
        `const t = {}; Object.defineProperty(t, "a", { value: 1, writable: false, configurable: false }); const p = new Proxy(t, { getOwnPropertyDescriptor(){ return { value: 2, writable: false, configurable: false }; } }); return Object.getOwnPropertyDescriptor(p, "a");`,
      ),
      "/t/proxy-gopd-4.js",
    );
    expect(l2Count(r)).toBe(1);
    expect(r.issues.find((i) => i.code === "nudo:entry-may-throw")?.severity).toBe("error");
  });

  it("负控制：不可配置靶 + 异形态陷阱 ⇒ 仍报 error 级 L2（闸门没被关掉）", () => {
    const r = issuesOf(
      gate(read(DATA_NONCFG, TRAP_ACC(false))),
      "/t/proxy-gopd-5.js",
    );
    expect(l2Count(r)).toBe(1);
    expect(r.issues.find((i) => i.code === "nudo:entry-may-throw")?.severity).toBe("error");
  });
});
