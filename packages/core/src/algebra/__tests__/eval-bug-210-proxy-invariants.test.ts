/**
 * Bug 210 回归：Proxy **不变量校验**（ES2024 10.5 Proxy 内部方法）。
 *
 * ① [[Get]] 不变量（ES2024 10.5.4 step 6）：靶上某自有属性**不可配置且
 *    不可写**（数据属性）时，get 陷阱的返回值必须与靶的实际值 SameValue，
 *    否则原生定抛 TypeError（"'get' on proxy: property 'a' is a read-only
 *    and non-configurable data property on the proxy target but the proxy
 *    did not return its actual value"）。
 *    —— 只在**同时**不可写 + 不可配置时成立：仅不可写（configurable:true）
 *    / 仅不可配置（writable:true）/ 密封靶（不可配置但可写）都**不**抛。
 * ② [[OwnPropertyKeys]] 不变量（ES2024 10.5.5）：陷阱结果不得含重复项、
 *    不得含非字符串/symbol 键；靶的**不可配置**自有键必须都在陷阱结果里
 *    （与靶可扩展性无关）；靶**不可扩展**时陷阱结果须恰为靶的自有键集
 *    （不多不少——多余键也抛）。
 * ③ [[OwnPropertyKeys]] **派发点**：handler 的 "ownKeys" 陷阱此前从不被
 *    调用（Reflect.ownKeys / Object.keys / Object.getOwnPropertyNames 直
 *    接走靶面）——原生先查 handler 的 "ownKeys" 槽；无陷阱时转发靶面。
 *
 * 修复前：引擎的 Proxy 内部方法只做「派发陷阱 + 采用返回值」，零不变量
 * 校验 → 上述四类原生 TypeError 全部静默通过（wrong-exact）。
 *
 * 成员读面（`p.a`）的 [[Get]] 不变量在 exec/runtime/containers/member.ts
 * 的陷阱臂——已接线（该臂取到陷阱返回值后过 state.ts 的
 * enforceProxyGetInvariant）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue(call(src, "f").result);
}

/** 抛错名（无抛错 → ""） */
function throwName(src: string): string {
  const t = call(src, "f").throws as { shape?: { k?: string; name?: string } } | undefined;
  if (!t?.shape || t.shape.k === "never") return "";
  return t.shape.k === "brand" ? (t.shape.name ?? "") : t.shape.k;
}

const wrap = (body: string) => `export function f() { ${body} }`;

describe("Bug 210 — Proxy [[Get]] 不变量（不可配置+不可写属性须返回实际值）", () => {
  it("Reflect.get(冻结靶代理, 'a') → TypeError（此前折 2 且声称不抛）", () => {
    expect(
      throwName(
        wrap(`const t=Object.freeze({a:1}); const p=new Proxy(t,{get:()=>2}); return Reflect.get(p,"a");`),
      ),
    ).toBe("TypeError");
  });

  it("冻结靶 + 陷阱返回**实际值** → 正常返回 1", () => {
    expect(
      v(wrap(`const t=Object.freeze({a:1}); const p=new Proxy(t,{get:()=>1}); return Reflect.get(p,"a");`)),
    ).toEqual({ ok: true, value: 1 });
  });

  it("冻结靶 + 读**非自有**键 → 不抛（不变量只管自有属性）", () => {
    expect(
      v(wrap(`const t=Object.freeze({a:1}); const p=new Proxy(t,{get:()=>2}); return Reflect.get(p,"b");`)),
    ).toEqual({ ok: true, value: 2 });
  });

  it("仅不可写（configurable:true）→ 不抛", () => {
    expect(
      v(
        wrap(
          `const t={}; Object.defineProperty(t,"a",{value:1,writable:false,configurable:true}); const p=new Proxy(t,{get:()=>2}); return Reflect.get(p,"a");`,
        ),
      ),
    ).toEqual({ ok: true, value: 2 });
  });

  it("仅不可配置（writable:true）→ 不抛", () => {
    expect(
      v(
        wrap(
          `const t={}; Object.defineProperty(t,"a",{value:1,writable:true,configurable:false}); const p=new Proxy(t,{get:()=>2}); return Reflect.get(p,"a");`,
        ),
      ),
    ).toEqual({ ok: true, value: 2 });
  });

  it("密封靶（不可配置但可写）→ 不抛", () => {
    expect(
      v(wrap(`const t=Object.seal({a:1}); const p=new Proxy(t,{get:()=>2}); return Reflect.get(p,"a");`)),
    ).toEqual({ ok: true, value: 2 });
  });

  it("负控制：普通冻结对象读 → 1（不涉及 Proxy）", () => {
    expect(v(wrap(`const o=Object.freeze({a:1}); return o.a;`))).toEqual({ ok: true, value: 1 });
  });

  it("负控制：可扩展靶 + get 陷阱 → 2（无 [[Get]] 约束）", () => {
    expect(v(wrap(`const p=new Proxy({a:1},{get:()=>2}); return Reflect.get(p,"a");`))).toEqual({
      ok: true,
      value: 2,
    });
  });

  it("成员读面 p.a（冻结靶 + get 陷阱）→ TypeError（containers/member.ts 的 Proxy get 臂过 enforceProxyGetInvariant）", () => {
    expect(
      throwName(wrap(`const t=Object.freeze({a:1}); const p=new Proxy(t,{get:()=>2}); return p.a;`)),
    ).toBe("TypeError");
  });

  it("成员读面 p.a（冻结靶 + 陷阱返回实际值）→ 1（不抛）", () => {
    expect(
      v(wrap(`const t=Object.freeze({a:1}); const p=new Proxy(t,{get:()=>1}); return p.a;`)),
    ).toEqual({ ok: true, value: 1 });
  });

  it("成员读面 p.a（仅不可写，configurable:true）→ 2（不抛）", () => {
    expect(
      v(
        wrap(
          `const t={}; Object.defineProperty(t,"a",{value:1,writable:false,configurable:true}); const p=new Proxy(t,{get:()=>2}); return p.a;`,
        ),
      ),
    ).toEqual({ ok: true, value: 2 });
  });

  it("成员读面 p.a（可扩展靶 + get 陷阱）→ 2（无 [[Get]] 约束）", () => {
    expect(v(wrap(`const p=new Proxy({a:1},{get:()=>2}); return p.a;`))).toEqual({
      ok: true,
      value: 2,
    });
  });
});

describe("Bug 210 — Proxy [[OwnPropertyKeys]] 不变量 + 陷阱派发", () => {
  it("ownKeys 陷阱结果含重复名 → TypeError（此前折 'a,a'）", () => {
    expect(
      throwName(wrap(`const p=new Proxy({},{ownKeys:()=>["a","a"]}); return Reflect.ownKeys(p).join(",");`)),
    ).toBe("TypeError");
  });

  it("不可扩展靶 + 陷阱漏掉其自有键 → TypeError（此前折 'b'）", () => {
    expect(
      throwName(
        wrap(`const t=Object.preventExtensions({a:1}); const p=new Proxy(t,{ownKeys:()=>["b"]}); return Reflect.ownKeys(p).join(",");`),
      ),
    ).toBe("TypeError");
  });

  it("不可扩展靶 + 陷阱**多出**靶没有的键 → TypeError（此前折 'a,b'）", () => {
    expect(
      throwName(
        wrap(`const t=Object.preventExtensions({a:1}); const p=new Proxy(t,{ownKeys:()=>["a","b"]}); return Reflect.ownKeys(p).join(",");`),
      ),
    ).toBe("TypeError");
  });

  it("可扩展靶 + 陷阱漏掉其**不可配置**自有键 → TypeError（此前折 ''）", () => {
    expect(
      throwName(
        wrap(`const t={}; Object.defineProperty(t,"a",{value:1,configurable:false}); const p=new Proxy(t,{ownKeys:()=>[]}); return Reflect.ownKeys(p).join(",");`),
      ),
    ).toBe("TypeError");
  });

  it("ownKeys 陷阱结果含非字符串键 → TypeError", () => {
    expect(
      throwName(wrap(`const p=new Proxy({},{ownKeys:()=>[1]}); return Reflect.ownKeys(p).join(",");`)),
    ).toBe("TypeError");
  });

  it("ownKeys 陷阱返回非对象 → TypeError", () => {
    expect(
      throwName(wrap(`const p=new Proxy({},{ownKeys:()=>1}); return Reflect.ownKeys(p).join(",");`)),
    ).toBe("TypeError");
  });

  it("gOPN 走 ownKeys 陷阱：重复名同样定抛", () => {
    expect(
      throwName(
        wrap(`const p=new Proxy({},{ownKeys:()=>["a","a"]}); return Object.getOwnPropertyNames(p).join(",");`),
      ),
    ).toBe("TypeError");
  });

  it("ownKeys 陷阱正常派发：Reflect.ownKeys 折陷阱结果", () => {
    expect(
      v(wrap(`const p=new Proxy({a:1},{ownKeys:()=>["a","b"]}); return Reflect.ownKeys(p).join(",");`)),
    ).toEqual({ ok: true, value: "a,b" });
  });

  it("ownKeys 陷阱正常派发：Object.keys 按靶的可枚举性过滤", () => {
    expect(
      v(wrap(`const p=new Proxy({a:1,b:2},{ownKeys:()=>["a"]}); return Object.keys(p).join(",");`)),
    ).toEqual({ ok: true, value: "a" });
  });

  it("ownKeys 陷阱正常派发：gOPN 只取字符串键", () => {
    expect(
      v(wrap(`const p=new Proxy({a:1,b:2},{ownKeys:()=>["a"]}); return Object.getOwnPropertyNames(p).join(",");`)),
    ).toEqual({ ok: true, value: "a" });
  });

  it("无 ownKeys 陷阱 → 转发靶的自有键面（Reflect.ownKeys / keys / gOPN）", () => {
    expect(
      v(wrap(`const p=new Proxy({a:1,b:2},{}); return Reflect.ownKeys(p).join(",");`)),
    ).toEqual({ ok: true, value: "a,b" });
    expect(v(wrap(`const p=new Proxy({a:1,b:2},{}); return Object.keys(p).join(",");`))).toEqual({
      ok: true,
      value: "a,b",
    });
    expect(
      v(wrap(`const p=new Proxy({a:1,b:2},{}); return Object.getOwnPropertyNames(p).join(",");`)),
    ).toEqual({ ok: true, value: "a,b" });
  });

  it("负控制：普通对象的 Reflect.ownKeys / keys 不受牵连", () => {
    expect(v(wrap(`return Reflect.ownKeys({a:1,b:2}).join(",");`))).toEqual({ ok: true, value: "a,b" });
    expect(v(wrap(`return Object.keys({a:1,b:2}).join(",");`))).toEqual({ ok: true, value: "a,b" });
  });
});
