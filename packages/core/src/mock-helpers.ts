/**
 * Nudo Mock 帮助函数
 *
 * 提供类型安全的 mock 创建，替代 sinon 表达式
 */

import { type TypeValue, T } from "./type-value.ts";
import type { Environment } from "./environment.ts";

export type MockHelper = {
  kind: "mock-helper";
  returnValue?: TypeValue;
  resolvedValue?: TypeValue;
  rejectedValue?: TypeValue;
  implementation?: (...args: TypeValue[]) => TypeValue;
  onFirstCallValue?: TypeValue;
  onSecondCallValue?: TypeValue;
  withArgsCases?: { args: TypeValue[]; returnValue: TypeValue }[];
  callsFakeImpl?: TypeValue;
};

/**
 * 创建一个 stub mock
 * 用法: @nudo:mock fetch = stub()
 */
export function stub(): MockHelper {
  return { kind: "mock-helper" };
}

/**
 * 创建一个返回指定值的 stub
 * 用法: @nudo:mock fetch = stub().returns({ data: "test" })
 */
stub.returns = function(value: TypeValue): MockHelper {
  return { kind: "mock-helper", returnValue: value };
};

/**
 * 创建一个返回 Promise 的 stub
 * 用法: @nudo:mock fetch = stub().resolves({ data: "test" })
 */
stub.resolves = function(value: TypeValue): MockHelper {
  return { kind: "mock-helper", resolvedValue: value };
};

/**
 * 创建一个拒绝 Promise 的 stub
 * 用法: @nudo:mock fetch = stub().rejects(new Error("fail"))
 */
stub.rejects = function(value: TypeValue): MockHelper {
  return { kind: "mock-helper", rejectedValue: value };
};

stub.onFirstCall = function(value: TypeValue): MockHelper {
  return { kind: "mock-helper", onFirstCallValue: value };
};

stub.onSecondCall = function(value: TypeValue): MockHelper {
  return { kind: "mock-helper", onSecondCallValue: value };
};

stub.withArgs = function(...args: TypeValue[]): MockHelper {
  return { kind: "mock-helper", withArgsCases: [{ args, returnValue: T.unknown }] };
};

stub.callsFake = function(fn: TypeValue): MockHelper {
  return { kind: "mock-helper", callsFakeImpl: fn };
};

/**
 * 创建一个 spy mock
 * 用法: @nudo:mock handler = spy()
 */
export function spy(): MockHelper {
  return { kind: "mock-helper" };
}

spy.returns = function(value: TypeValue): MockHelper {
  return { kind: "mock-helper", returnValue: value };
};

/**
 * 创建一个 mock
 * 用法: @nudo:mock service = mock()
 */
export function mock(): MockHelper {
  return { kind: "mock-helper" };
}

/**
 * 将 MockHelper 转换为 TypeValue
 */
export function mockHelperToTypeValue(helper: MockHelper, env: Environment): TypeValue {
  const body = { type: "BlockStatement", body: [] } as any;
  const fn = T.fn(["...args"], body, env);

  if (helper.callsFakeImpl) {
    (fn as any)._directReturn = helper.callsFakeImpl;
  } else if (helper.resolvedValue) {
    (fn as any)._directReturn = T.promise(helper.resolvedValue);
  } else if (helper.rejectedValue) {
    (fn as any)._directReturn = T.never;
  } else if (helper.returnValue) {
    (fn as any)._directReturn = helper.returnValue;
  } else if (helper.onFirstCallValue) {
    (fn as any)._directReturn = helper.onFirstCallValue;
  } else {
    (fn as any)._directReturn = T.unknown;
  }

  return fn;
}
