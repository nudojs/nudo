/**
 * Interface 分层推导（design-refine-derivation §2.1/§2.2/§11 第 0 步）：
 *
 *   effectiveInterface(source, fnName) —— 手写 ∪ 侧车同名绑定 ∪ 生成段的
 *   唯一读取口，来源标注（handwritten / generated / implicit）随值返回。
 *
 * 来源三层（合并序 handwritten > generated > implicit，§4/§11）：
 * - handwritten：源码 `@nudo:contract`/`@nudo:contract` 行（复用 refine.ts 的
 *   extractRefinesFromSource / extractRefineReturnFromSource）∪ 侧车同名**手写**
 *   fn() 绑定。同名同参取合取 and()（§2.1：侧车 x>0 + 源码 x>1 → 有效契约
 *   取合取）；常数界交叉矛盾（x>0 ∧ x<0）→ conflict 标记，由调用方报
 *   nudo:interface-conflict——本函数不 throw。
 * - generated：侧车同名导出且声明上方注释块含 @generated 标记（emit 产物）。
 *   与手写并存时整体降级忽略（手写为准；混排由 nudo:interface-name-clash /
 *   drift 在 emit/check 侧处理）。
 * - implicit：无任何契约 → 返回 undefined（隐式推断是调用方的事）。
 *
 * 自动绑定边界（§2.2）：只绑源文件**本地 named export**（re-export /
 * export default / 私有名不绑）；opts.autoBind === false 或侧车路径含
 * /node_modules/ → 不 ambient 加载（只看源码 refine）。opts.projectDir
 * 提供时，树外侧车不 ambient 绑定（host 从 findProjectConfig 下传）。
 *
 * 侧车绑定 Phase 1 只承诺 fn() 形态：非 fn 的标量/shape 绑定不消费，收集
 * nudo:interface-load 诊断（后续 Phase 再放开单参形态）。
 *
 * 诊断走本文件独立 side-channel（先例 refine.ts 的 setRefineDiagCollector）：
 * 侧车加载/执行失败 → nudo:interface-cycle / nudo:interface-load。
 */

import type { Pred } from "./pred.ts";
import { predToString } from "./pred.ts";
import type { Term } from "./term.ts";
import { termToString } from "./term.ts";
import { parseSource } from "./parse-source.ts";
import { hashSource } from "./hash-source.ts";
import { identBoundaryRegex } from "./code-text.ts";
import { isNodeModulesPath, resolveDepPath, sidecarPathOf } from "./sidecar-path.ts";
// 诊断 side-channel 共享原语（与 refine 通道同一实现，leaf 无环）
import { createScopedDiagChannel } from "./diag-channel.ts";
import {
  createScopedSlot,
  registerCollectorScopeParticipant,
} from "./collector-scope.ts";
import {
  type NudoConstraint,
  isNudoConstraint,
  fnConstraintToEntryReqs,
  throwConstraintToKinds,
  andC,
  isIntFlag,
} from "./constraint.ts";
import {
  execNudoModule,
  NudoSidecarError,
  extractRefinesFromSource,
  extractRefineReturnFromSource,
  extractDeclaredThrows,
  refineDiagCount,
  takeRefineDiagsSince,
  type RefineResolveOpts,
} from "./refine.ts";

// 单一定义在 sidecar-path.ts（leaf）；re-export 维持 @nudojs/core 导出面稳定
export { sidecarPathOf, isNodeModulesPath };

// ---------------------------------------------------------------------------
// 诊断 side-channel（镜像 refine.ts 的 RefineDiag 机制）
// ---------------------------------------------------------------------------

/** interface 推导诊断（severity 由消费方按 code 定档，形状对齐 Issue 子集） */
export type InterfaceDiag = { code: string; message: string; file?: string };

/** 防长会话无界增长；消费方 takeInterfaceDiags 按批取走 */
const MAX_INTERFACE_DIAGS = 1024;
/** 诊断 side-channel 单一定义：diag-channel.ts 共享原语（seq/since 语义见彼处）。
 *  作用域化：见 refine.ts refineDiagChannel 注释。 */
const interfaceDiagChannel = createScopedDiagChannel<InterfaceDiag>(MAX_INTERFACE_DIAGS);
registerCollectorScopeParticipant((body) => interfaceDiagChannel.runScoped(body));

/** 设置诊断观察者（null 清除）；缓冲照常累积，takeInterfaceDiags 取走 */
export function setInterfaceDiagCollector(
  fn: ((d: InterfaceDiag) => void) | null,
): void {
  interfaceDiagChannel.setCollector(fn);
}

/** 当前诊断累计序号（since 锚：工具面只排干自身探测产生的增量） */
export function interfaceDiagCount(): number {
  return interfaceDiagChannel.count();
}

/** 取走已收集的诊断（收集即清空） */
export function takeInterfaceDiags(): InterfaceDiag[] {
  return interfaceDiagChannel.take();
}

/**
 * 只取走 seq > since 的诊断（清空仅限增量）——LSP 长驻进程里 lens/打印/
 * emit 工具用它排干**自身探测**产生的诊断，不窃取在途 validateText 待消费
 * 的接口诊断（全量 take 曾在 await 窗口偷走 checkSource 的待收诊断）。
 */
export function takeInterfaceDiagsSince(since: number): InterfaceDiag[] {
  return interfaceDiagChannel.takeSince(since);
}

function collectDiag(d: InterfaceDiag): void {
  interfaceDiagChannel.emit(d);
}

// ---------------------------------------------------------------------------
// 侧车路径 / 本地导出表 / 生成段识别
// ---------------------------------------------------------------------------

/** 有效契约来源：手写（源码 refine ∪ 侧车手写绑定）> 生成段 > 隐式 */
export type InterfaceSource = "handwritten" | "generated" | "implicit";

// sidecarPathOf 定义已收敛至 sidecar-path.ts（leaf），文件头 re-export
// 本地导出表 / 导出名查询 / 生成段识别 → scan-named-exports.ts（纯 AST 解析层）；
// re-export 维持本文件既有导出面（algebra/index.ts / src/internal.ts 消费不变）
export { exportedNameOfLocal, generatedExportNames, localNamedExports } from "./scan-named-exports.ts";
import { exportedNameOfLocal, generatedExportNames, localNamedExports } from "./scan-named-exports.ts";


// ---------------------------------------------------------------------------
// effectiveInterface
// ---------------------------------------------------------------------------

export type EffectiveInterfaceOpts = RefineResolveOpts & {
  /** false（或谓词返回 false）→ 不 ambient 加载侧车；默认 true */
  autoBind?: boolean | ((sidecarPath: string) => boolean);
  /**
   * 项目根（host 从 findProjectConfig 下传）。提供时 ambient 绑定仅接受
   * 树内侧车；树外 → 不加载。undefined = 不限（测试/脚本；node_modules 仍拦）。
   */
  projectDir?: string;
};

export type EffectiveInterface = {
  fnName: string;
  params: Array<{ param: string; constraint: NudoConstraint }>;
  returns?: { constraint: NudoConstraint };
  /** 申报式抛错（@nudo:throws / case !! throws / sidecar fn.throws） */
  throws?: { kinds: string[] | "*" };
  source: InterfaceSource;
  /**
   * 合取不可满足标记：params = 常数界交叉矛盾（或 prim 矛盾等 and() 不可
   * 合取形态）的参数名；returns = 返回位同样不可满足。调用方报
   * nudo:interface-conflict 并跳过对应位执法。
   */
  conflict?: { params: string[]; returns?: boolean };
};

/** 路径是否落在 projectDir 内（含根本身）；分隔符归一后前缀比较 */
function isUnderProjectRoot(sidecarPath: string, projectDir: string): boolean {
  const norm = (p: string): string => p.split("\\").join("/").replace(/\/+$/, "");
  const root = norm(projectDir);
  const sc = norm(sidecarPath);
  return sc === root || sc.startsWith(`${root}/`);
}

/** 自动绑定边界：node_modules / 树外侧车永不 ambient 加载；autoBind 可关（§2.2） */
function sidecarAutoBindAllowed(
  sidecarPath: string,
  autoBind: boolean | ((sidecarPath: string) => boolean) | undefined,
  projectDir?: string,
): boolean {
  if (isNodeModulesPath(sidecarPath)) return false;
  if (projectDir && !isUnderProjectRoot(sidecarPath, projectDir)) return false;
  if (autoBind === undefined || autoBind === true) return true;
  if (typeof autoBind === "function") return autoBind(sidecarPath) === true;
  return false;
}

/** 侧车同名绑定（已过 autoBind/本地导出门）；无侧车来源 → undefined */
type SidecarBinding =
  | {
      ok: true;
      sidecarPath: string;
      /** fn() 形态约束（Phase 1 唯一消费形态；非 fn 形态已收集诊断） */
      constraint: NudoConstraint & { fn: NonNullable<NudoConstraint["fn"]> };
      generated: boolean;
    }
  | { ok: false };

/** 本地声明名是否以 default 形态导出（C4.4：`export { x as default }` / `export default function x`） */
function isDefaultExportLocal(source: string, localName: string): boolean {
  // JS 标识符含 `$`：`\b` 把 `$` 当非词，`export { $fn as default }` 会漏。
  // 边界统一走 identBoundaryRegex（`Store.get` 的 `.` 由 escapeRegExp 处理）。
  const name = identBoundaryRegex(localName);
  const reList = new RegExp(
    `export\\s*\\{[^}]*${name}\\s+as\\s+default(?![\\w$])[^}]*\\}`,
    "m",
  );
  const reDefaultFn = new RegExp(
    `export\\s+default\\s+(?:async\\s+)?function\\s+${name}`,
    "m",
  );
  const reDefaultId = new RegExp(
    `export\\s+default\\s+${name}`,
    "m",
  );
  return reList.test(source) || reDefaultFn.test(source) || reDefaultId.test(source);
}

/**
 * 侧车源码可能绑定的导出名（解析导出名，不执行）。
 * 解析失败 → undefined（调用方回落到尝试 exec，让加载诊断照常浮出）。
 */
function sidecarExportNames(sidecarSrc: string): Set<string> | undefined {
  try {
    return localNamedExports(sidecarSrc);
  } catch {
    return undefined;
  }
}

/**
 * 侧车导出面是否可能绑定 fnName（C4.2 键解析的静态近似）：
 * 直接同名 / default（源侧 default 导出）/ `Class.method` 的
 * `Class_method`、嵌套 `Class`、近失配裸 `method`。
 * 用于在 exec 前跳过与该侧车无关的源导出——侧车加载失败不得按源导出逐个上报。
 */
function sidecarMayBind(
  sidecarNames: Set<string> | undefined,
  fnName: string,
  source: string,
): boolean {
  if (!sidecarNames) return true; // 未知导出面：保守尝试
  if (sidecarNames.size === 0) return true; // 解析空表：可能是坏源，让 exec 报
  if (sidecarNames.has(fnName)) return true;
  // DESIGN-003：`export { _c as class }` 的函数身份是本地名 _c，侧车身份是
  // 导出名 class（绑定名可能是别名 _nudo_1）——本地名查询按导出名桥接
  const aliasExport = exportedNameOfLocal(source, fnName);
  if (aliasExport !== undefined && sidecarNames.has(aliasExport)) return true;
  if (sidecarNames.has("default") && isDefaultExportLocal(source, fnName)) return true;
  if (fnName.includes(".")) {
    const [cls, method] = fnName.split(".", 2);
    if (cls && method) {
      if (sidecarNames.has(`${cls}_${method}`)) return true;
      if (sidecarNames.has(cls)) return true;
      if (sidecarNames.has(method)) return true;
    }
  }
  return false;
}

/** 模块级加载/执行失败去重：同 (路径, 原因) 只报一次，后续绑定静默跳过。
 *  作用域化：交错分析不得互相清掉对方的去重表（checkSource 每次入口
 *  reset；无作用域 = fallback 全局表，行为同今日）。 */
const sidecarLoadFailureSlot = createScopedSlot<Map<string, string>>(
  () => new Map(),
);
registerCollectorScopeParticipant((body) => sidecarLoadFailureSlot.runScoped(body));

function noteSidecarLoadFailure(sidecarPath: string, reason: string): boolean {
  const sidecarLoadFailures = sidecarLoadFailureSlot.get();
  const key = `${sidecarPath}\0${reason}`;
  if (sidecarLoadFailures.has(key)) return false;
  sidecarLoadFailures.set(key, reason);
  return true;
}

/** 与 resetNudoModuleExecCache 同口径：分析会话/测试间清空失败去重表 */
export function resetSidecarLoadFailureCache(): void {
  sidecarLoadFailureSlot.get().clear();
}

function loadSidecarBinding(
  source: string,
  fnName: string,
  opts: EffectiveInterfaceOpts,
): SidecarBinding {
  const { loadModule, fromFile, autoBind, projectDir } = opts;
  if (!loadModule || !fromFile) return { ok: false };
  const sidecarPath = sidecarPathOf(fromFile);
  if (!sidecarAutoBindAllowed(sidecarPath, autoBind, projectDir)) return { ok: false };
  if (!localNamedExports(source).has(fnName)) return { ok: false };
  const spec = `./${sidecarPath.slice(sidecarPath.lastIndexOf("/") + 1)}`;
  // 读失败（EACCES/EMFILE/…）≠「无侧车」：前者必须报 nudo:interface-load，
  // 否则约束静默回落 any；后者（undefined）是 auto-bind 的常态，保持静默。
  let sidecarSrc: string | undefined;
  try {
    sidecarSrc = loadModule(spec, fromFile);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    if (noteSidecarLoadFailure(sidecarPath, reason)) {
      collectDiag({
        code: "nudo:interface-load",
        message: `sidecar '${spec}' failed to load: ${reason}`,
        file: sidecarPath,
      });
    }
    return { ok: false };
  }
  if (sidecarSrc === undefined) return { ok: false };
  // 自加载守卫：host loader 误把源文件/自身内容当作侧车返回时不当侧车 exec
  // （CJS 源含 module.exports 时会变成 "module is not defined" 假诊断）
  if (sidecarSrc === source) return { ok: false };
  // #64：侧车只绑定部分源导出时，无关导出不得各自上报同一加载失败。
  // 先按导出名静态过滤；exec 失败也按 (路径, 原因) 去重，措辞不点名函数。
  const scNames = sidecarExportNames(sidecarSrc);
  if (!sidecarMayBind(scNames, fnName, source)) return { ok: false };
  let exports: Record<string, unknown>;
  try {
    exports = execNudoModule(sidecarSrc, { loadModule, fromFile: sidecarPath });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    const code = e instanceof NudoSidecarError ? e.code : "nudo:interface-load";
    if (noteSidecarLoadFailure(sidecarPath, reason)) {
      // 模块级失败：不写 for 'X'（读起来像 X 自身有问题）。
      // 影响面 = 侧车导出名 ∩ 源本地导出名（静态近似；exec 失败时无法枚举真实绑定）。
      let affected = 1;
      if (scNames && scNames.size > 0) {
        const srcExports = localNamedExports(source);
        let n = 0;
        for (const name of srcExports) {
          if (sidecarMayBind(scNames, name, source)) n++;
        }
        if (n > 0) affected = n;
      }
      collectDiag({
        code,
        message:
          affected > 1
            ? `sidecar '${spec}' failed to load: ${reason} (affects ${affected} bindings)`
            : `sidecar '${spec}' failed to load: ${reason}`,
        file: sidecarPath,
      });
    }
    return { ok: false };
  }
  // C4.2 绑定键解析（全部按自有属性读：toString/constructor 等键裸读会踩
  // Object.prototype 原型链，把原型成员当侧车导出）：
  // 1. 平铺 `Class.method` / `Class_method`
  // 2. 嵌套对象 `export const Class = { method: fn(…) }`
  // 3. C4.4：`export { local as default }` + 侧车 `export default`
  let binding: unknown = Object.hasOwn(exports, fnName) ? exports[fnName] : undefined;
  // DESIGN-003：别名导出（`export { _c as class }`）的源码函数身份是本地名
  // _c，侧车契约身份是导出名 class——本地名查询按导出名桥接（旧侧车按本地
  // 名发射的形态仍走上方同名直查，两代侧车都可绑定）
  if (binding === undefined) {
    const aliasExport = exportedNameOfLocal(source, fnName);
    if (aliasExport !== undefined && Object.hasOwn(exports, aliasExport)) {
      binding = exports[aliasExport];
    }
  }
  if (binding === undefined && exports.default !== undefined && isDefaultExportLocal(source, fnName)) {
    binding = exports.default;
  }
  if (binding === undefined && fnName.includes(".")) {
    const [cls, method] = fnName.split(".", 2);
    binding = Object.hasOwn(exports, `${cls}_${method}`)
      ? exports[`${cls}_${method}`]
      : undefined;
    if (binding === undefined) {
      const bag = Object.hasOwn(exports, cls!) ? (exports[cls!] as Record<string, unknown> | undefined) : undefined;
      if (bag && typeof bag === "object" && !isNudoConstraint(bag)) {
        binding = Object.hasOwn(bag, method!) ? bag[method!] : undefined;
      }
    }
    // 侧车键近失配：只有裸 `method` 而目标是 `Class.method`——报而非静默不绑
    if (
      binding === undefined &&
      method !== undefined &&
      Object.hasOwn(exports, method)
    ) {
      collectDiag({
        code: "nudo:interface-load",
        message: `sidecar key '${method}' does not bind '${fnName}' — use '${cls}.${method}', '${cls}_${method}', or nested { ${cls}: { ${method}: … } }`,
        file: sidecarPath,
      });
    }
  }
  if (binding === undefined) return { ok: false };
  if (!isNudoConstraint(binding)) {
    collectDiag({
      code: "nudo:interface-load",
      message: `sidecar '${spec}' export '${fnName}' is not a Nudo constraint`,
      file: sidecarPath,
    });
    return { ok: false };
  }
  if (!binding.fn) {
    // Phase 1 侧车绑定只承诺 fn() 形态；标量/shape 单参形态后续 Phase 放开
    collectDiag({
      code: "nudo:interface-load",
      message: `sidecar '${spec}' binding '${fnName}' is not fn() form (Phase 1 consumes only fn({ … }, …) bindings)`,
      file: sidecarPath,
    });
    return { ok: false };
  }
  // generated 判定与绑定键解析同构：`Class.method` / `Class_method` / 嵌套对象；
  // DESIGN-003：别名导出的本地名查询按导出名桥接（生成段身份=导出名）
  const generatedNames = generatedExportNames(sidecarSrc);
  const aliasExport = exportedNameOfLocal(source, fnName);
  const isGenerated =
    generatedNames.has(fnName) ||
    (aliasExport !== undefined ? generatedNames.has(aliasExport) : false) ||
    (fnName.includes(".")
      ? (() => {
          const [cls, method] = fnName.split(".", 2);
          return (
            generatedNames.has(`${cls}_${method}`) ||
            generatedNames.has(cls!)
          );
        })()
      : false);
  return {
    ok: true,
    sidecarPath,
    constraint: binding as NudoConstraint & { fn: NonNullable<NudoConstraint["fn"]> },
    generated: isGenerated,
  };
}

/** 数值/长度常数界（self 模板项上的 gt/ge/lt/le，and 嵌套展开） */
type Bound = { lower: boolean; strict: boolean; n: number; term: string };

function boundsOf(c: NudoConstraint): Bound[] {
  const out: Bound[] = [];
  const visit = (p: Pred): void => {
    if (p.op === "and") {
      p.args.forEach(visit);
      return;
    }
    if (p.op !== "gt" && p.op !== "ge" && p.op !== "lt" && p.op !== "le") return;
    if (p.b.op !== "lit" || typeof p.b.value !== "number") return;
    if (p.a.op !== "var" && p.a.op !== "app") return;
    out.push({
      lower: p.op === "gt" || p.op === "ge",
      strict: p.op === "gt" || p.op === "lt",
      n: p.b.value,
      term: termToString(p.a),
    });
  };
  c.preds.forEach(visit);
  return out;
}

/** eq(self, lit v) 提取（and 嵌套展开）；lit(undefined) 合法，不得被哨兵吞掉 */
function eqLitsOf(c: NudoConstraint): Array<{ term: string; value: number | string | boolean | null | undefined }> {
  const out: Array<{ term: string; value: number | string | boolean | null | undefined }> = [];
  const visit = (p: Pred): void => {
    if (p.op === "and") {
      p.args.forEach(visit);
      return;
    }
    if (p.op !== "eq") return;
    let term: Term | undefined;
    let value: number | string | boolean | null | undefined;
    let hasLit = false;
    if (p.a.op === "var" && p.b.op === "lit") {
      term = p.a;
      value = p.b.value as number | string | boolean | null | undefined;
      hasLit = true;
    } else if (p.b.op === "var" && p.a.op === "lit") {
      term = p.b;
      value = p.a.value as number | string | boolean | null | undefined;
      hasLit = true;
    }
    if (term !== undefined && hasLit) {
      out.push({ term: termToString(term), value });
    }
  };
  c.preds.forEach(visit);
  return out;
}

/** 常数界是否排除字面量 v（同项） */
function boundExcludes(bounds: Bound[], term: string, v: number): boolean {
  for (const b of bounds) {
    if (b.term !== term) continue;
    if (b.lower && (b.strict ? v <= b.n : v < b.n)) return true;
    if (!b.lower && (b.strict ? v >= b.n : v > b.n)) return true;
  }
  return false;
}

/**
 * 最小 unsat：同参两约束的
 * - 常数界交叉矛盾（§2.1：x>0 ∧ x<0；双非严格界仅在开区间为空时矛盾）
 * - eq 字面量冲突（lit(42) ∧ lit(43)）
 * - eq 与对侧常数界互斥（lit(5) ∧ number().gt(10)）
 */
function crossBoundConflict(a: NudoConstraint, b: NudoConstraint): boolean {
  const A = boundsOf(a);
  const B = boundsOf(b);
  for (const x of A) {
    for (const y of B) {
      if (x.term !== y.term || x.lower === y.lower) continue;
      const lo = x.lower ? x : y;
      const hi = x.lower ? y : x;
      if (lo.strict || hi.strict ? lo.n >= hi.n : lo.n > hi.n) return true;
    }
  }
  const eqA = eqLitsOf(a);
  const eqB = eqLitsOf(b);
  for (const x of eqA) {
    for (const y of eqB) {
      if (x.term !== y.term) continue;
      if (x.value !== y.value) return true;
    }
  }
  for (const eq of eqA) {
    if (typeof eq.value === "number" && boundExcludes(B, eq.term, eq.value)) return true;
  }
  for (const eq of eqB) {
    if (typeof eq.value === "number" && boundExcludes(A, eq.term, eq.value)) return true;
  }
  return false;
}

/**
 * 同参合一：and() 合取；不可合取（prim 不一致 / 非 shape 标量等 and()
 * throw）= 合取不可满足——onConflict 标记后保既有（消费方跳过执法）。
 */
function conjoinOrConflict(
  prev: NudoConstraint,
  next: NudoConstraint,
  onConflict: () => void,
): NudoConstraint {
  try {
    return andC(prev, next);
  } catch {
    onConflict();
    return prev;
  }
}

/**
 * 单点读取口：手写 ∪ 侧车同名 ∪ 生成段 → 有效契约（含来源标注）。
 * 无任何契约 → undefined（implicit 由调用方处理）。
 */
export function effectiveInterface(
  source: string,
  fnName: string,
  opts: EffectiveInterfaceOpts = {},
): EffectiveInterface | undefined {
  // 手写来源 ①：源码 refine / interface 行（@nudo:import 模板由 refine.ts 解析）。
  // extract + 侧车加载都会往 refine 通道丢诊断——在两者之后统一 since 转发，
  // 否则 loadSidecarBinding 期间的 interface-load 诊断会滞留 refine 通道。
  const refineSince = refineDiagCount();
  const sourceEntries = extractRefinesFromSource(source, fnName, opts);
  const sourceReturn = extractRefineReturnFromSource(source, fnName, opts);
  const sourceThrows = extractDeclaredThrows(source, fnName);

  // 手写来源 ② ∪ 生成段：侧车同名自动绑定
  const sidecar = loadSidecarBinding(source, fnName, opts);
  for (const d of takeRefineDiagsSince(refineSince)) {
    collectDiag({ code: d.code, message: d.message, ...(d.file ? { file: d.file } : {}) });
  }
  const sidecarFn = sidecar.ok ? sidecar.constraint : undefined;
  const sidecarGenerated = sidecar.ok && sidecar.generated;
  const sidecarParams = sidecarFn ? fnConstraintToEntryReqs(sidecarFn) : [];
  const sidecarReturns = sidecarFn?.fn.returns;
  const sidecarThrowsKinds = throwConstraintToKinds(sidecarFn?.fn.throws);
  /** 源码申报 ∪ 侧车 fn.throws（`*` 优先） */
  const mergedThrows: string[] | "*" | undefined = ((): string[] | "*" | undefined => {
    if (sourceThrows === "*" || sidecarThrowsKinds === "*") return "*";
    const set = new Set<string>([...(sourceThrows ?? []), ...(sidecarThrowsKinds ?? [])]);
    return set.size > 0 ? [...set] : undefined;
  })();

  const hasHandwritten =
    sourceEntries.length > 0 ||
    sourceReturn !== undefined ||
    (sidecarFn !== undefined && !sidecarGenerated);

  if (!hasHandwritten) {
    // 生成段：侧车同名 @generated 导出（无手写契约时的展示来源）
    if (sidecarFn !== undefined && sidecarGenerated) {
      return {
        fnName,
        params: sidecarParams,
        ...(sidecarReturns !== undefined ? { returns: { constraint: sidecarReturns } } : {}),
        ...(mergedThrows !== undefined ? { throws: { kinds: mergedThrows } } : {}),
        source: "generated",
      };
    }
    return undefined; // implicit：调用方自行处理隐式
  }

  // 手写层合并：源码行先入（同名重复行合一），侧车手写绑定同参合取。
  // 不可合取（prim 矛盾 / shape×标量等 and() throw）= 合取不可满足——
  // 标记 conflict（不再静默吞侧车契约：消费方报 nudo:interface-conflict
  // 并跳过该参执法），显示保源码行。
  const params = new Map<string, NudoConstraint>();
  const conflictParams: string[] = [];
  for (const e of sourceEntries) {
    const prev = params.get(e.param);
    if (prev === undefined) {
      params.set(e.param, e.constraint);
      continue;
    }
    // 源码双 refine 行：与「源码 × 侧车」同口径——常数界交叉与 and() throw
    // 都进 conflictParams（调用方报 nudo:interface-conflict 并跳过该位执法）
    if (crossBoundConflict(prev, e.constraint) && !conflictParams.includes(e.param)) {
      conflictParams.push(e.param);
    }
    params.set(
      e.param,
      conjoinOrConflict(prev, e.constraint, () => {
        if (!conflictParams.includes(e.param)) conflictParams.push(e.param);
      }),
    );
  }
  if (sidecarFn !== undefined && !sidecarGenerated) {
    for (const { param, constraint } of sidecarParams) {
      const prev = params.get(param);
      if (prev !== undefined) {
        if (crossBoundConflict(prev, constraint) && !conflictParams.includes(param)) {
          conflictParams.push(param);
        }
        params.set(param, conjoinOrConflict(prev, constraint, () => {
          if (!conflictParams.includes(param)) conflictParams.push(param);
        }));
      } else {
        params.set(param, constraint);
      }
    }
  }

  // 返回约束：源码 refine return 与侧车 fn.returns 并存 → and()；
  // 交叉矛盾 / 不可合取 → conflict.returns（调用方跳过返回位执法）
  const r1 = sourceReturn?.constraint;
  const r2 = sidecarFn !== undefined && !sidecarGenerated ? sidecarReturns : undefined;
  let returnsC: NudoConstraint | undefined;
  let conflictReturns = false;
  if (r1 !== undefined && r2 !== undefined) {
    if (crossBoundConflict(r1, r2)) conflictReturns = true;
    returnsC = conjoinOrConflict(r1, r2, () => {
      conflictReturns = true;
    });
  } else {
    returnsC = r1 ?? r2;
  }

  return {
    fnName,
    params: [...params.entries()].map(([param, constraint]) => ({ param, constraint })),
    ...(returnsC !== undefined ? { returns: { constraint: returnsC } } : {}),
    ...(mergedThrows !== undefined ? { throws: { kinds: mergedThrows } } : {}),
    source: "handwritten",
    ...(conflictParams.length > 0 || conflictReturns
      ? {
          conflict: {
            params: conflictParams,
            ...(conflictReturns ? { returns: true } : {}),
          },
        }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// 侧车闭包指纹（memo 键 / 逐出登记，pattern 参照 load-deps-fp.ts）
// ---------------------------------------------------------------------------

/** 防病态侧车依赖图；截断时指纹带 trunc: 前缀（调用方须 fail-open） */
const MAX_SIDECAR_FP_NODES = 64;

/** 侧车自身相对 .nudo import 的 canonical 路径表（BFS 队列填充用） */
function enqueueSidecarDeps(
  src: string,
  path: string,
  seen: Set<string>,
  queue: Array<{ spec: string; from: string }>,
): void {
  let ast: ReturnType<typeof parseSource>;
  try {
    ast = parseSource(src);
  } catch {
    return; // 解析失败：exec 阶段报诊断，闭包无需补
  }
  for (const stmt of ast.program.body) {
    if (stmt.type !== "ImportDeclaration") continue;
    const spec = stmt.source.value;
    if (!(spec.startsWith(".") || spec.startsWith("/"))) continue;
    if (!(spec.endsWith(".nudo.js") || spec.endsWith(".nudo.ts"))) continue;
    const depPath = resolveDepPath(path, spec);
    if (seen.has(depPath)) continue;
    seen.add(depPath);
    queue.push({ spec, from: path });
  }
}

/**
 * 侧车及递归 .nudo 依赖闭包的内容指纹：`${hashSource(侧车)}|路径=hash,…`。
 * 无 loadModule / autoBind 关闭 / node_modules / loadModule miss → undefined
 * （无侧车影响即无需指纹）。闭包截断 → `trunc:` 前缀，键不可信，调用方
 * fail-open（参照 loadModuleDepsFingerprint 的 truncated 契约）。
 */
export function sidecarClosureFingerprint(
  fromFile: string,
  opts: EffectiveInterfaceOpts,
): string | undefined {
  const { loadModule, autoBind, projectDir } = opts;
  if (!loadModule || !fromFile) return undefined;
  const sidecarPath = sidecarPathOf(fromFile);
  if (!sidecarAutoBindAllowed(sidecarPath, autoBind, projectDir)) return undefined;
  const spec = `./${sidecarPath.slice(sidecarPath.lastIndexOf("/") + 1)}`;
  let sidecarSrc: string | undefined;
  try {
    sidecarSrc = loadModule(spec, fromFile);
  } catch {
    return undefined; // 读失败：无指纹即可（调用方 fail-open）
  }
  if (sidecarSrc === undefined) return undefined;

  const parts: string[] = [];
  const seen = new Set<string>([sidecarPath]);
  const queue: Array<{ spec: string; from: string }> = [];
  enqueueSidecarDeps(sidecarSrc, sidecarPath, seen, queue);
  let truncated = false;
  while (queue.length > 0) {
    if (seen.size > MAX_SIDECAR_FP_NODES) {
      truncated = true;
      break;
    }
    const { spec: s, from } = queue.shift()!;
    const depPath = resolveDepPath(from, s);
    let depSrc: string | undefined;
    try {
      depSrc = loadModule(s, from);
    } catch {
      depSrc = undefined; // 读失败当 miss
    }
    parts.push(`${depPath}=${depSrc === undefined ? "miss" : hashSource(depSrc)}`);
    if (depSrc !== undefined) enqueueSidecarDeps(depSrc, depPath, seen, queue);
  }
  parts.sort();
  const fp = `${hashSource(sidecarSrc)}|${parts.join(",")}`;
  return truncated ? `trunc:${fp}` : fp;
}

// ---------------------------------------------------------------------------
// formatConstraint：组合式显示（number().gt(0) / lit(42) / union(…) / fn(…)）
// ---------------------------------------------------------------------------

function litToString(v: unknown): string {
  if (typeof v === "string") return JSON.stringify(v);
  return String(v); // number / boolean / null
}

/** length(self) 上的 ge/le 常数界 → n（否则 undefined） */
function lengthBound(p: Pred, op: "ge" | "le"): number | undefined {
  if (p.op !== op) return undefined;
  if (p.a.op !== "app" || p.a.fn !== "length") return undefined;
  if (p.b.op !== "lit" || typeof p.b.value !== "number") return undefined;
  return p.b.value;
}

/** 单个 Pred → 链式调用段；不可链式表达 → `{谓词原文}` 兜底（仅展示用） */
function predToChain(p: Pred): string {
  switch (p.op) {
    case "gt":
    case "ge":
    case "lt":
    case "le": {
      if (p.b.op !== "lit" || typeof p.b.value !== "number") break;
      if (p.a.op === "app" && p.a.fn === "length") {
        if (p.op === "ge") return `.min(${p.b.value})`;
        if (p.op === "le") return `.max(${p.b.value})`;
        break;
      }
      if (p.a.op === "var") return `.${p.op}(${p.b.value})`;
      break;
    }
    case "eq": {
      // .eq(v) 为展示伪链（构建器无 eq 链；lit 单形态在上方整体识别）
      if (p.b.op === "lit" && p.a.op === "var") return `.eq(${litToString(p.b.value)})`;
      break;
    }
    case "and": {
      // .length(n) 编码：and([ge(len,n), le(len,n)])
      if (p.args.length === 2) {
        const [a, b] = [p.args[0]!, p.args[1]!];
        for (const [x, y] of [
          [a, b],
          [b, a],
        ] as const) {
          const ge = lengthBound(x, "ge");
          const le = lengthBound(y, "le");
          if (ge !== undefined && ge === le) return `.length(${ge})`;
        }
      }
      return p.args.map(predToChain).join("");
    }
    default:
      break;
  }
  return `{${predToString(p)}}`;
}

function fmtConstraint(c: NudoConstraint): string {
  // fn({ p: … }, returns, { throws: … })
  if (c.fn) {
    const args = [
      `{ ${Object.entries(c.fn.params)
        .map(([k, v]) => `${k}: ${fmtConstraint(v)}`)
        .join(", ")} }`,
    ];
    if (c.fn.returns !== undefined) args.push(fmtConstraint(c.fn.returns));
    if (c.fn.throws !== undefined) args.push(`{ throws: ${fmtConstraint(c.fn.throws)} }`);
    return `fn(${args.join(", ")})`;
  }
  // union(m1, m2, …)
  if (c.members) return `union(${c.members.map(fmtConstraint).join(", ")})`;
  // shape({ x: …, y?: … })（isOptional 字段加 ?）
  if (c.fields) {
    const fs = Object.entries(c.fields).map(([k, f]) => {
      const opt = f.optional || f.constraint.isOptional ? "?" : "";
      return `${k}${opt}: ${fmtConstraint(f.constraint)}`;
    });
    return `shape({ ${fs.join(", ")} })`;
  }
  // array(…)
  if (c.element) return `array(${fmtConstraint(c.element)})`;
  // lit(v)：prim + 单一 eq(self, v)（lit(null) 无 prim 也识别）
  if (
    c.preds.length === 1 &&
    c.preds[0]!.op === "eq" &&
    c.preds[0]!.a.op === "var" &&
    c.preds[0]!.b.op === "lit" &&
    !isIntFlag(c)
  ) {
    return `lit(${litToString(c.preds[0]!.b.value)})`;
  }
  // 标量链：prim() + .int() + 逐 pred 链段（+ .optional()）
  let out =
    c.prim !== undefined ? `${c.prim}()` : c.preds.length > 0 ? "number()" : "any()";
  if (isIntFlag(c)) out += ".int()";
  for (const p of c.preds) out += predToChain(p);
  if (c.isOptional) out += ".optional()";
  return out;
}

/** 组合式显示：重建构建器调用形态（number().gt(0) / union(…) / fn(…)） */
export function formatConstraint(c: NudoConstraint): string {
  return fmtConstraint(c);
}

/** EffectiveInterface → 契约展示串（与 CLI interface 打印同口径，不含函数名） */
export function formatEffectiveInterfaceDisplay(eff: EffectiveInterface): string {
  const params = eff.params
    .map((p) => `${p.param}: ${formatConstraint(p.constraint)}`)
    .join(", ");
  let s = `(${params})`;
  if (eff.returns) s += ` → ${formatConstraint(eff.returns.constraint)}`;
  return s;
}

/** CodeLens / hover 首行标题（design-refine-derivation §8）：`● interface / <source>` */
export function formatInterfaceTierLine(source: InterfaceSource): string {
  return `● interface / ${source}`;
}

export type InterfaceTierInfo = {
  source: InterfaceSource;
  /** handwritten/generated 时的契约展示；implicit 为 undefined */
  display?: string;
};

export type InterfaceTierOpts = EffectiveInterfaceOpts;

/**
 * interface 档单一读取口（A7）：CodeLens `● interface`、hover、inlay、
 * semantic tokens 共用本函数，保证「同源」。
 *
 * 与 computeInterfaceLenses 同口径：仅源文件 **本地 named export** 进档；
 * 私有名 / 非导出 → undefined（不进 interface 档，不假装 implicit 契约）。
 */
export function interfaceTierOf(
  source: string,
  fnName: string,
  fromFile: string,
  opts: InterfaceTierOpts = {},
): InterfaceTierInfo | undefined {
  if (!localNamedExports(source).has(fnName)) return undefined;
  const eff = effectiveInterface(source, fnName, { fromFile, ...opts });
  const src: InterfaceSource = eff?.source ?? "implicit";
  if (eff && src !== "implicit") {
    return { source: src, display: formatEffectiveInterfaceDisplay(eff) };
  }
  return { source: src };
}

/** interfaceTierOf 的来源投影；非导出 → undefined */
export function interfaceSourceOf(
  source: string,
  fnName: string,
  fromFile: string,
  opts: InterfaceTierOpts = {},
): InterfaceSource | undefined {
  return interfaceTierOf(source, fnName, fromFile, opts)?.source;
}
