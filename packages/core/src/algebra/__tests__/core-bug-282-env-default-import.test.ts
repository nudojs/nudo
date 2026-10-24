/**
 * Bug 282 —— env 模块（CJS 互操作模块）的 ESM **默认导入**
 * （`import fs from "node:fs"`）此前折 `unknown` ⇒ 导出函数全量降级
 * unknown + **假** `nudo:unknown-inference`（真实原因是绑定没接上，不是
 * 推断失败）+ 门禁**假绿**（exit 0）；而**同一模块**的命名空间导入
 * （`import * as fs`）却正常执法 ⇒ 同一种导入语义两种门禁结论。
 *
 * 根因（core 侧）：`bindImport` 的 `name === "default"` 分支只看
 * `mod.default` 槽；env 表此前**只有具名导出、没有 default 槽** ⇒ 取不到
 * 值 ⇒ 直接折 unknown。
 *
 * core 侧口径（单一事实源 `defaultImportBindingOf`）：
 * - 有 default 槽 ⇒ 用它；
 * - 无 default 槽但表标记了 `interopDefault`（CJS 互操作模块：env 内建
 *   模块的默认导出就是**模块对象本身**，具名导出挂在它上面）⇒ 回退到
 *   **命名空间**；
 * - 否则 ⇒ unknown（普通用户模块缺 default ⇒ 就是没有 default，
 *   Bug 990 口径，**不得**回退到命名空间）。
 *
 * 钉：
 * - 互操作表（interopDefault 标记、无 default 槽）的默认导入 ⇒ 绑到命名
 *   空间 ⇒ 成员可调、返回类型可推、throws 面可见（与命名空间导入**同结论**）；
 * - AST env 绑定面（`bindImports`）同口径；
 * - **负控制**：普通用户模块表（无 default 槽、无互操作标记）的默认导入
 *   ⇒ 仍是 unknown（修前修后一致）；
 * - **对照**：普通用户模块表**有** default 槽 ⇒ 绑到 default 槽。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull } from "../exec/run.ts";
import { num, str, type Abs } from "../abs.ts";
import { absFunction, makeAbsApplyResult } from "../abs-fn.ts";
import { errorTypeAbs } from "../may-throw.ts";
import { formatShape } from "../format.ts";
import { bindImports, namespaceAbsOf, type AbsModuleExports } from "../abs-modules.ts";
import { parseSource } from "../parse-source.ts";
import { emptyEnv } from "../ast-env.ts";

/** 假 env 导出：`fs.readFileSync` 形态（返回字符串 + 可能抛 Error） */
const readFileSyncAbs = absFunction(["p"], {
  apply: () => makeAbsApplyResult(str(), errorTypeAbs("Error")),
});

/** 互操作模块表：CJS 互操作（default = 模块对象本身），**无**物化 default 槽 */
const INTEROP_MOD: AbsModuleExports = {
  named: { readFileSync: readFileSyncAbs },
  interopDefault: true,
};

/** 普通用户模块表：没有 default 导出，也没有互操作标记（负控制） */
const USER_MOD_NO_DEFAULT: AbsModuleExports = { named: { a: num() } };
/** 普通用户模块表：有 default 导出（对照） */
const USER_MOD_WITH_DEFAULT: AbsModuleExports = { named: { a: num() }, default: str() };

const SRC_DEFAULT = `import fs from "./m.js";
export function f() { return fs.readFileSync("/x").length; }
`;
const SRC_NAMESPACE = `import * as fs from "./m.js";
export function f() { return fs.readFileSync("/x").length; }
`;

/** 跑一次导出函数，返回「结果形态 / throws 形态」 */
function callSummary(src: string, mod: AbsModuleExports): string {
  const run = runTranspiled(src, { mode: "analyze", modules: { "./m.js": mod } });
  const r = callTranspiledExportFull(run, "f", []);
  return `${formatShape(r.result)} / throws=${formatShape(r.throws)}`;
}

/** AST env 绑定面：import 说明符 → 绑定值（缺绑定 ⇒ undefined） */
function boundValue(src: string, mod: AbsModuleExports): Abs | undefined {
  const file = parseSource(src);
  const env = emptyEnv();
  const stmt = file.program.body[0];
  expect(stmt?.type).toBe("ImportDeclaration");
  bindImports(stmt as never, env, { "./m.js": mod });
  return env.vars.get("fs") as Abs | undefined;
}

describe("Bug 282：env 模块（CJS 互操作）的 ESM 默认导入", () => {
  it("互操作表：默认导入绑到命名空间 ⇒ 返回类型可推（不再是 unknown）", () => {
    // 修复前：unknown / throws=never（env 表没有 default 槽 ⇒ 直接折 unknown）
    expect(callSummary(SRC_DEFAULT, INTEROP_MOD)).toBe("number / throws=Error");
  });

  it("互操作表：默认导入与命名空间导入**同结论**（含 throws 面）", () => {
    expect(callSummary(SRC_DEFAULT, INTEROP_MOD)).toBe(
      callSummary(SRC_NAMESPACE, INTEROP_MOD),
    );
  });

  it("互操作表：AST env 绑定面（bindImports）同口径 ⇒ 绑到命名空间", () => {
    // 修复前：unknown
    const v = boundValue(`import fs from "./m.js";`, INTEROP_MOD);
    expect(v).toBeDefined();
    expect(v!.shape.k).toBe("obj");
    expect(Object.keys(v!.shape.k === "obj" ? (v!.shape.slots ?? {}) : {})).toEqual([
      "readFileSync",
    ]);
  });

  it("负控制：普通用户模块表缺 default ⇒ 默认导入仍是 unknown", () => {
    // 修前修后一致（Bug 990 口径：模块表有该 mod 但没有 default ⇒ 没有 default）
    expect(callSummary(SRC_DEFAULT, USER_MOD_NO_DEFAULT)).toBe("unknown / throws=never");
    expect(boundValue(`import fs from "./m.js";`, USER_MOD_NO_DEFAULT)?.shape.k).toBe(
      "unknown",
    );
  });

  it("对照：普通用户模块表有 default ⇒ 默认导入绑到 default 槽", () => {
    const src = `import x from "./m.js"; export function f() { return x; }`;
    expect(callSummary(src, USER_MOD_WITH_DEFAULT)).toBe("string / throws=never");
  });

  it("对照：互操作表即使带了物化 default 槽，也绑到 default 槽本身", () => {
    const withDefault: AbsModuleExports = {
      named: { a: num() },
      default: str(),
      interopDefault: true,
    };
    const src = `import x from "./m.js"; export function f() { return x; }`;
    expect(callSummary(src, withDefault)).toBe("string / throws=never");
  });

  it("物化 default 槽（env 表形态）与互操作回退给出同一个绑定值", () => {
    const named = { a: num() };
    const materialized: AbsModuleExports = {
      named,
      default: namespaceAbsOf({ named }),
      interopDefault: true,
    };
    const interopOnly: AbsModuleExports = { named, interopDefault: true };
    const src = `import x from "./m.js"; export function f() { return x.a; }`;
    expect(callSummary(src, materialized)).toBe(callSummary(src, interopOnly));
  });

  it("负控制：互操作表无具名导出时不回退（仍是 unknown）", () => {
    const emptyInterop: AbsModuleExports = { named: {}, interopDefault: true };
    const src = `import x from "./m.js"; export function f() { return x; }`;
    expect(callSummary(src, emptyInterop)).toBe("unknown / throws=never");
  });
});
