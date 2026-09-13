/**
 * @nudo:mock / sinon 指令 → Abs seed（供 evalProgramAbs）。
 * host 层：依赖 parser 指令形态；core 只吃 seedVars/seedFns。
 */

import type { Node } from "@babel/types";
import type { FunctionWithDirectives } from "@nudojs/parser";
import type { MockHelper, TypeValue } from "@nudojs/core";
import {
  type Abs,
  absFunction,
  emptyEnv,
  typeValueToAbs,
  abs as makeAbs,
  confJoin,
  unknown as absUnknown,
  litValue,
} from "@nudojs/core";

/**
 * mock 依赖结果 conf 不得高于 mock。
 * 必须保留同一对象身份：absFunction 的 impl 挂在 WeakMap 上，
 * makeAbs 新建对象会丢掉 body/apply。
 */
function markMockConf(a: Abs): Abs {
  a.conf = confJoin(a.conf, "mock");
  return a;
}

/** 用常量 Abs 造 mock 函数：调用即返回该值（结果 conf 标 mock） */
function constantMockFn(result: Abs): Abs {
  const marked = markMockConf(result);
  const mockEnv = emptyEnv();
  const retName = "__nudo_mock_ret";
  mockEnv.vars.set(retName, marked);
  const body = {
    type: "BlockStatement",
    body: [
      {
        type: "ReturnStatement",
        argument: { type: "Identifier", name: retName },
      },
    ],
  } as unknown as Node;
  return markMockConf(absFunction(["...args"], { body, env: mockEnv }));
}

/**
 * withArgs 实参匹配（与 mock-helpers.mockArgMatches 同语义）：
 * - 字面量声明要求实参同值字面量
 * - primitive 声明接受同源字面量
 */
function absArgMatches(declared: TypeValue, actual: Abs | undefined): boolean {
  if (!actual) return false;
  const declaredAbs = typeValueToAbs(declared);
  // 同 shape + 同字面量
  const av = litValue(actual);
  const dv = litValue(declaredAbs);
  if (dv !== undefined) {
    return av !== undefined && Object.is(av, dv);
  }
  // declared 是 primitive（如 T.number）：接受同源字面量或同 prim
  if (declared.kind === "primitive") {
    if (actual.shape.k === "prim") return actual.shape.type === declared.type;
    if (av !== undefined) {
      const t = typeof av;
      return (
        (declared.type === "number" && t === "number") ||
        (declared.type === "string" && t === "string") ||
        (declared.type === "boolean" && t === "boolean") ||
        (declared.type === "bigint" && t === "bigint")
      );
    }
  }
  // unknown 声明不视为可证明匹配
  return false;
}

function dispatchMockFn(defaultReturn: Abs, cases?: { args: TypeValue[]; returnValue: TypeValue }[]): Abs {
  if (!cases?.length) return constantMockFn(defaultReturn);
  const caseAbs = cases.map((c) => ({
    declared: c.args,
    result: markMockConf(typeValueToAbs(c.returnValue)),
  }));
  const dummyBody = {
    type: "BlockStatement",
    body: [{ type: "ReturnStatement", argument: null }],
  } as unknown as Node;
  const markedDefault = markMockConf(defaultReturn);
  return markMockConf(absFunction(["...args"], {
    body: dummyBody,
    env: emptyEnv(),
    apply: (args: Abs[]): Abs => {
      for (const c of caseAbs) {
        if (c.declared.every((d, i) => absArgMatches(d, args[i]))) {
          return c.result;
        }
      }
      return markedDefault;
    },
  }));
}

function absFromMockHelper(h: MockHelper): Abs {
  if (h.callsFakeImpl && h.callsFakeImpl.kind === "function") {
    const fn = h.callsFakeImpl;
    return absFunction(fn.params, { body: fn.body, async: false });
  }

  let defaultReturn: Abs;
  if (h.resolvedValue) {
    defaultReturn = makeAbs(
      { k: "eff", eff: "promise", inner: typeValueToAbs(h.resolvedValue) },
      undefined,
      undefined,
      "path",
    );
  } else if (h.rejectedValue) {
    defaultReturn = makeAbs({ k: "never" }, undefined, undefined, "exact");
  } else if (h.returnValue) {
    defaultReturn = typeValueToAbs(h.returnValue);
  } else if (h.onFirstCallValue) {
    // 与 TypeValue 路径一致：无 returnValue 时 onFirstCall 作默认返回
    defaultReturn = typeValueToAbs(h.onFirstCallValue);
  } else {
    defaultReturn = absUnknown;
  }

  return dispatchMockFn(defaultReturn, h.withArgsCases);
}

function absFromSinon(sinonExpr: {
  type: string;
  returnValue?: TypeValue;
  resolvedValue?: TypeValue;
  rejectedValue?: TypeValue;
}): Abs {
  if (sinonExpr.resolvedValue) {
    return constantMockFn(
      makeAbs(
        { k: "eff", eff: "promise", inner: typeValueToAbs(sinonExpr.resolvedValue) },
        undefined,
        undefined,
        "path",
      ),
    );
  }
  if (sinonExpr.rejectedValue) {
    return constantMockFn(makeAbs({ k: "never" }, undefined, undefined, "exact"));
  }
  if (sinonExpr.returnValue) {
    return constantMockFn(typeValueToAbs(sinonExpr.returnValue));
  }
  return constantMockFn(absUnknown);
}

export type AbsMockSeeds = {
  seedVars: Record<string, Abs>;
  seedFns: Record<string, { params: string[]; body: Node; async?: boolean }>;
};

/**
 * B 路径注入用：seedVars + seedFns 统一为 Abs 函数绑定。
 * arrowFn mock 落在 seedFns（AST body，供 ast-eval），B 路径的
 * envGlobals 注入只吃 Abs——不合并会把 mock 丢掉，函数体内的调用
 * 会落到真实原生函数（如 fetch 拿 Abs 当 URL，直接崩）。
 */
export function mockSeedsToAbsMocks(seeds: AbsMockSeeds): Record<string, Abs> {
  const out: Record<string, Abs> = { ...seeds.seedVars };
  for (const [name, fn] of Object.entries(seeds.seedFns)) {
    out[name] = absFunction(fn.params, { body: fn.body, async: fn.async ?? false });
  }
  return out;
}

/** 从函数上的 @nudo:mock 指令收集 Abs seed */
export function mockDirectivesToAbsSeeds(
  functions: Array<{ directives: FunctionWithDirectives["directives"] }>,
): AbsMockSeeds {
  const seedVars: Record<string, Abs> = {};
  const seedFns: AbsMockSeeds["seedFns"] = {};
  for (const fn of functions) {
    for (const d of fn.directives) {
      if (d.kind !== "mock") continue;
      if (d.arrowFn) {
        seedFns[d.name] = {
          params: d.arrowFn.params,
          body: d.arrowFn.body as Node,
          async: false,
        };
      } else if (d.nudoMock) {
        seedVars[d.name] = markMockConf(absFromMockHelper(d.nudoMock));
      } else if (d.sinonExpr) {
        seedVars[d.name] = markMockConf(absFromSinon(d.sinonExpr));
      }
    }
  }
  return { seedVars, seedFns };
}
