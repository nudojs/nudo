/**
 * Bug 238 回归：`Map.prototype.size` / `Set.prototype.size` 必须**定抛
 * TypeError**（getter 的 brand check——`Map.prototype` 不是 Map 实例）。
 *
 * ES 语义：`size` 是 Map.prototype / Set.prototype 上的**自有 getter**
 * （无 setter）；读原型对象上的它 → this 不是实例 → TypeError。
 *
 * 修复前：漏槽 → 折 exact undefined（wrong-exact），且**不记 throws**
 * ——L2 门禁（entry may-throw）假绿。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call, throwsError } from "./eval-helpers.ts";

const wrap = (body: string) => `export function f() { ${body} }`;

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue(call(src, "f").result);
}

describe("Bug 238 — Map/Set.prototype.size 定抛 TypeError", () => {
  it("Map.prototype.size → TypeError", () => {
    const src = wrap(`try { return String(Map.prototype.size); } catch(e) { return e.constructor.name; }`);
    expect(v(src)).toEqual({ ok: true, value: "TypeError" });
  });

  it("Set.prototype.size → TypeError", () => {
    const src = wrap(`try { return String(Set.prototype.size); } catch(e) { return e.constructor.name; }`);
    expect(v(src)).toEqual({ ok: true, value: "TypeError" });
  });

  it("throws 域记 TypeError（L2 门禁不再假绿）", () => {
    const rec = call(wrap(`return Map.prototype.size;`), "f");
    expect(throwsError(rec.throws, "TypeError")).toBe(true);
  });

  it("负控制：new Map().size → 0（实例面不受影响）", () => {
    expect(v(wrap(`return String(new Map().size);`))).toEqual({ ok: true, value: "0" });
  });

  it("负控制：new Set().size → 0（实例面不受影响）", () => {
    expect(v(wrap(`return String(new Set().size);`))).toEqual({ ok: true, value: "0" });
  });

  it("\"size\" in Map.prototype → true（原型上的自有访问器在 presence 面可见）", () => {
    expect(v(wrap(`return "size" in Map.prototype;`))).toEqual({ ok: true, value: true });
    expect(v(wrap(`return "size" in Set.prototype;`))).toEqual({ ok: true, value: true });
  });

  it("负控制：Map.prototype 上的方法面不受影响（typeof → \"function\"）", () => {
    expect(v(wrap(`return typeof Map.prototype.get;`))).toEqual({ ok: true, value: "function" });
  });
});
