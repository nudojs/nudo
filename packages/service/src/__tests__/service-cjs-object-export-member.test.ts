/**
 * BUG-045 回归：CJS `module.exports = { … }` 形态的**成员函数**必须能求值。
 *
 * 症状：同一份 `x + 1`，三种 CJS 写法里只有对象字面量形态在导出面丢类型 ——
 * `nudo check` 说 `h(x: any) => number | string`，而 `nudo export`（dts /
 * schema / guard 三方言）说 `unknown` / `z.unknown()` / `return true`（校验器
 * 变成「接受一切」的假绿）。
 *
 * 根因：入口求值**按名字**解析（`tryEvalCallFull` → `run.exports[fnName]`），
 * 而 `module.exports = { h(){} }` 的 `h` 既不是模块作用域绑定、也不是顶层导出
 * 槽（导出表只有 `default` 槽，成员挂在那个对象上）⇒ 按名取落空 ⇒ 回落
 * `unknown`。普查（`collectTopLevelFunctions` 的 CJS 分支）与 core 的导出槽
 * 解析（`algebra/export-slot.ts` 的 `cjs-member`）都以**成员键**为导出槽口径
 * ⇒ 求值面按同一张表派发。
 *
 * 断言面：
 * 1. 对象字面量形态的 `combinedAbs` 与 `module.exports.h = fn` / ESM 形态**同源**
 *    （导出面消费的就是 `combinedAbs`）；
 * 2. 不得凭空合成调用点见证（`call@`）——合成入口调用不是源码里的调用点；
 * 3. 成员方法体内的 `this` 绑定正确（按 `$invoke` 派发，不是裸值 apply）；
 * 4. 成员体必抛 ⇒ `never` + throws（不回落成 unknown）。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import {
  formatShape,
  resetCheckSourceMemo,
  resetGeneralizeMemo,
  resetNudoModuleExecCache,
  resetParseSourceCache,
  setEvalFallbackCollector,
  type EvalFallback,
} from "@nudojs/core";
import { resetAbsCallBudget } from "@nudojs/core/internal";
import { analyzeFileAsync } from "@nudojs/service";
import { clearEvalCache, tryEvalCallFull } from "../eval-run.ts";
import { clearAbsModuleCache } from "../abs-modules-graph.ts";
import { tmpProject } from "./tmp-project.ts";

// ---------------------------------------------------------------------------
// 漂移门：invokeCjsMember（eval-run）是导出调用之外的第三份调用/退出/异常
// 骨架——core 的 runExportCallGuarded 演进时，本组测试钉住它的**异常分类
// 口径**不单边漂移：NudoThrow = 用户 throw（never + 载荷，不进 fallback
// 计数）；其它原生异常 = 引擎缺陷（必须 noteEvalFallback 可观测 + undefined）。
// ---------------------------------------------------------------------------
const cjsInvokeState = vi.hoisted(() => ({ failNative: false }));

vi.mock("@nudojs/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nudojs/core")>();
  return {
    ...actual,
    // $invoke 在 service 层仅 eval-run 的 invokeCjsMember（CJS 成员派发点）
    // 消费；core 内部转译执行走包内相对 import，不经本 mock——模块装载
    // 照常成功，故障只注入到成员调用边界。
    $invoke: (...a: Parameters<typeof actual.$invoke>) => {
      if (cjsInvokeState.failNative) throw new TypeError("engine defect (drift gate)");
      return actual.$invoke(...a);
    },
  };
});

beforeEach(() => {
  cjsInvokeState.failNative = false;
  resetCheckSourceMemo();
  resetGeneralizeMemo();
  resetNudoModuleExecCache();
  resetParseSourceCache();
  resetAbsCallBudget();
  clearEvalCache();
  clearAbsModuleCache();
});

async function analyze(source: string) {
  const dir = tmpProject("nudo-b045-");
  const file = join(dir, "mod.js");
  writeFileSync(file, source, "utf-8");
  const r = await analyzeFileAsync(file, source, undefined, undefined, undefined, "all");
  return r.functions;
}

const OBJ_LITERAL = `module.exports = {
  h(x) {
    return x + 1;
  },
};
`;

const DOT_ASSIGN = `module.exports.h = function (x) {
  return x + 1;
};
`;

const ESM = `export function h(x) {
  return x + 1;
}
`;

describe("BUG-045 · CJS `module.exports = { … }` 成员函数求值", () => {
  it("对象字面量形态的 combinedAbs 与 dot 形态 / ESM 形态同源", async () => {
    const obj = await analyze(OBJ_LITERAL);
    const dot = await analyze(DOT_ASSIGN);
    const esm = await analyze(ESM);

    const h = (fns: Awaited<ReturnType<typeof analyze>>) => {
      const fn = fns.find((f) => f.name === "h");
      expect(fn, "h 必须被普查到").toBeDefined();
      expect(fn!.combinedAbs, "combinedAbs 必须存在").toBeDefined();
      return fn!.combinedAbs!;
    };

    const objAbs = h(obj);
    // 根因钉子：不得退化成 bare unknown（unknown = 推断失败，不是「入口无约束」）
    expect(objAbs.shape.k).not.toBe("unknown");
    expect(formatShape(objAbs)).toBe("number | string");
    expect(formatShape(objAbs)).toBe(formatShape(h(dot)));
    expect(formatShape(objAbs)).toBe(formatShape(h(esm)));
  });

  it("成员入口见证是 entry@，且**不得**凭空合成 call@ 调用点见证", async () => {
    const fns = await analyze(OBJ_LITERAL);
    const h = fns.find((f) => f.name === "h")!;
    const names = h.cases.map((c) => c.name);
    expect(names.some((n) => n.startsWith("entry@"))).toBe(true);
    // 源码里没有任何 `h(...)` 调用 ⇒ 任何 `call@` 都是合成派发伪造的调用点
    // （`callsiteCaseName` 的 fallbackLine 会把成员定义行冒充成调用行）。
    expect(names.filter((n) => n.startsWith("call@"))).toEqual([]);
  });

  it("成员方法体内的 this 绑定正确（按接收者派发，不是裸值 apply）", async () => {
    const fns = await analyze(`module.exports = {
  n: 1,
  bump() {
    return this.n;
  },
};
`);
    const bump = fns.find((f) => f.name === "bump")!;
    expect(formatShape(bump.combinedAbs!)).toBe("1");
  });

  it("成员体必抛 ⇒ never + throws（不回落成 unknown）", async () => {
    const fns = await analyze(`module.exports = {
  boom() {
    throw new Error("x");
  },
};
`);
    const boom = fns.find((f) => f.name === "boom")!;
    expect(formatShape(boom.combinedAbs!)).toBe("never");
    const witness = boom.cases.find((c) => c.name.startsWith("entry@"))!;
    expect(formatShape(witness.throwsAbs)).toBe("Error");
  });
});

describe("invokeCjsMember 异常分类漂移门（与 core runExportCallGuarded 骨架钉同）", () => {
  it("NudoThrow ⇒ never + 载荷，且不进 fallback 计数（用户 throw 不是引擎回落）", () => {
    const fallbacks: EvalFallback[] = [];
    setEvalFallbackCollector((f) => fallbacks.push(f));
    try {
      const full = tryEvalCallFull(
        `module.exports = {\n  boom() {\n    throw new Error("x");\n  },\n};\n`,
        "/t/b045-guard.js",
        "boom",
        [],
      );
      expect(full).toBeDefined();
      expect(full!.result.shape.k).toBe("never");
      expect(formatShape(full!.throws)).toBe("Error");
      // 分类口径：NudoThrow 若被误喂 noteEvalFallback 会落成
      // reason=module-throw / message=nudo:throw 的计数事件
      expect(
        fallbacks.filter((f) => f.reason === "module-throw" && f.message === "nudo:throw"),
        "NudoThrow 不得吃进 fallback 计数",
      ).toEqual([]);
    } finally {
      setEvalFallbackCollector(null);
    }
  });

  it("其它原生异常 ⇒ noteEvalFallback 可观测 + fail-closed undefined（不静默吞）", () => {
    const fallbacks: EvalFallback[] = [];
    setEvalFallbackCollector((f) => fallbacks.push(f));
    cjsInvokeState.failNative = true;
    try {
      const full = tryEvalCallFull(
        `module.exports = {\n  h() {\n    return 1;\n  },\n};\n`,
        "/t/b045-guard.js",
        "h",
        [],
      );
      expect(full).toBeUndefined();
      expect(
        fallbacks.some((f) => /engine defect \(drift gate\)/.test(f.message)),
        "原生异常必须经 noteEvalFallback 可观测",
      ).toBe(true);
    } finally {
      cjsInvokeState.failNative = false;
      setEvalFallbackCollector(null);
    }
  });
});
