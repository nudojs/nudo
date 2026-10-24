/**
 * Bug 328 回归：内建原型的 [[Prototype]] 链**不再被压扁**。
 *
 * 原生依据（node v26.10.0 实测，取证命令见文件末尾「取证」段）：
 *   Object.getPrototypeOf(Uint8Array.prototype) === Object.prototype
 *     → **false**（Uint8Array.prototype 的原型是 %TypedArray%.prototype，
 *       它才是 Object.prototype 的子原型——原生是**两层**）
 *   Object.getPrototypeOf(Object.getPrototypeOf(Uint8Array.prototype))
 *     === Object.prototype → **true**（链条错一级的症状已修）
 *   Object.getPrototypeOf(Array.prototype) === Object.prototype → **true**
 *     （Array.prototype 的上一层**就是** Object.prototype——原生是**一层**）
 *
 * 修前：引擎把内建原型的 [[Prototype]] **一律**压成 Object.prototype
 * ⇒ 对 Uint8Array.prototype 这类「原型之上还有一层」的内建给出**自信的
 * 错值**（原生 false，引擎 true）。
 *
 * 引擎当前（保守域口径，**不是**自信的错值）：`getProto(Uint8Array.prototype)
 * === Object.prototype` 落 **保守 boolean 域**（formatShape = "boolean"，
 * litValue 不 ok）——即引擎**不再**说死 true，但也没说死 false。
 * 故本文件按「**不得是精确 true**」钉（原生是 false，引擎保守 ⇒ 方向一致，
 * 只是精度未到位）；**不得**断言精确 false（会假红），也**不得**断言精确
 * true（那是修前的错值）。
 *
 * 取证（原生 oracle）：
 *   node -e 'console.log(Object.getPrototypeOf(Uint8Array.prototype)===Object.prototype,
 *     Object.getPrototypeOf(Object.getPrototypeOf(Uint8Array.prototype))===Object.prototype,
 *     Object.getPrototypeOf(Array.prototype)===Object.prototype)'
 */
import { describe, it, expect } from "vitest";
import { formatShape, litValue } from "@nudojs/core";
import { call, throwsError } from "./eval-helpers.ts";

const wrap = (body: string) => `export function f() { ${body} }`;

describe("Bug 328 — 内建原型的 [[Prototype]] 链不再被压扁", () => {
  it("getProto(getProto(Uint8Array.prototype)) === Object.prototype → true（链条错一级已修）", () => {
    const r = call(
      wrap(
        `return Object.getPrototypeOf(Object.getPrototypeOf(Uint8Array.prototype)) === Object.prototype;`,
      ),
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: true });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });

  it("getProto(Array.prototype) === Object.prototype → true（对照组：一层链的原生同款）", () => {
    const r = call(
      wrap(`return Object.getPrototypeOf(Array.prototype) === Object.prototype;`),
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: true });
  });

  it("getProto(Uint8Array.prototype) === Object.prototype → **不是精确 true**（原生 false）", () => {
    // 原生是 false（%TypedArray%.prototype 夹在中间）。修前引擎恒 true
    // （自信的错值）；当前引擎给**保守 boolean 域**（不 ok 的 litValue）——
    // 断言只钉「不得说死 true」，精度债（未说死 false）另行记账。
    const r = call(
      wrap(`return Object.getPrototypeOf(Uint8Array.prototype) === Object.prototype;`),
      "f",
    );
    const lit = litValue(r.result);
    expect(lit.ok === true ? lit.value : undefined).not.toBe(true);
    // 保守域的具体形状：boolean（既非 exact true 也非 exact false）
    expect(formatShape(r.result)).toBe("boolean");
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });
});

describe("Bug 328 — 负控制（内建原型链的相邻形态不回归）", () => {
  it("getProto(Object.prototype) === null → true（链顶恒 null）", () => {
    const r = call(wrap(`return Object.getPrototypeOf(Object.prototype) === null;`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: true });
  });

  it("getProto(getProto(Array.prototype)) === null → true（Array.prototype 上一层即顶）", () => {
    const r = call(
      wrap(`return Object.getPrototypeOf(Object.getPrototypeOf(Array.prototype)) === null;`),
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: true });
  });

  it("typeof Array.prototype === \"object\"（内建原型对象的 typeof 面不回归）", () => {
    const r = call(wrap(`return typeof Array.prototype;`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "object" });
  });
});
