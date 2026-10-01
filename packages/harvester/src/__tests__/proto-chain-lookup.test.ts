/**
 * BUG-001 回归（harvester 侧）：lookupHarvested 的模块/导出表裸索引。
 * moduleName/exportName 为 toString 等 Object.prototype 成员且 harvest 表
 * 无同名自有键时，裸读把原型成员当 harvest 导出喂给 formatShape。
 * 存在性必须按自有属性判定。
 */
import { describe, it, expect } from "vitest";
import { lookupHarvested, type PackageHarvest } from "../harvest-package.ts";
import { numLit } from "@nudojs/core";

const h = {
  pkg: "p",
  root: "/",
  dtsFiles: [],
  env: {
    globals: {},
    modules: { m: { a: numLit(1) } },
    stats: { files: 1, symbols: 1, skipped: 0 },
  },
} as unknown as PackageHarvest;

describe("lookupHarvested: Object.prototype names are not harvest exports", () => {
  it("real export still resolves", () => {
    expect(lookupHarvested(h, "m", "a")).toBe("1");
  });

  it("proto-name module / export lookups return undefined", () => {
    // 修复前：modules["m"] 存在但无自有 toString → mod["toString"] 命中
    // Object.prototype.toString → formatShape(宿主函数) 抛 TypeError
    expect(() => lookupHarvested(h, "m", "toString")).not.toThrow();
    expect(lookupHarvested(h, "m", "toString")).toBeUndefined();
    expect(lookupHarvested(h, "m", "constructor")).toBeUndefined();
    // 模块名本身命中原型（modules["toString"]）也不得当模块
    expect(lookupHarvested(h, "toString", "x")).toBeUndefined();
  });
});
