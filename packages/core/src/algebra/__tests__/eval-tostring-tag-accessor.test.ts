/**
 * Bug 72：访问器形 @@toStringTag 被 Object.prototype.toString 忽略。
 * 对象字面量 getter（get [Symbol.toStringTag]() { return "T"; }）在
 * transpile 期以占位槽 lit(void 0) 落 shape、真身注册 accessorTable——
 * typeTagOf 只读槽的数据值折不到标签，"[object T]" 错折 "[object Object]"。
 * 修复：typeTagOf / coerceToStringParts 访问器感知（$get 同款读派发调用
 * getter 求值；lit 串折标签、非串 lit 折默认、抽象串不折）；class
 * get [Symbol.toStringTag]() 的 computed 键投影 "@@toStringTag"
 * （@@hasInstance 同款），实例直读与标签折叠同臂。
 */
import { describe, it, expect } from "vitest";
import { litValue, abs } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

function v(src: string): unknown {
  const r = litValue(call(src, "f").result);
  return r.ok ? r.value : undefined;
}

const GETTER_FORM = `const o = { get [Symbol.toStringTag]() { return "T"; } };`;

describe("Bug 72: accessor-form Symbol.toStringTag", () => {
  it("Object.prototype.toString.call → \"[object T]\"", () => {
    expect(v(`export function f() { ${GETTER_FORM} return Object.prototype.toString.call(o); }`)).toBe("[object T]");
  });

  it("o.toString() → \"[object T]\"", () => {
    expect(v(`export function f() { ${GETTER_FORM} return o.toString(); }`)).toBe("[object T]");
  });

  it("模板串 `${o}` → \"[object T]\"（coerceToStringParts 同口径）", () => {
    expect(v(`export function f() { ${GETTER_FORM} return \`\${o}\`; }`)).toBe("[object T]");
  });

  it("标签相等判定", () => {
    expect(v(`export function f() { ${GETTER_FORM} return Object.prototype.toString.call(o) === "[object T]"; }`)).toBe(true);
  });

  it("对照：数据属性形不回归", () => {
    expect(v(`export function f() { return Object.prototype.toString.call({ [Symbol.toStringTag]: "T" }); }`)).toBe("[object T]");
    expect(v(`export function f() { return \`\${ { [Symbol.toStringTag]: "T" } }\`; }`)).toBe("[object T]");
  });

  it("对照：直接 getter 读 o[Symbol.toStringTag] → \"T\"（$get 派发不受影响）", () => {
    expect(v(`export function f() { ${GETTER_FORM} return o[Symbol.toStringTag]; }`)).toBe("T");
  });

  it("class getter 形：computed 键投影 @@toStringTag（直读 + toString）", () => {
    expect(v(`export class C { get [Symbol.toStringTag]() { return "T"; } }
      export function f() { return new C()[Symbol.toStringTag]; }`)).toBe("T");
    expect(v(`export class C { get [Symbol.toStringTag]() { return "T"; } }
      export function f() { return Object.prototype.toString.call(new C()); }`)).toBe("[object T]");
  });

  it("getter 返回非串 → 默认 \"[object Object]\"（native Type(tag)≠String）", () => {
    expect(v(`export function f() { const o = { get [Symbol.toStringTag]() { return 5; } }; return Object.prototype.toString.call(o); }`)).toBe("[object Object]");
    expect(v(`export function f() { const o = { get [Symbol.toStringTag]() { return undefined; } }; return Object.prototype.toString.call(o); }`)).toBe("[object Object]");
  });

  it("getter 返回抽象串 → 不折（string 域，sound skip）", () => {
    const r = call(
      `export function f(s) { const o = { get [Symbol.toStringTag]() { return "tag-" + s; } }; return Object.prototype.toString.call(o); }`,
      "f",
      [abs({ k: "prim", type: "string" }, undefined, undefined, "path")],
    );
    expect(litValue(r.result).ok).toBe(false);
  });

  it("getter 体抛错 → 沿 ToString 链传播（catch 可吸收）", () => {
    expect(v(`export function f() { const o = { get [Symbol.toStringTag]() { throw new RangeError("x"); } };
      try { return Object.prototype.toString.call(o); } catch (e) { return "caught:" + e.name; } }`)).toBe("caught:RangeError");
  });

  it("setter-only 形无标签 → \"[object Object]\"", () => {
    expect(v(`export function f() { const o = { set [Symbol.toStringTag](v) {} }; return Object.prototype.toString.call(o); }`)).toBe("[object Object]");
  });

  it("Map/Set 等内建标签面不回归", () => {
    expect(v(`export function f() { return Object.prototype.toString.call(new Map()); }`)).toBe("[object Map]");
    expect(v(`export function f() { return Object.prototype.toString.call(new Error("m")); }`)).toBe("[object Error]");
    expect(v(`export function f() { return Object.prototype.toString.call({}); }`)).toBe("[object Object]");
    expect(v(`export function f() { return Object.prototype.toString.call([1,2]); }`)).toBe("[object Array]");
  });
});
