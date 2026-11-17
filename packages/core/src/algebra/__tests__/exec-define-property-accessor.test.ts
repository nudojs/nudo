/**
 * （运行时内建建模）：Object.defineProperty accessor 描述符
 * （get/set）只校验不安装——get/set 字段仅用于判定（非函数/与 value
 * 共存 → return unknown），安装路径 putSlots 只装 litOf(value)。
 * 后果：getter 定义后 o.x 折裸 undefined（错值）；setter 场景 x 被当
 * 新建数据属性走默认 writable:false，o.x = v 撞不可写误抛；校验失败
 * （get:5、value+get 共存）应硬抛 TypeError 却折 unknown。
 * 修复：(a) 合法 get/set → accessorTable 侧表安装（$get/$set 原型
 * 派发；写路径走 setter 不误抛；槽占位 unknown/undefined 不折裸值）；
 * (b) 校验失败 → NudoThrow(errorTypeAbs("TypeError")) 硬抛。
 */
import { describe, it, expect } from "vitest";
import { litValue, formatAbs } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

function throwsName(r: { throws: { shape: { k: string; name?: string } } }): string | undefined {
  return r.throws.shape.k === "brand" ? r.throws.shape.name : undefined;
}

describe("defineProperty accessor descriptors install and validate", () => {
  it("getter 定义后 o.x 折字面量返回体（get(){return 7} → 7）", () => {
    const r = call(
      `export function getterCall() { const o = {}; Object.defineProperty(o, "x", { get() { return 7; } }); return o.x; }`,
      "getterCall",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 7 });
  });

  it("getter 读 this（经定义目标派发）", () => {
    const r = call(
      `export function f() { const o = { b: 3 }; Object.defineProperty(o, "x", { get() { return this.b * 2; } }); return o.x; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 6 });
  });

  it("setter 生效：o.x = 21 → this._v = 42（不误抛不可写）", () => {
    const r = call(
      `export function setterCall() { const o = { _v: 0 }; Object.defineProperty(o, "x", { set(v) { this._v = v * 2; } }); o.x = 21; return o._v; }`,
      "setterCall",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 42 });
  });

  it("get + set 共存：读写均派发", () => {
    const r = call(
      `export function f() { const o = { v: 0 }; Object.defineProperty(o, "x", { get() { return o.v; }, set(n) { o.v = n; } }); o.x = 5; return o.x; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 5 });
  });

  it("仅 setter：读折 undefined（原生语义），不折裸槽 miss 以外形态", () => {
    const r = call(
      `export function f() { const o = {}; Object.defineProperty(o, "x", { set(v) {} }); return o.x; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: undefined });
  });

  it("getter-only 属性写 → TypeError（strict 语义保持）", () => {
    const r = call(
      `export function f() { const o = {}; Object.defineProperty(o, "x", { get() { return 1; } }); o.x = 2; return o.x; }`,
      "f",
    );
    expect(r.result.shape.k).toBe("never");
    expect(throwsName(r)).toBe("TypeError");
  });

  it("get: 5 → 原生确定 TypeError（不再 return unknown）", () => {
    const r = call(
      `export function getNonFn() { return Object.defineProperty({}, "x", { get: 5 }); }`,
      "getNonFn",
    );
    expect(r.result.shape.k).toBe("never");
    expect(throwsName(r)).toBe("TypeError");
  });

  it("value 与 accessor 共存 → TypeError", () => {
    const r = call(
      `export function valAndGet() { return Object.defineProperty({}, "x", { value: 1, get() { return 2; } }); }`,
      "valAndGet",
    );
    expect(r.result.shape.k).toBe("never");
    expect(throwsName(r)).toBe("TypeError");
  });

  it("数据描述符全链不回归：{value:7} → o.x 折 7", () => {
    const r = call(
      `export function dpValue() { const o = {}; Object.defineProperty(o, "x", { value: 7 }); return o.x; }`,
      "dpValue",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 7 });
  });

  it("抽象 getter 返回体（依赖参数）→ o.x ≥ unknown（不折裸 undefined）", () => {
    const r = call(
      `export function f(n) { const o = {}; Object.defineProperty(o, "x", { get() { return n + 1; } }); return o.x; }`,
      "f",
      [{ shape: { k: "prim", type: "number" }, conf: "exact" }],
    );
    // 抽象返回体静态不可知 → number 域（不折裸 undefined）
    expect(formatAbs(r.result)).toContain("number");
  });

  it("defineProperty 后既有字面量访问器不丢失（migrateAccessors）", () => {
    const r = call(
      `export function f() { const o = { get a() { return 1; } }; Object.defineProperty(o, "b", { value: 2 }); return o.a + o.b; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 3 });
  });
});

/**
 * BUG-115：类实例上的**自有访问器**（`Object.defineProperty(instance, k,
 * { get, enumerable: true })`）——真 getter 住内层 obj 的 accessorTable，
 * 槽里只有占位。此前 `$get` / `$spread` / `Object.assign` / `Object.entries`
 * 把它当数据槽读取 ⇒ getter 从不调用、返回值折 unknown、必抛异常零执法
 * （普通对象同款访问器正确抛）。修复：四个消费面统一按 side table 求值。
 */
describe("BUG-115 class instance own accessors ($get / spread / assign / entries)", () => {
  const mk = (getBody: string) =>
    `class C { x = 1; } function mk() { const c = new C(); Object.defineProperty(c, "y", { get() { ${getBody} }, enumerable: true }); return c; }`;

  it("$get 调用 getter（读 this）", () => {
    const r = call(
      `export function f() { ${mk("return this.x + 6;")} return mk().y; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 7 });
  });

  it("spread / Object.assign 求值 getter", () => {
    expect(
      litValue(call(`export function f() { ${mk("return 7;")} return JSON.stringify({ ...mk() }); }`).result),
    ).toEqual({ ok: true, value: '{"x":1,"y":7}' });
    expect(
      litValue(call(`export function f() { ${mk("return 7;")} return JSON.stringify(Object.assign({}, mk())); }`).result),
    ).toEqual({ ok: true, value: '{"x":1,"y":7}' });
  });

  it("Object.entries / values 求值 getter", () => {
    expect(
      litValue(
        call(
          `export function f() { ${mk("return 7;")} return Object.entries(mk()).map(([k, v]) => k + ":" + v).join(","); }`,
        ).result,
      ),
    ).toEqual({ ok: true, value: "x:1,y:7" });
    expect(
      litValue(
        call(
          `export function f() { ${mk("return 7;")} return Object.values(mk()).join(","); }`,
        ).result,
      ),
    ).toEqual({ ok: true, value: "1,7" });
  });

  it("必抛 getter 在四个消费面都传播异常", () => {
    const body = mk('throw new Error("g");');
    const cases = [
      `return mk().y;`,
      `return ({ ...mk() }).y;`,
      `return Object.assign({}, mk()).y;`,
      `return Object.entries(mk());`,
    ];
    for (const tail of cases) {
      const r = call(`export function f() { ${body} ${tail} }`);
      expect(throwsName(r), tail).toBe("Error");
    }
  });
});
