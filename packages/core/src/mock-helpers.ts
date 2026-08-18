/**
 * Nudo Mock 帮助函数
 *
 * 提供类型安全的 mock 创建，替代 sinon 表达式
 */

import { type TypeValue, T, typeValueEquals } from "./type-value.ts";
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
 * withArgs 实参匹配（sinon 深比较的保守近似）：
 * - 字面量声明要求实参为同值字面量（withArgs(21) 只匹配调用实参 literal 21）；
 * - primitive 声明（T.number 等）接受同源字面量（21 是 number）；
 * - 其余（unknown 声明等）不视为可证明匹配，走默认 stub 行为。
 */
function mockArgMatches(declared: TypeValue, actual: TypeValue | undefined): boolean {
  if (actual === undefined) return false;
  if (typeValueEquals(declared, actual)) return true;
  if (declared.kind === "primitive" && actual.kind === "literal") {
    const t = typeof actual.value;
    return (
      (declared.type === "number" && t === "number") ||
      (declared.type === "string" && t === "string") ||
      (declared.type === "boolean" && t === "boolean") ||
      (declared.type === "bigint" && t === "bigint") ||
      (declared.type === "symbol" && t === "symbol")
    );
  }
  return false;
}

/**
 * 将 MockHelper 转换为 TypeValue
 */
export function mockHelperToTypeValue(helper: MockHelper, env: Environment): TypeValue {
  // callsFake(fn)（sinon 语义）：stub 的调用 = 以实参执行 fn。
  // 直接绑定 fn 本身，与 @nudo:mock f = (x) => ... 的箭头函数值绑定走同一机制
  // （evaluator callFunction 的参数绑定 + 函数体求值）。不能设 _directReturn ——
  // 那会把「fake 函数值」本身当调用结果传播，经 HOF 进一步污染下游。
  if (helper.callsFakeImpl) {
    if (helper.callsFakeImpl.kind === "function") {
      return helper.callsFakeImpl;
    }
    // 非函数 fake 无「以实参执行」语义可言，退化为直接返回该值
    const plain = T.fn(["...args"], { type: "BlockStatement", body: [] } as any, env);
    (plain as any)._directReturn = helper.callsFakeImpl;
    return plain;
  }

  let defaultReturn: TypeValue;
  if (helper.resolvedValue) {
    defaultReturn = T.promise(helper.resolvedValue);
  } else if (helper.rejectedValue) {
    defaultReturn = T.never;
  } else if (helper.returnValue) {
    defaultReturn = helper.returnValue;
  } else if (helper.onFirstCallValue) {
    defaultReturn = helper.onFirstCallValue;
  } else {
    defaultReturn = T.unknown;
  }

  // withArgs 分派（sinon 语义）：实参匹配的链返回其 returnValue，未命中走默认
  // stub 行为。经 fnSig impl 在调用时拿实参判定，优先于任何固定返回值。
  if (helper.withArgsCases?.length) {
    const cases = helper.withArgsCases;
    return T.fnSig(
      cases[0].args.map(() => T.unknown),
      T.union(...cases.map((c) => c.returnValue), defaultReturn),
      T.never,
      (args) => {
        for (const c of cases) {
          if (c.args.every((a, i) => mockArgMatches(a, args[i]))) {
            return c.returnValue;
          }
        }
        return defaultReturn;
      },
    );
  }

  const body = { type: "BlockStatement", body: [] } as any;
  const fn = T.fn(["...args"], body, env);
  (fn as any)._directReturn = defaultReturn;
  return fn;
}
