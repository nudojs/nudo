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
  unknown as absUnknown,
} from "@nudojs/core";

/** 用常量 Abs 造 mock 函数：调用即返回该值 */
function constantMockFn(result: Abs): Abs {
  const mockEnv = emptyEnv();
  const retName = "__nudo_mock_ret";
  mockEnv.vars.set(retName, result);
  const body = {
    type: "BlockStatement",
    body: [
      {
        type: "ReturnStatement",
        argument: { type: "Identifier", name: retName },
      },
    ],
  } as unknown as Node;
  return absFunction(["...args"], { body, env: mockEnv });
}

function absFromMockHelper(h: MockHelper): Abs {
  if (h.callsFakeImpl && h.callsFakeImpl.kind === "function") {
    const fn = h.callsFakeImpl;
    return absFunction(fn.params, { body: fn.body, async: false });
  }
  if (h.resolvedValue) {
    return constantMockFn(
      makeAbs(
        { k: "eff", eff: "promise", inner: typeValueToAbs(h.resolvedValue) },
        undefined,
        undefined,
        "path",
      ),
    );
  }
  if (h.rejectedValue) {
    return constantMockFn(makeAbs({ k: "never" }, undefined, undefined, "exact"));
  }
  if (h.returnValue) {
    return constantMockFn(typeValueToAbs(h.returnValue));
  }
  return constantMockFn(absUnknown);
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
  if (sinonExpr.returnValue) {
    return constantMockFn(typeValueToAbs(sinonExpr.returnValue));
  }
  return constantMockFn(absUnknown);
}

export type AbsMockSeeds = {
  seedVars: Record<string, Abs>;
  seedFns: Record<string, { params: string[]; body: Node; async?: boolean }>;
};

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
        seedVars[d.name] = absFromMockHelper(d.nudoMock);
      } else if (d.sinonExpr) {
        seedVars[d.name] = absFromSinon(d.sinonExpr);
      }
    }
  }
  return { seedVars, seedFns };
}
