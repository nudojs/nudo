/**
 * 族 58 · W8 · core runtime **描述符与生成器协议面** —— 5 条精度债的回归钉。
 *
 * 本钉的断言口径：**对拍原生**（node v26.10.0 宿主实测，宿主断言直接写在本
 * 文件里——先证「该成员/该键在宿主真实存在」，再断言引擎与原生逐字一致）。
 * 每条用例都带**负控**（表外成员 / 未建模面仍按既有口径判定，逐字不变）。
 *
 * 逐条对应（族 58 台账 · W8 分片）：
 * 1. Bug 197  描述符 exists 分支：`writable:true` 的**重定义**不覆盖旧的
 *              `[[Writable]]` ⇒ 引擎读描述符/写门须见**新的** writable。
 * 2. Bug 321  原型 brand 描述符面：`Object.getOwnPropertyNames(Error.prototype)`
 *              / `Object.hasOwn(Error.prototype, "name")` 折 partial。
 * 3. 原型 brand 描述符 / gOPN 面：类原型的 `Object.getOwnPropertyNames` /
 *              `Object.keys` 折保守域（`string[]`），非精确列表。
 * 4. 生成器 `prototype.next` 协议面缺席（`g.prototype.next` 折 undefined）。
 * 5. `.length` slot 在任意 brand 上不可读（core 的 `$len` 不读任意 brand 的
 *              `"length"` 槽 ⇒ env brand 的 `.length` 拿不到，如 Buffer 实例）。
 *
 * 口径边界（**诚实写明**，勿当精确承诺）：
 * - 第 2/3 条只对**引擎已建模成员**的原型给精确清单（Error 家族 + 用户类
 *   原型）；其余原型（Array/Object/Map…）仍走既有保守域 `string[]`——
 *   **不扩 Abs 形状**（扩形状是 A 类架构债）。
 * - 用户类原型的**方法与访问器交错定义序**在引擎的类注册表里不可复原
 *   （methods / accessors 分两张表）⇒ 两者同时存在时不给精确清单（保守域）。
 * - 第 4 条：协议方法在**原型链**上（原生 `g.prototype` 自有键为空）⇒ 引擎
 *   把协议槽标 internal——自有面（hasOwnProperty / gOPN / 枚举）不可见，
 *   与原生一致；`g.prototype` 的 gOPN 仍走既有保守域 `string[]`（不折空）。
 * - 第 5 条：core 不依赖 `@nudojs/env` ⇒ env 的 Buffer brand 用**同形**
 *   （brand + 内层 obj 的 `"length"` 槽）在 core 内构造后直接打 `$len`。
 *
 * ⚠️ **类名唯一性**：引擎的类注册表按**类名**全局驻留（同名类跨用例共享同
 * 一原型对象）⇒ 本文件每个用例用**互不相同**的类名，避免用例间互相污染。
 */
import { describe, it, expect } from "vitest";
import { litValue, formatShape } from "../index.ts";
import { abs } from "../abs.ts";
import { objOf } from "../objects.ts";
import { $len } from "../exec/runtime/containers/arr-index.ts";
import { call, tupleEls, throwsError } from "./eval-helpers.ts";

const wrap = (body: string) => `export function f() { ${body} }`;

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue(call(src, "f").result);
}

/** 结果的 throws 面名（无抛错 → ""） */
function throwName(src: string): string {
  const t = call(src, "f").throws as { shape?: { k?: string; name?: string } } | undefined;
  if (!t?.shape || t.shape.k === "never") return "";
  return t.shape.k === "brand" ? (t.shape.name ?? "") : (t.shape.k as string);
}

// ---------------------------------------------------------------------------
// 1. Bug 197 · 描述符 exists 分支 · writable:true 的重定义
// ---------------------------------------------------------------------------
describe("族 58 · 第 1 条 · Bug 197 · writable:true 的重定义覆盖旧的 [[Writable]]", () => {
  it("宿主实测：writable:true 的重定义把 [[Writable]] 翻回 true（node 原生）", () => {
    const o = {};
    Object.defineProperty(o, "x", { value: 1, writable: false, configurable: true, enumerable: true });
    Object.defineProperty(o, "x", { writable: true });
    expect(Object.getOwnPropertyDescriptor(o, "x")?.writable).toBe(true);
    // 反向收紧（true → false）也生效
    const p = {};
    Object.defineProperty(p, "x", { value: 1, writable: true, configurable: true, enumerable: true });
    Object.defineProperty(p, "x", { writable: false });
    expect(Object.getOwnPropertyDescriptor(p, "x")?.writable).toBe(false);
  });

  it("引擎：普通对象 —— 重定义后描述符读出**新的** writable（原生 true）", () => {
    const src = wrap(
      `const o = {}; Object.defineProperty(o, "x", { value: 1, writable: false, configurable: true, enumerable: true }); Object.defineProperty(o, "x", { writable: true }); return Object.getOwnPropertyDescriptor(o, "x").writable;`,
    );
    expect(v(src)).toEqual({ ok: true, value: true });
  });

  it("引擎：原型对象 —— 重定义后描述符读出**新的** writable（原生 true）", () => {
    const src = wrap(
      `class Bug58ProtoA {} Object.defineProperty(Bug58ProtoA.prototype, "m", { value: 1, writable: false, configurable: true }); Object.defineProperty(Bug58ProtoA.prototype, "m", { writable: true }); return Object.getOwnPropertyDescriptor(Bug58ProtoA.prototype, "m").writable;`,
    );
    expect(v(src)).toEqual({ ok: true, value: true });
  });

  it("引擎：重定义后写门放开（原生 o.x = 2 成功）", () => {
    const src = wrap(
      `const o = {}; Object.defineProperty(o, "x", { value: 1, writable: false, configurable: true, enumerable: true }); Object.defineProperty(o, "x", { writable: true }); o.x = 2; return o.x;`,
    );
    expect(v(src)).toEqual({ ok: true, value: 2 });
  });

  it("负控：writable:true → false 的收紧仍生效（原生 false）", () => {
    const src = wrap(
      `const o = {}; Object.defineProperty(o, "x", { value: 1, writable: true, configurable: true, enumerable: true }); Object.defineProperty(o, "x", { writable: false }); return Object.getOwnPropertyDescriptor(o, "x").writable;`,
    );
    expect(v(src)).toEqual({ ok: true, value: false });
  });

  it("负控：不可配置 + writable:false 的属性改 writable:true 原生定抛 TypeError（引擎同抛）", () => {
    const src = wrap(
      `const o = {}; Object.defineProperty(o, "x", { value: 1, writable: false, configurable: false }); Object.defineProperty(o, "x", { writable: true }); return o.x;`,
    );
    expect(throwName(src)).toBe("TypeError");
  });

  it("负控：不可配置属性上的同值重定义仍合法（原生 1）", () => {
    const src = wrap(
      `const o = {}; Object.defineProperty(o, "x", { value: 1, writable: false, configurable: false }); Object.defineProperty(o, "x", { value: 1 }); return o.x;`,
    );
    expect(v(src)).toEqual({ ok: true, value: 1 });
  });
});

// ---------------------------------------------------------------------------
// 2. Bug 321 · 原型 brand 描述符面（Error 家族）
// ---------------------------------------------------------------------------
describe("族 58 · 第 2 条 · Bug 321 · 原型 brand 描述符面（Error 家族）", () => {
  it("宿主实测：Error.prototype 的自有键与 hasOwn 判定（node 原生）", () => {
    expect(Object.getOwnPropertyNames(Error.prototype)).toEqual([
      "constructor",
      "name",
      "message",
      "toString",
    ]);
    expect(Object.getOwnPropertyNames(TypeError.prototype)).toEqual([
      "constructor",
      "name",
      "message",
    ]);
    expect(Object.hasOwn(Error.prototype, "name")).toBe(true);
    expect(Object.hasOwn(Error.prototype, "message")).toBe(true);
    expect(Object.hasOwn(Error.prototype, "toString")).toBe(true);
    expect(Object.hasOwn(Error.prototype, "zzz")).toBe(false);
    expect(Object.keys(Error.prototype)).toEqual([]);
  });

  it("引擎：gOPN(Error.prototype) 精确列出自有键（原生同款）", () => {
    const r = call(wrap(`return Object.getOwnPropertyNames(Error.prototype);`), "f").result;
    expect(tupleEls(r)).toEqual(["constructor", "name", "message", "toString"]);
  });

  it("引擎：gOPN(TypeError.prototype) 精确（toString 是**继承**的，不入自有键）", () => {
    const r = call(wrap(`return Object.getOwnPropertyNames(TypeError.prototype);`), "f").result;
    expect(tupleEls(r)).toEqual(["constructor", "name", "message"]);
  });

  it("引擎：Object.hasOwn(Error.prototype, ...) 折确定 boolean（原生 true/false）", () => {
    expect(v(wrap(`return Object.hasOwn(Error.prototype, "name");`))).toEqual({
      ok: true,
      value: true,
    });
    expect(v(wrap(`return Object.hasOwn(Error.prototype, "message");`))).toEqual({
      ok: true,
      value: true,
    });
    expect(v(wrap(`return Object.hasOwn(Error.prototype, "toString");`))).toEqual({
      ok: true,
      value: true,
    });
    expect(v(wrap(`return Object.hasOwn(Error.prototype, "zzz");`))).toEqual({
      ok: true,
      value: false,
    });
  });

  it("引擎：TypeError.prototype 的 toString 是继承的 ⇒ hasOwn 折 false（原生 false）", () => {
    expect(v(wrap(`return Object.hasOwn(TypeError.prototype, "toString");`))).toEqual({
      ok: true,
      value: false,
    });
  });

  it("引擎：Object.keys(Error.prototype) 折精确空元组（原生 []——自有成员全不可枚举）", () => {
    const r = call(wrap(`return Object.keys(Error.prototype);`), "f").result;
    expect(tupleEls(r)).toEqual([]);
  });

  it("负控：未建模成员的原型（Array.prototype）仍走既有保守域 string[]（逐字不变）", () => {
    const r = call(wrap(`return Object.getOwnPropertyNames(Array.prototype);`), "f").result;
    expect(formatShape(r)).toBe("string[]");
    expect(litValue(r).ok).toBe(false);
  });

  it("负控：Object.prototype 的 hasOwn 判定仍走既有保守域（逐字不变）", () => {
    const r = call(wrap(`return Object.hasOwn(Object.prototype, "toString");`), "f").result;
    expect(formatShape(r)).toBe("boolean");
    expect(litValue(r).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. 类原型 brand 的 gOPN / keys 面
// ---------------------------------------------------------------------------
describe("族 58 · 第 3 条 · 类原型 brand 的 gOPN / keys 面", () => {
  it("宿主实测：类原型的自有键 / 可枚举键 / hasOwn（node 原生）", () => {
    class HostClassA {
      m() {}
    }
    expect(Object.getOwnPropertyNames(HostClassA.prototype)).toEqual(["constructor", "m"]);
    expect(Object.keys(HostClassA.prototype)).toEqual([]);
    expect(Object.hasOwn(HostClassA.prototype, "m")).toBe(true);
    expect(Object.hasOwn(HostClassA.prototype, "zzz")).toBe(false);
    class HostClassB {
      get g() {
        return 1;
      }
    }
    expect(Object.getOwnPropertyNames(HostClassB.prototype)).toEqual(["constructor", "g"]);
  });

  it("引擎：gOPN(类原型) 精确列出 constructor + 自有方法（原生同款）", () => {
    const r = call(
      wrap(`class Bug58ClassA { m() {} } return Object.getOwnPropertyNames(Bug58ClassA.prototype);`),
      "f",
    ).result;
    expect(tupleEls(r)).toEqual(["constructor", "m"]);
  });

  it("引擎：gOPN(只有访问器的类原型) 精确列出 constructor + 访问器（原生同款）", () => {
    const r = call(
      wrap(
        `class Bug58ClassB { get g() { return 1; } } return Object.getOwnPropertyNames(Bug58ClassB.prototype);`,
      ),
      "f",
    ).result;
    expect(tupleEls(r)).toEqual(["constructor", "g"]);
  });

  it("引擎：gOPN(类原型) 按**定义序**列出 constructor + 自有方法（原生同款）", () => {
    const r = call(
      wrap(`class Bug58ClassH { m() {} n() {} } return Object.getOwnPropertyNames(Bug58ClassH.prototype);`),
      "f",
    ).result;
    expect(tupleEls(r)).toEqual(["constructor", "m", "n"]);
  });

  it("引擎：gOPN(子类原型) 不列**继承**的祖先成员（原生同款）", () => {
    const r = call(
      wrap(
        `class Bug58ClassIBase { base() {} } class Bug58ClassI extends Bug58ClassIBase { own() {} } return Object.getOwnPropertyNames(Bug58ClassI.prototype);`,
      ),
      "f",
    ).result;
    expect(tupleEls(r)).toEqual(["constructor", "own"]);
  });

  it("引擎：Object.keys(类原型) 折精确空元组（原生 []——类成员全不可枚举）", () => {
    const r = call(
      wrap(`class Bug58ClassC { m() {} } return Object.keys(Bug58ClassC.prototype);`),
      "f",
    ).result;
    expect(tupleEls(r)).toEqual([]);
  });

  it("引擎：Object.hasOwn(类原型, ...) 折确定 boolean（原生 true/false）", () => {
    expect(
      v(wrap(`class Bug58ClassD { m() {} } return Object.hasOwn(Bug58ClassD.prototype, "m");`)),
    ).toEqual({ ok: true, value: true });
    expect(
      v(
        wrap(
          `class Bug58ClassE { m() {} } return Object.hasOwn(Bug58ClassE.prototype, "constructor");`,
        ),
      ),
    ).toEqual({ ok: true, value: true });
    expect(
      v(wrap(`class Bug58ClassF { m() {} } return Object.hasOwn(Bug58ClassF.prototype, "zzz");`)),
    ).toEqual({ ok: true, value: false });
  });

  it("负控：方法与访问器交错定义序不可复原 ⇒ 仍走保守域 string[]（逐字不变）", () => {
    const r = call(
      wrap(
        `class Bug58ClassG { m() {} get g() { return 1; } } return Object.getOwnPropertyNames(Bug58ClassG.prototype);`,
      ),
      "f",
    ).result;
    expect(formatShape(r)).toBe("string[]");
    expect(litValue(r).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. 生成器 prototype 的协议面（next / return / throw）
// ---------------------------------------------------------------------------
describe("族 58 · 第 4 条 · 生成器 prototype 的协议面", () => {
  it("宿主实测：%GeneratorPrototype% 的协议面**真实存在**（node 原生）", () => {
    function* hostGen() {
      yield 1;
    }
    expect(typeof hostGen.prototype.next).toBe("function");
    expect(typeof hostGen.prototype.return).toBe("function");
    expect(typeof hostGen.prototype.throw).toBe("function");
    // 协议方法在**原型链**上——不是原型对象的自有键（gOPN 为空）
    expect(Object.getOwnPropertyNames(hostGen.prototype)).toEqual([]);
    // 借用调用推进接收者生成器
    const it = hostGen();
    expect(hostGen.prototype.next.call(it)).toEqual({ value: 1, done: false });
    expect(hostGen.prototype.next.call(it)).toEqual({ value: undefined, done: true });
  });

  it("引擎：g.prototype.next 可读（typeof \"function\"，原生同款）", () => {
    expect(
      v(wrap(`function* g() { yield 1; } return typeof g.prototype.next;`)),
    ).toEqual({ ok: true, value: "function" });
  });

  it("引擎：g.prototype.return / throw 可读（原生同款）", () => {
    expect(
      v(wrap(`function* g() { yield 1; } return typeof g.prototype.return;`)),
    ).toEqual({ ok: true, value: "function" });
    expect(
      v(wrap(`function* g() { yield 1; } return typeof g.prototype.throw;`)),
    ).toEqual({ ok: true, value: "function" });
  });

  it("引擎：借用调用 g.prototype.next.call(it) 推进生成器（原生 {value:1,done:false}）", () => {
    expect(
      v(
        wrap(
          `function* g() { yield 1; } const it = g(); const a = g.prototype.next.call(it); const b = g.prototype.next.call(it); return [a.value, a.done, b.done].join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "1,false,true" });
  });

  it("引擎：无接收者调用 g.prototype.next() 原生定抛 TypeError（引擎同抛）", () => {
    const src = wrap(`function* g() { yield 1; } return g.prototype.next();`);
    expect(throwName(src)).toBe("TypeError");
  });

  it("负控：生成器实例自身的 next 面逐字不变（typeof \"function\"）", () => {
    expect(
      v(wrap(`function* g() { yield 1; } const it = g(); return typeof it.next;`)),
    ).toEqual({ ok: true, value: "function" });
  });

  it("负控：协议方法不是原型对象的自有键 —— gOPN(g.prototype) 精确空元组（原生 []）", () => {
    const r = call(
      wrap(`function* g() { yield 1; } return Object.getOwnPropertyNames(g.prototype);`),
      "f",
    ).result;
    expect(formatShape(r)).toBe("[]");
    expect(tupleEls(r)).toEqual([]);
  });

  it("负控：协议槽是 internal ⇒ 原型对象上 hasOwn(\"next\") 折 false（原生 false）", () => {
    expect(
      v(wrap(`function* g() { yield 1; } return Object.hasOwn(g.prototype, "next");`)),
    ).toEqual({ ok: true, value: false });
  });
});

// ---------------------------------------------------------------------------
// 5. 任意 brand 的 "length" 槽
// ---------------------------------------------------------------------------
describe("族 58 · 第 5 条 · 任意 brand 的 \"length\" 槽可读", () => {
  /** env 声明面同形的 brand（Buffer：内层 obj 带 "length" 槽） */
  function lengthBrand(name: string, slots: Record<string, { value: ReturnType<typeof abs> }>) {
    return abs({ k: "brand", name, shape: objOf(slots) }, undefined, undefined, "exact");
  }

  const numAbs = () =>
    abs({ k: "prim", type: "number" }, undefined, undefined, "exact");

  it("宿主实测：Buffer 实例的 length 真实存在（node 原生 3）", () => {
    expect(Buffer.from("abc").length).toBe(3);
    expect(Object.prototype.hasOwnProperty.call(Buffer.from("abc"), "length")).toBe(false);
  });

  it("引擎：任意 brand 的 \"length\" 槽可读（Buffer 同形 brand → number）", () => {
    const brand = lengthBrand("Buffer", { length: { value: numAbs() } });
    expect(formatShape($len(brand))).toBe("number");
  });

  it("引擎：brand 的 \"length\" 槽与成员读面同口径（$get 同槽）", () => {
    const brand = lengthBrand("Buffer58", { length: { value: numAbs() } });
    // $len 与 $get 读同一槽 ⇒ 同一个值域（number）
    expect(formatShape($len(brand))).toBe("number");
  });

  it("负控：无 length 槽的 brand 仍折 unknown（逐字不变）", () => {
    const brand = lengthBrand("Bug58NoLength", {});
    expect(formatShape($len(brand))).toBe("unknown");
  });

  it("负控：对象字面量 / 字符串 / 数组的 length 逐字不变（原生 7 / 3 / 3）", () => {
    expect(v(wrap(`const o = { length: 7 }; return o.length;`))).toEqual({
      ok: true,
      value: 7,
    });
    expect(v(wrap(`return "abc".length;`))).toEqual({ ok: true, value: 3 });
    expect(v(wrap(`return [1, 2, 3].length;`))).toEqual({ ok: true, value: 3 });
  });
});
