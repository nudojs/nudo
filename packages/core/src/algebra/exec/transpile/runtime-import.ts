/**
 * 转译产物运行时 import 面的**单一真值源**。
 *
 * 生成的 `import { $absVal, …, $fnKindStamp } from "<runtime>";` 行、宿主侧
 * 剥离该行的正则（`RUNTIME_IMPORT_RE`）都从这里出：
 * - 生成侧：`transpileFile` / body-fn 单元 / evalExprAbs 的 import 行；
 * - 宿主侧：run.ts 的 `RUNTIME_IMPORT_RE`（公开面，经 run.ts 再导出）与
 *   body-fn.ts 的剥离点。
 *
 * 历史教训：清单曾在 transpile.ts 里**逐字节写两遍**，正则也在 run.ts /
 * body-fn.ts 各写一遍 ⇒ 发射点新增运算符时清单漂移（生成物引用未导入的
 * `$` 名：作为真实 ESM 导入时 ReferenceError，`new Function` 路径则被宿主
 * 全局解析成 undefined）。本文件是唯一维护点：新增发射的 `$` 符号必须同时
 * 进 RUNTIME_IMPORT_NAMES 且由 exec/index.ts 导出（见
 * __tests__/runtime-import-surface.test.ts 的漂移守卫）。
 *
 * 依赖面：**零运行时依赖**（纯常量 + 字符串拼接）——exec/index ↔ transpile
 * ↔ run 的模块环不能靠本文件放大。
 */

/**
 * 生成 import 行的具名表（顺序即产物字节序；勿随手重排——产物快照 / 差分
 * 基线按行比较）。
 *
 * 卫生规则：表内名字必须对应转译器的真实发射点（含可选链回落分支的
 * `$optionalGet` / `$optionalInvokeKey` 等；否则产物多出未使用导入），
 * 且每个名字都能从 `@nudojs/core/exec` 具名导入（index.ts 显式导出面）。
 */
export const RUNTIME_IMPORT_NAMES: readonly string[] = [
  // 值/运算
  "$absVal",
  "$add",
  "$sub",
  "$mul",
  "$div",
  "$mod",
  "$bitand",
  "$bitor",
  "$bitxor",
  "$bitnot",
  "$shl",
  "$shr",
  "$ushr",
  "$pow",
  "$toNumber",
  "$toNumeric",
  "$toStr",
  "$updateAdd",
  "$updateSub",
  "$in",
  "$instanceof",
  "$instanceofNonIdent",
  "$classExpr",
  "$del",
  "$delRes",
  "$objAccessor",
  "$objAccessorKey",
  "$neg",
  "$typeof",
  "$not",
  "$eq",
  "$ne",
  "$eqLoose",
  "$neLoose",
  "$lt",
  "$le",
  "$gt",
  "$ge",
  "$join",
  // 字面量 / 控制流
  "$lit",
  "$litTruth",
  "$fork",
  "$for",
  "$obj",
  "$get",
  "$set",
  "$setProto",
  "$whileSeq",
  "$arr",
  "$arrWithHoles",
  "$restBind",
  "$idx",
  "$idxSet",
  "$len",
  // 调用 / 异常
  "$call",
  "$throw",
  "$throwConstAssign",
  "$throwFreeArguments",
  "$loopReturn",
  "$catchReturn",
  "$loopBreak",
  "$loopContinue",
  // 类
  "$class",
  "$new",
  "$invoke",
  "$invokeSuper",
  "$invokeSuperObj",
  "$invokeSuperKey",
  "$getSuper",
  "$getSuperObj",
  "$setSuper",
  "$setSuperObj",
  "$setSuperStatic",
  "$staticSuperInvoke",
  "$super",
  // async / 生成器
  "$async",
  "$asyncGen",
  "$copy",
  "$await",
  // 可选链 / 集合
  "$orDefault",
  "$callNamed",
  "$optionalGet",
  "$optionalInvoke",
  "$invokeKey",
  "$optionalInvokeKey",
  "$spread",
  "$concat",
  "$forOf",
  "$forInKeys",
  "$iterCheck",
  // 异常状态机 / case
  "$catchVal",
  "$switch",
  // 类静态面 / 生成器
  "$setKey",
  "$gen",
  "$newTarget",
  "$yield",
  "$fnVal",
  // 正则 / 收窄
  "$regex",
  "$reStateCall",
  "$rethrowIfNudoReturn",
  "$nullishTest",
  "$assumeAnchor",
  "$refineRel",
  "$removeNullish",
  "$removeNull",
  "$removeUndefined",
  "$removeMemberNullish",
  "$narrowMemberEq",
  "$narrowTypeOf",
  // try 软抛出 / 记录
  "$tryMark",
  "$assignRecord",
  "$recordBinding",
  "$nodoPos",
  "$unknown",
  // 模块 / 动态导入
  "$importMeta",
  "$dynamicImport",
  // try 状态机
  "$tryTakeSince",
  "$tryCurrentMark",
  "$tryPopMark",
  "$tryDigestSoftCatch",
  "$tryReleaseSoftCatch",
  "$tryReleaseSoftOut",
  "$tryDetachSoftCatch",
  "$tryDiscardSoft",
  "$tryOrphanSoft",
  // 循环退出 / 参数 / rest / 模式
  "$pushLoopExit",
  "$objRest",
  "$arrRest",
  "$elems",
  "$arguments",
  "$isForkExit",
  "$rawThis",
  "$isBreakTo",
  "$yieldStar",
  "$tpl",
  "$fnKindStamp",
];

/** 转译单元的缺省运行时说明符（meta.runtimeImportName / import 行共用）。 */
export const DEFAULT_RUNTIME_IMPORT = "@nudojs/core/exec";

/**
 * 运行时 import 行（body-fn 编译执行 / evalExprAbs / 模块体拼接用）。
 * 产出形态：`import { $a, $b } from "<runtime>";`（单行，双引号说明符）。
 */
export function runtimeImportOf(runtime: string): string {
  return `import { ${RUNTIME_IMPORT_NAMES.join(", ")} } from ${JSON.stringify(runtime)};`;
}

/**
 * 宿主编译前**剥离**上面那行 import 的正则（默认 ESM 产物 / 旧调用方）。
 *
 * `new Function` 单元没有 ESM 导入面——运行符号是形参注入（rt.ts 的
 * compileRuntimeUnit）。host target（`runtimeImport: null`）不发射该行；
 * 默认 ESM 产物若被宿主直接编译，仍需本正则剥离。只认**双引号**说明符
 * （runtimeImportOf 的产物）；用户源码的 import 由 host target 的
 * `emitHostImportDeclaration` 直接发射绑定。
 */
export const RUNTIME_IMPORT_RE = /^import\s*\{[^}]+\}\s*from\s*"[^"]+";\s*$/m;
