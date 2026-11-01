/**
 * 单源 parity 钉住：CONSTRAINT_CHAIN_METHOD_NAMES ↔ makeBuilder 挂到
 * builder 对象上的方法面。parser 侧链式白名单（case-arg.ts）从该名单
 * 单源导入——core 给 builder 新增/改名链式方法而忘了同步名单时，这里
 * 先红（否则新方法在 @nudo:contract / case 文法里被静默拒绝）。
 */
import { describe, it, expect } from "vitest";
import {
  CONSTRAINT_BUILDERS,
  CONSTRAINT_CHAIN_METHOD_NAMES,
  number,
} from "../constraint.ts";

describe("CONSTRAINT_CHAIN_METHOD_NAMES parity（makeBuilder 方法面）", () => {
  it("名单里的每个方法在（无参可构造的）构建器上都可调用", () => {
    for (const factory of Object.values(CONSTRAINT_BUILDERS)) {
      let builder: object;
      try {
        builder = (factory as () => object)();
      } catch {
        // 需参构建器（lit/union/fn/partial/…）无参构造抛错——跳过；方法面
        // 由 makeBuilder 单点挂载，number() 的全量键集由下一用例钉住。
        continue;
      }
      for (const m of CONSTRAINT_CHAIN_METHOD_NAMES) {
        expect(typeof (builder as Record<string, unknown>)[m]).toBe("function");
      }
    }
  });

  it("builder 的可调用键集 === 名单（新增链式方法必须先进名单）", () => {
    const face = Object.keys(number()).filter(
      (k) => typeof (number() as Record<string, unknown>)[k] === "function",
    );
    expect(new Set(face)).toEqual(new Set(CONSTRAINT_CHAIN_METHOD_NAMES));
  });
});
