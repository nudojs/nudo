/**
 * `@nudo:mock-module "spec" from "./mock.js"` — file-level module replacement.
 * Full replace swaps the specifier's exports table; partial `{ a, b }` only
 * overlays those named exports and lets the rest fall through.
 *
 * Fail-closed: missing mock file / eval failure / empty binding / **named export
 * the mock does not provide** → error, not a silent drop and not invented types.
 *
 * **同一 specifier 被声明多次**（Bug 1063）：导出表取**并集**（同名后者胜出）
 * ⇒ 先声明者独有的导出名**不再静默消失**；同时发一条**显式诊断**（点名两条
 * 指令的来源）——此前是「后者整块替换前者、零诊断」⇒ 先声明者的导出名静默
 * 蒸发 ⇒ 调用点退化成 `unknown`（wrong-exact）。
 */

import { extractFileDirectives, parse, type FileDirective } from "@nudojs/parser";
import type { AbsModuleExports } from "@nudojs/core";
import { obj as absObj, type Abs } from "@nudojs/core";
import type { LoadModule } from "./load-module.ts";
import { evalExportsToModuleExports } from "./abs-modules-graph.ts";
import { evalMockFileWithDeps } from "./mock-file.ts";
import type { FromMockError } from "./mock-abs.ts";

export type MockModuleApplyResult = {
  modules: Record<string, AbsModuleExports>;
  errors: FromMockError[];
  /** true when at least one mock-module directive was applied */
  applied: boolean;
};

/**
 * 重复 `@nudo:mock-module` 的诊断码。
 *
 * 复用既有注册码 `nudo:mock-invalid`（core 的 DIAG 单一真理源里**没有**
 * 「mock-module 冲突」这一项 ⇒ 新增码只能落在 core 的注册表，而 core 不在
 * 本分片的改动面内 ⇒ 复用）。语义：mock 指令**写法有歧义**（同一 specifier
 * 被声明两次 ⇒ 「谁生效」取决于声明顺序）⇒ 该指令族归入 `nudo:mock-invalid`
 * （warning 级；不挡门禁 exit）。
 */
const MOCK_INVALID_CODE = "nudo:mock-invalid";

function loadMockModuleExports(
  fromPath: string,
  fromFile: string,
  loadModule: LoadModule | undefined,
): { exports?: AbsModuleExports; error?: string } {
  // mock 文件相对 import：evalMockFileWithDeps 以绝对路径为模块图入口
  const evaled = evalMockFileWithDeps(fromPath, fromFile, loadModule);
  if (!evaled.ok) {
    return {
      error:
        evaled.kind === "not-found"
          ? `Mock module not found (from "${fromPath}")`
          : evaled.error,
    };
  }
  const exports = evalExportsToModuleExports(evaled.run, parse(evaled.source), `mock-module:${fromPath}`);
  // CJS/文档示例友好：仅有 named 时合成 default 命名空间，支持
  // `import axios from "axios"` 后 `axios.get(...)`。
  if (exports.default === undefined && Object.keys(exports.named).length > 0) {
    const slots: Record<string, { value: Abs }> = {};
    for (const [k, v] of Object.entries(exports.named)) slots[k] = { value: v };
    exports.default = absObj(slots);
  }
  return { exports };
}

/**
 * 局部（点名）形态的 overlay 取值。
 *
 * `missing` = **被点名但 mock 没有导出**的名字（Bug 963）：点名表是用户声明的
 * 契约（「这个导出要被替换」）⇒ 缺一个就是契约没兑现 ⇒ 由调用方走**错误出口**，
 * **不得**让原模块的同名导出原封不动活下来（那会让分析跑在「一半 mock、
 * 一半原模块」的混合程序上）。
 */
function pickNamed(
  mock: AbsModuleExports,
  names: string[],
): {
  named: Record<string, import("@nudojs/core").Abs>;
  default?: import("@nudojs/core").Abs;
  missing: string[];
} {
  const named: Record<string, import("@nudojs/core").Abs> = {};
  let def: import("@nudojs/core").Abs | undefined;
  const missing: string[] = [];
  for (const n of names) {
    if (n === "default") {
      if (mock.default) def = mock.default;
      else missing.push(n);
      continue;
    }
    // 自有属性读：mock 未导出 toString 等名时裸读会把 Object.prototype 方法叠成 mock 导出
    const v = Object.hasOwn(mock.named, n) ? mock.named[n] : undefined;
    if (v !== undefined) named[n] = v;
    else missing.push(n);
  }
  return def !== undefined ? { named, default: def, missing } : { named, missing };
}

/**
 * 一个 specifier 的 **mock 叠加状态**（Bug 1063）。
 *
 * 与「原模块的导出表」**分开**记账：原模块表是 base（不可变），叠加表只装
 * **mock 提供过**的名字 ⇒ 重复声明时取**并集**（同名后者胜出）⇒ 先声明者
 * 独有的导出名不再静默消失。
 */
type MockOverlay = {
  /** mock 提供的具名导出（并集；同名后者胜出） */
  named: Record<string, Abs>;
  /** mock 提供的 default 槽（后提供者胜出；互操作标记跟着 default 走） */
  default?: {
    value: Abs;
    /** CJS `module.exports = X` 形态：require 返回 default 本身 */
    cjsMain?: boolean;
    /** CJS 互操作模块：默认导入解析到模块对象本身 */
    interopDefault?: boolean;
  };
  /** 是否出现过「整块替换」形态（全量 ⇒ 原模块其余导出**不**回落） */
  full: boolean;
  /** mock 侧是否成功求值（`evaluated` 标记） */
  evaluated: boolean;
};

/** mock 的 default 槽（含互操作标记） */
function defaultSlotOf(mock: AbsModuleExports): MockOverlay["default"] {
  if (mock.default === undefined) return undefined;
  return {
    value: mock.default,
    ...(mock.cjsMain ? { cjsMain: true } : {}),
    ...(mock.interopDefault ? { interopDefault: true } : {}),
  };
}

/**
 * Overlay `@nudo:mock-module` directives onto a modules map.
 * `base` is not mutated; a new map is returned.
 *
 * **重复声明**（Bug 1063）：同一 `d.source` 被多条指令声明 ⇒
 * - 发一条**显式诊断**（点名两条指令的来源；`nudo:mock-invalid` = warning）；
 * - 导出表取**并集**（同名后者胜出）⇒ 先声明者独有的导出名**不再静默消失**
 *   （此前「后者整块替换前者」⇒ 该导出名的调用点退化成 `unknown`）。
 */
export function applyMockModuleDirectives(
  base: Record<string, AbsModuleExports>,
  fileDirectives: FileDirective[],
  opts: { fromFile: string; loadModule?: LoadModule },
): MockModuleApplyResult {
  const mods = fileDirectives.filter((d): d is Extract<FileDirective, { kind: "mock-module" }> =>
    d.kind === "mock-module",
  );
  if (mods.length === 0) {
    return { modules: base, errors: [], applied: false };
  }
  const out: Record<string, AbsModuleExports> = { ...base };
  const errors: FromMockError[] = [];
  let applied = false;
  /** specifier → 首条声明（重复声明诊断的「另一条」来源；Bug 1063） */
  const declared = new Map<string, { fromPath: string }>();
  /** specifier → mock 叠加状态（并集；Bug 1063） */
  const overlays = new Map<string, MockOverlay>();
  for (const d of mods) {
    // Bug 1063：同一 specifier 的**第二条**声明 ⇒ 显式诊断（点名两条来源）。
    // 声明层面的重复与「能不能装载成功」无关 ⇒ 先登记、再装载。
    const firstDecl = declared.get(d.source);
    if (firstDecl) {
      errors.push({
        name: d.source,
        fromPath: d.fromPath,
        message: `Duplicate @nudo:mock-module directive for "${d.source}" — "${firstDecl.fromPath}" and "${d.fromPath}" both declare it; exports are merged (the later declaration wins on the same name)`,
        code: MOCK_INVALID_CODE,
      });
    } else {
      declared.set(d.source, { fromPath: d.fromPath });
    }
    const loaded = loadMockModuleExports(d.fromPath, opts.fromFile, opts.loadModule);
    if (!loaded.exports) {
      errors.push({
        name: d.source,
        fromPath: d.fromPath,
        message: loaded.error ?? `Mock module "${d.fromPath}" could not be loaded`,
      });
      continue;
    }
    const mock = loaded.exports;
    const overlay = overlays.get(d.source) ?? {
      named: {},
      full: false,
      evaluated: false,
    };
    if (!d.names || d.names.length === 0) {
      // full replacement：mock 的**全部**导出并入叠加表
      // （重复声明时与先声明者取**并集**——不再整块覆盖，导出名不消失）。
      overlay.full = true;
      Object.assign(overlay.named, mock.named);
      const slot = defaultSlotOf(mock);
      if (slot) overlay.default = slot;
    } else {
      // partial: listed names from mock, rest fall through to original
      const picked = pickNamed(mock, d.names);
      // Bug 963：点名缺失 ⇒ **fail-closed**（与同函数的「mock 文件缺失」同口径）：
      //   走错误出口（nudo:module-missing ⇒ error），该条指令**不生效**
      //   （applied 不置 true、原模块保持原样）——绝不「一半 mock、一半原模块」。
      if (picked.missing.length > 0) {
        for (const n of picked.missing) {
          errors.push({
            name: d.source,
            fromPath: d.fromPath,
            message: `Mock module "${d.fromPath}" does not export "${n}"`,
          });
        }
        continue;
      }
      Object.assign(overlay.named, picked.named);
      if (picked.default !== undefined) {
        const slot = defaultSlotOf(mock);
        if (slot) overlay.default = slot;
      }
    }
    overlay.evaluated = overlay.evaluated || !!mock.evaluated;
    overlays.set(d.source, overlay);
    // 物化到 modules map：全量形态 ⇒ 原模块的其余导出**不**回落；
    // 局部形态 ⇒ 未点名的名字回落原模块（文档口径：Unspecified exports
    // fall through）。
    const orig = base[d.source] ?? { named: {} };
    const named = overlay.full ? { ...overlay.named } : { ...orig.named, ...overlay.named };
    const merged: AbsModuleExports = {
      named,
      // 任一侧成功求值则合并表可作 missing-export 判定
      ...(overlay.evaluated || (!overlay.full && orig.evaluated) ? { evaluated: true } : {}),
    };
    if (overlay.default) {
      merged.default = overlay.default.value;
      // default 槽的互操作标记跟着 default 走（CJS main ⇒ require 返回 default 本身）
      if (overlay.default.cjsMain) merged.cjsMain = true;
      if (overlay.default.interopDefault) merged.interopDefault = true;
    } else if (!overlay.full && orig.default !== undefined) {
      merged.default = orig.default;
    }
    out[d.source] = merged;
    applied = true;
  }
  return { modules: out, errors, applied };
}

/** Source string → apply mock-module (CLI / one-shot hosts). */
export function applyMockModuleDirectivesFromSource(
  source: string,
  base: Record<string, AbsModuleExports>,
  opts: { fromFile: string; loadModule?: LoadModule },
): MockModuleApplyResult {
  let fileDirectives: FileDirective[] = [];
  try {
    fileDirectives = extractFileDirectives(parse(source));
  } catch {
    fileDirectives = [];
  }
  return applyMockModuleDirectives(base, fileDirectives, opts);
}
