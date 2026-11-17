import { describe, it, expect } from "vitest";
import { abs, num, str, objOf, type Abs } from "@nudojs/core";
import { generateGuardFunctionFromAbs } from "../guard-generator.ts";

const arrOf = (element: Abs): Abs => abs({ k: "arr", element }, undefined, undefined, "exact");
const unionOf = (...members: Abs[]): Abs => abs({ k: "sum", members }, undefined, undefined, "exact");

describe("guard-generator", () => {
  it("generates guard for string type", () => {
    const guard = generateGuardFunctionFromAbs("isString", str());
    expect(guard).toContain('typeof data === "string"');
  });

  it("generates guard for object type", () => {
    const obj = objOf({ name: { value: str() }, age: { value: num() } });
    const guard = generateGuardFunctionFromAbs("isUser", obj);
    expect(guard).toContain('typeof data === "object"');
    expect(guard).toContain("data.name");
    expect(guard).toContain("data.age");
  });

  it("generates guard for union type", () => {
    const union = unionOf(str(), num());
    const guard = generateGuardFunctionFromAbs("isStringOrNumber", union);
    expect(guard).toContain("||");
  });

  it("generates guard for array type", () => {
    const guard = generateGuardFunctionFromAbs("isStringArray", arrOf(str()));
    expect(guard).toContain("Array.isArray(data)");
  });
});

describe("槽克隆不得吞掉 __proto__ 槽", () => {
/**
 * `stripInvisibleSlots()` 用**普通对象赋值**克隆槽表（`slots[k] = …`），
 * `k === "__proto__"` 会命中 `Object.prototype.__proto__` 的 setter ⇒ 克隆体
 * 没有该自有键 ⇒ 守卫退化成「只要是对象」：
 *
 * ```ts
 * // 输入 { ["__proto__"]: 1 } 的输出域
 * return typeof data === "object" && data !== null && !Array.isArray(data);   // 旧
 * ```
 *
 * 发布的 `is<fn>Output` 于是**接受** `{}` 与 `{ ["__proto__"]: 2 }`（同一次
 * 导出的 standard / zod 校验器 REJECT）。计算键写法 `["__proto__"]: v`
 * 在对象字面量里创建的是**自有**数据属性 ⇒ 用它造 Abs。
 */
  const protoSlot = (value: Abs): Abs =>
    objOf({ ["__proto__"]: { value } } as Record<string, { value: Abs }>);

  it("顶层 __proto__ 槽：守卫带存在性 + 值子句", () => {
    const guard = generateGuardFunctionFromAbs("isfOutput", protoSlot(num()));
    expect(guard).toContain('Object.hasOwn(data, "__proto__")');
    expect(guard).toContain('data["__proto__"]');
  });

  it("嵌套 __proto__ 槽同样不被吞", () => {
    const nested = objOf({ inner: { value: protoSlot(num()) } });
    const guard = generateGuardFunctionFromAbs("isfOutput", nested);
    expect(guard).toContain('data.inner["__proto__"]');
  });

  it("对照：普通键照旧（不回归）", () => {
    const guard = generateGuardFunctionFromAbs("isfOutput", objOf({ a: { value: num() } }));
    expect(guard).toContain('Object.hasOwn(data, "a")');
    expect(guard).toContain("data.a");
  });
});
