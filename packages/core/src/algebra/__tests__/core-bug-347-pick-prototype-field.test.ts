/**
 * Bug 347 —— `pick(shape({…}), keys)` 用 `d.fields[k]` 取字段，**沿原型链读**：
 * `"constructor"` / `"toString"` / `"valueOf"` 会命中 `Object.prototype` 成员，
 * 判真后被当成字段塞进新字段表 ⇒ 消费端读 `f.constraint` 拿到 `undefined`
 * ⇒ `nudo contract` / `nudo export` 面裸崩（内部 TypeError 外泄），
 * `nudo check` 面整条契约静默作废（假绿）。
 *
 * 修法（core/algebra/constraint.ts `pick`）：取字段用**自有属性**判定
 * （`Object.hasOwn`）——原型链成员与非自有键一律视作「不存在的 key」忽略。
 */
import { describe, it, expect } from "vitest";
import {
  constraintToEntryAbs,
  instantiateConstraint,
  number,
  pick,
  shape,
} from "../constraint.ts";

const PROTO_KEYS = ["constructor", "toString", "valueOf", "hasOwnProperty"];

describe("Bug 347：pick 不把原型链成员当字段", () => {
  it("原型链 key 不进字段表（constructor / toString / valueOf …）", () => {
    for (const k of PROTO_KEYS) {
      const p = pick(shape({ a: number() }), [k]);
      const fields = p.fields ?? {};
      expect(Object.prototype.hasOwnProperty.call(fields, k)).toBe(false);
    }
  });

  it("字段表里的每个条目都是真字段（带 constraint）", () => {
    const p = pick(shape({ a: number() }), ["a"]);
    const fields = p.fields ?? {};
    expect(Object.keys(fields)).toEqual(["a"]);
    expect(fields["a"]!.constraint).toBeDefined();
  });

  it("原型链 key 不得让契约崩溃（entry Abs / 实例化面）", () => {
    const p = pick(shape({ a: number() }), ["constructor"]);
    expect(() => constraintToEntryAbs(p, "x")).not.toThrow();
    expect(() => instantiateConstraint(p, "x")).not.toThrow();
  });

  it("合法 key 仍然取到字段", () => {
    const p = pick(shape({ a: number(), b: number() }), ["b"]);
    expect(Object.keys(p.fields ?? {})).toEqual(["b"]);
  });
});
