/**
 * Nudo Mock 帮助函数
 *
 * 提供类型安全的 mock 创建，替代 sinon 表达式。
 * 值字段为 Abs（TypeValue 退出后真理源）；parser 经 typeValueToAbs 桥入。
 * Abs 路径经 mock-abs.ts / mockDirectivesToAbsSeeds 消费。
 */

import type { Abs } from "./algebra/abs.ts";
import type { Node } from "@babel/types";

export type MockHelper = {
  kind: "mock-helper";
  returnValue?: Abs;
  resolvedValue?: Abs;
  rejectedValue?: Abs;
  onFirstCallValue?: Abs;
  onSecondCallValue?: Abs;
  withArgsCases?: { args: Abs[]; returnValue: Abs }[];
  /** callsFake 的函数体（AST）；params 同步存下供 Abs absFunction */
  callsFakeImpl?: { params: string[]; body: Node; async?: boolean };
};

/**
 * 创建一个 stub mock
 * 用法: @nudo:mock fetch = stub()
 */
export function stub(): MockHelper {
  return { kind: "mock-helper" };
}

stub.returns = function(value: Abs): MockHelper {
  return { kind: "mock-helper", returnValue: value };
};

stub.resolves = function(value: Abs): MockHelper {
  return { kind: "mock-helper", resolvedValue: value };
};

stub.rejects = function(value: Abs): MockHelper {
  return { kind: "mock-helper", rejectedValue: value };
};

stub.onFirstCall = function(value: Abs): MockHelper {
  return { kind: "mock-helper", onFirstCallValue: value };
};

stub.onSecondCall = function(value: Abs): MockHelper {
  return { kind: "mock-helper", onSecondCallValue: value };
};

stub.withArgs = function(...args: Abs[]): MockHelper {
  // returnValue 由后续 .returns() 链覆盖；占位 unknown
  const unknownAbs: Abs = { shape: { k: "unknown" }, conf: "partial" };
  return { kind: "mock-helper", withArgsCases: [{ args, returnValue: unknownAbs }] };
};

stub.callsFake = function(fn: { params: string[]; body: Node; async?: boolean }): MockHelper {
  return { kind: "mock-helper", callsFakeImpl: fn };
};

/**
 * 创建一个 spy mock
 * 用法: @nudo:mock handler = spy()
 */
export function spy(): MockHelper {
  return { kind: "mock-helper" };
}

spy.returns = function(value: Abs): MockHelper {
  return { kind: "mock-helper", returnValue: value };
};

/**
 * 创建一个 mock
 * 用法: @nudo:mock service = mock()
 */
export function mock(): MockHelper {
  return { kind: "mock-helper" };
}
