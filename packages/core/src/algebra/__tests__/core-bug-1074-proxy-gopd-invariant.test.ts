/**
 * Bug 1074 回归：Proxy **[[GetOwnProperty]]** 的靶一致性不变量
 * （ES2024 10.5.5 step 12.f）——违者原生定抛 TypeError，引擎此前
 * **照抄陷阱的值**（自信的错值 / 假绿）。
 *
 * 修前（探针实测）：
 * - `Object.getOwnPropertyDescriptor(p, "a").value` ⇒ **exact 2**
 *   （原生抛 TypeError：靶上 "a" 是不可配置 + 不可写的数据属性，陷阱
 *   报了不同的 value ⇒ 违反 [[GetOwnProperty]] 不变量）；
 * - `Reflect.getOwnPropertyDescriptor(p, "a").value` ⇒ 同款 exact 2。
 *
 * 修后：靶自有 + 不可配置 + 不可写 + 陷阱 value 与靶值不同 ⇒ 定抛
 * TypeError（Object 面抛、Reflect 面同口径抛）；可写靶 / 同值陷阱
 * **不抛**（负控制）。
 *
 * 判定口径与 [[Get]] 面的 `exec/runtime/state.ts` 的
 * `enforceProxyGetInvariant` 同源（靶自有 + 不可配置 + 不可写 + 值不同
 * ⇒ 抛）；那处归并行 worker 拥有 ⇒ 本次在 builtins 侧就地复刻
 * （`builtins/object/descriptor.ts` 的 enforceProxyGetOwnPropDescInvariant）。
 *
 * **口径扩展（收口轮）**：原先只落「值」这一条；现按 ES2024 10.5.5
 * step 6.a / 7.a–7.c 补齐 configurable / writable / enumerable 三档与
 * 「靶无该自有键」「靶是访问器」两档。口径以 **node v26.10.0 实测矩阵**
 * 为准（靶 present/absent × 陷阱 present/absent ×
 * configurable/writable/enumerable 全组合 = 82 例，候选谓词与原生**零偏差**）。
 *
 * oracle：node v26.10.0 实测。
 */
import { describe, it, expect } from "vitest";
import { call, val, throwsError } from "./eval-helpers.ts";

const wrap = (body: string) => `export function f() { ${body} }`;

/** 靶上 "a" 是不可配置 + 不可写的数据属性（value 1） */
const FROZEN_TARGET = `const t = {}; Object.defineProperty(t, "a", {value:1, configurable:false, writable:false});`;

describe("Bug 1074 — Proxy [[GetOwnProperty]] 不变量：值不同 ⇒ TypeError", () => {
  it("Object.getOwnPropertyDescriptor(p, \"a\").value ⇒ 抛 TypeError（native：同款）", () => {
    const rec = call(
      wrap(
        `${FROZEN_TARGET} const p = new Proxy(t, { getOwnPropertyDescriptor(){ return {value:2, writable:false, configurable:false}; } }); return Object.getOwnPropertyDescriptor(p, "a").value;`,
      ),
    );
    expect(throwsError(rec.throws, "TypeError")).toBe(true);
  });

  it("Reflect.getOwnPropertyDescriptor(p, \"a\").value ⇒ 抛 TypeError（native：同款）", () => {
    const rec = call(
      wrap(
        `${FROZEN_TARGET} const p = new Proxy(t, { getOwnPropertyDescriptor(){ return {value:2, writable:false, configurable:false}; } }); return Reflect.getOwnPropertyDescriptor(p, "a").value;`,
      ),
    );
    expect(throwsError(rec.throws, "TypeError")).toBe(true);
  });

  it("用户 try/catch 捕到（native：\"threw\"）", () => {
    expect(
      val(
        wrap(
          `${FROZEN_TARGET} const p = new Proxy(t, { getOwnPropertyDescriptor(){ return {value:2, writable:false, configurable:false}; } }); try { Object.getOwnPropertyDescriptor(p, "a"); } catch { return "threw"; } return "no-throw";`,
        ),
      ),
    ).toEqual({ ok: true, value: "threw" });
  });
});

describe("Bug 1074 — 负控制（邻近形态不回归）", () => {
  it("靶属性**可写**（普通 {a:1}）⇒ 陷阱值原样给出（native：2）", () => {
    expect(
      val(
        wrap(
          `const p = new Proxy({ a: 1 }, { getOwnPropertyDescriptor(){ return {value:2, writable:true, enumerable:true, configurable:true}; } }); return Object.getOwnPropertyDescriptor(p, "a").value;`,
        ),
      ),
    ).toEqual({ ok: true, value: 2 });
  });

  it("陷阱报**同一个值** ⇒ 不抛（native：值一致不违 12.f）", () => {
    expect(
      val(
        wrap(
          `${FROZEN_TARGET} const p = new Proxy(t, { getOwnPropertyDescriptor(){ return {value:1, writable:false, enumerable:false, configurable:false}; } }); return Object.getOwnPropertyDescriptor(p, "a").value;`,
        ),
      ),
    ).toEqual({ ok: true, value: 1 });
  });

  it("靶**无**该自有键 + 陷阱报**可配置** ⇒ 不变量不适用（native：不抛，2）", () => {
    expect(
      val(
        wrap(
          `const p = new Proxy({}, { getOwnPropertyDescriptor(){ return {value:2, writable:true, enumerable:true, configurable:true}; } }); return Object.getOwnPropertyDescriptor(p, "a").value;`,
        ),
      ),
    ).toEqual({ ok: true, value: 2 });
  });

  it("非 Proxy 路径不受影响：{a:1} 的描述符 value 1", () => {
    expect(val(wrap(`return Object.getOwnPropertyDescriptor({ a: 1 }, "a").value;`))).toEqual({
      ok: true,
      value: 1,
    });
  });
});

/** 靶侧描述符（defineProperty） */
const TGT = (flags: string): string =>
  `const t = {}; Object.defineProperty(t, "a", {value:1, ${flags}});`;

/** 陷阱侧描述符 */
const TRAP = (flags: string): string =>
  `const p = new Proxy(t, { getOwnPropertyDescriptor(){ return {value:2, ${flags}}; } });`;

describe("Bug 1074 扩展 — 规则 1：靶无该自有键 ⇒ 陷阱必须可配置", () => {
  it("靶 {} + 陷阱报 configurable:false ⇒ 抛 TypeError（native：抛）", () => {
    const rec = call(
      wrap(
        `const t = {}; const p = new Proxy(t, { getOwnPropertyDescriptor(){ return {value:2, writable:true, enumerable:true, configurable:false}; } }); return Object.getOwnPropertyDescriptor(p, "a").value;`,
      ),
    );
    expect(throwsError(rec.throws, "TypeError")).toBe(true);
  });

  it("靶 {} + 陷阱报 configurable:true ⇒ 不抛（native：2）", () => {
    expect(
      val(
        wrap(
          `const t = {}; const p = new Proxy(t, { getOwnPropertyDescriptor(){ return {value:2, writable:true, enumerable:true, configurable:true}; } }); return Object.getOwnPropertyDescriptor(p, "a").value;`,
        ),
      ),
    ).toEqual({ ok: true, value: 2 });
  });
});

describe("Bug 1074 扩展 — 规则 2：可配置性必须一致", () => {
  it("靶可配置 + 陷阱报 configurable:false ⇒ 抛 TypeError（native：抛）", () => {
    const rec = call(
      wrap(`${TGT("writable:true, enumerable:true, configurable:true")} ${TRAP("writable:true, enumerable:true, configurable:false")} return Object.getOwnPropertyDescriptor(p, "a").value;`),
    );
    expect(throwsError(rec.throws, "TypeError")).toBe(true);
  });

  it("靶不可配置 + 陷阱报 configurable:true ⇒ 抛 TypeError（native：抛）", () => {
    const rec = call(
      wrap(`${TGT("writable:true, enumerable:true, configurable:false")} ${TRAP("writable:true, enumerable:true, configurable:true")} return Object.getOwnPropertyDescriptor(p, "a").value;`),
    );
    expect(throwsError(rec.throws, "TypeError")).toBe(true);
  });
});

describe("Bug 1074 扩展 — 规则 3：靶不可配置 ⇒ writable / enumerable 冻结", () => {
  it("靶不可配置+可写 + 陷阱报 writable:false ⇒ 抛 TypeError（native：抛）", () => {
    const rec = call(
      wrap(`${TGT("writable:true, enumerable:true, configurable:false")} ${TRAP("writable:false, enumerable:true, configurable:false")} return Object.getOwnPropertyDescriptor(p, "a").value;`),
    );
    expect(throwsError(rec.throws, "TypeError")).toBe(true);
  });

  it("靶不可配置+可写 + 陷阱报 enumerable 不同 ⇒ 抛 TypeError（native：抛）", () => {
    const rec = call(
      wrap(`${TGT("writable:true, enumerable:true, configurable:false")} ${TRAP("writable:true, enumerable:false, configurable:false")} return Object.getOwnPropertyDescriptor(p, "a").value;`),
    );
    expect(throwsError(rec.throws, "TypeError")).toBe(true);
  });

  it("靶不可配置+不可写 + 陷阱报 writable:true ⇒ 抛 TypeError（native：抛）", () => {
    const rec = call(
      wrap(`${TGT("writable:false, enumerable:true, configurable:false")} ${TRAP("writable:true, enumerable:true, configurable:false")} return Object.getOwnPropertyDescriptor(p, "a").value;`),
    );
    expect(throwsError(rec.throws, "TypeError")).toBe(true);
  });

  it("靶不可配置+可写 + 陷阱报同 writable/enumerable ⇒ 不抛（native：2）", () => {
    expect(
      val(
        wrap(
          `${TGT("writable:true, enumerable:true, configurable:false")} ${TRAP("writable:true, enumerable:true, configurable:false")} return Object.getOwnPropertyDescriptor(p, "a").value;`,
        ),
      ),
    ).toEqual({ ok: true, value: 2 });
  });

  it("靶可配置 ⇒ 陷阱报任意 writable/enumerable ⇒ 不抛（native：2）", () => {
    expect(
      val(
        wrap(
          `${TGT("writable:true, enumerable:true, configurable:true")} ${TRAP("writable:false, enumerable:false, configurable:true")} return Object.getOwnPropertyDescriptor(p, "a").value;`,
        ),
      ),
    ).toEqual({ ok: true, value: 2 });
  });
});

describe("Bug 1074 扩展 — 规则 4：数据 / 访问器描述符不得混报", () => {
  it("靶是访问器 + 陷阱报数据描述符 ⇒ 抛 TypeError（native：抛）", () => {
    const rec = call(
      wrap(
        `const t = {}; Object.defineProperty(t, "a", { get(){ return 1; }, configurable:false }); const p = new Proxy(t, { getOwnPropertyDescriptor(){ return {value:2, writable:true, enumerable:true, configurable:true}; } }); return Object.getOwnPropertyDescriptor(p, "a").value;`,
      ),
    );
    expect(throwsError(rec.throws, "TypeError")).toBe(true);
  });

  it("靶是数据属性 + 陷阱报访问器描述符 ⇒ 抛 TypeError（native：抛）", () => {
    const rec = call(
      wrap(
        `${TGT("writable:true, enumerable:true, configurable:false")} const p = new Proxy(t, { getOwnPropertyDescriptor(){ return {get(){ return 2; }, configurable:false}; } }); return Object.getOwnPropertyDescriptor(p, "a").value;`,
      ),
    );
    expect(throwsError(rec.throws, "TypeError")).toBe(true);
  });
});
