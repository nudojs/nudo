/**
 * Bug 318 / 329 回归：`Object(prim)` 装箱面的 `valueOf` / `description` 语义。
 *
 * 原生依据（node v26.10.0 实测，取证命令见文件末尾「取证」段）：
 *   typeof Object(1n).valueOf()               → "bigint"
 *   String(Object(1n) + 1)                    → **抛 TypeError**
 *                                            （"Cannot mix BigInt and other types,
 *                                              use explicit conversions"）
 *   Object(1n) + 1                           → **抛 TypeError**（同款）
 *   String(Object(1n).valueOf())              → "1"
 *   typeof Object(1n)                         → "object"
 *   typeof Object("s").valueOf()              → "string"
 *   String(Object(Symbol("x")).description)   → "x"
 *   typeof Object(Symbol("x")).description    → "string"
 *   Symbol("x").description                   → "x"（非装箱路径，对照组）
 *
 * 修前：
 * - 装箱 BigInt 的 `valueOf` 折 **"object"**（自信的错值；原生是 "bigint"）
 *   ⇒ `Object(1n) + 1` 落 BigInt 混算的**错臂** ⇒ **不抛**（原生确定抛
 *   TypeError）⇒ 假绿（漏报真实的 may-throw）。
 * - 装箱 Symbol 的 `description` 折 exact **undefined**（原生是 "x"）
 *   ⇒ 对「装箱符号的描述」给出自信的错值。
 *
 * 取证（原生 oracle）：
 *   node -e 'console.log(typeof Object(1n).valueOf(), String(Object(1n).valueOf()),
 *     typeof Object(1n), typeof Object("s").valueOf(),
 *     Object(Symbol("x")).description, Symbol("x").description);
 *     try { String(Object(1n)+1) } catch (e) { console.log(e.constructor.name) }'
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call, throwsError } from "./eval-helpers.ts";

const wrap = (body: string) => `export function f() { ${body} }`;

describe("Bug 318 — 装箱 BigInt 的 valueOf 面（原生 \"bigint\"，修前 \"object\"）", () => {
  it("typeof Object(1n).valueOf() → \"bigint\"（修前是 \"object\"——自信的错值）", () => {
    const r = call(wrap(`return typeof Object(1n).valueOf();`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "bigint" });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });

  it("String(Object(1n) + 1) → 记 may-throw TypeError（原生确定抛：BigInt 不得与其它类型混算）", () => {
    // 原生：TypeError "Cannot mix BigInt and other types, use explicit conversions"
    const r = call(wrap(`return String(Object(1n) + 1);`), "f");
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("Object(1n) + 1 → 记 may-throw TypeError（不经 String 包装的同一混算臂）", () => {
    const r = call(wrap(`return Object(1n) + 1;`), "f");
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("String(Object(1n).valueOf()) → \"1\"（显式取原值后转字符串合法且确定）", () => {
    const r = call(wrap(`return String(Object(1n).valueOf());`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "1" });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });

  it("typeof Object(1n) → \"object\"（装箱体本身是对象）", () => {
    const r = call(wrap(`return typeof Object(1n);`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "object" });
  });
});

describe("Bug 329 — 装箱 Symbol 的 description 面（原生 \"x\"，修前 exact undefined）", () => {
  it("String(Object(Symbol(\"x\")).description) → \"x\"", () => {
    const r = call(wrap(`return String(Object(Symbol("x")).description);`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "x" });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });

  it("typeof Object(Symbol(\"x\")).description → \"string\"", () => {
    const r = call(wrap(`return typeof Object(Symbol("x")).description;`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "string" });
  });

  it("对照组：Symbol(\"x\").description → \"x\"（非装箱路径不变）", () => {
    const r = call(wrap(`return Symbol("x").description;`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "x" });
  });
});

describe("Bug 318/329 — 负控制（其它装箱原语面不回归）", () => {
  it("typeof Object(\"s\").valueOf() → \"string\"（装箱字符串的 valueOf 面）", () => {
    const r = call(wrap(`return typeof Object("s").valueOf();`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "string" });
  });

  it("typeof Object(1).valueOf() → \"number\"（装箱数字的 valueOf 面）", () => {
    const r = call(wrap(`return typeof Object(1).valueOf();`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "number" });
  });

  it("String(Object(\"s\").valueOf()) → \"s\"（装箱字符串取原值）", () => {
    const r = call(wrap(`return String(Object("s").valueOf());`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "s" });
  });
});
