/**
 * 求值引擎 transpile：JS AST → 可在 Node 上执行的抽象值程序（源码字符串）。
 * 运算符改为 $add/$sub/…；if 改为 $fork；for 改为 $for。
 * 值类型是 Abs；副作用与模块仍由 host mock/注入。
 *
 * 实现按语句/表达式/模式拆在 transpile/*.ts；本文件是 re-export facade，
 * 对外符号面保持不变（exec/index.ts 对公开符号做显式具名导出）。
 *
 * 不变量（解构临时名，Bug 181）：
 * - 模块级解构临时名计数器（`destrTmpSeq`）在**创建处**即预置避让：序号
 *   推过用户已占用的 `_d{n}` / `_n{n}` ⇒ 首次分配（模块首条语句即解构
 *   声明）也拿不到与用户同名绑定重复的临时名（重复词法声明 ⇒ SyntaxError
 *   ⇒ 整模块求值失败 ⇒ 导出退化 unknown）。
 */
import type { File, Expression, Statement, Node } from "@babel/types";
import { parseSource } from "../parse-source.ts";
import { transpileStatement } from "./transpile/stmt.ts";
import type { TranspileOptions } from "./transpile/types.ts";

export type { TranspileOptions } from "./transpile/types.ts";
export {
  foldStaticStringExpr,
  foldRequireSpecArg,
} from "./transpile/helpers.ts";
// 运行时 import 面单一真值源（import 行 / 剥离正则都在叶子模块；本 facade
// 保持 `runtimeImportOf` 的公开路径不变，另导出名单供漂移守卫比对）。
import { runtimeImportOf } from "./transpile/runtime-import.ts";
export { RUNTIME_IMPORT_NAMES } from "./transpile/runtime-import.ts";
export { runtimeImportOf };
import {
  collectVarHoistNames,
  collectExportVarNames,
  userIdentInfo,
  bumpDestrTmpSeq,
  registerConstFnScope,
  internalTmpName,
  shadowedIntrinsicsOf,
} from "./transpile/helpers.ts";
import { staticExportDeclNamesOfProgram } from "./export-names.ts";
export { transpileBodyNode } from "./transpile/stmt.ts";
export { transpileExpression } from "./transpile/expr.ts";

export function transpileSource(source: string, opts: TranspileOptions = {}): string {
  const file = parseSource(source);
  return transpileFile(file, { ...opts, source: opts.source ?? source });
}

export function transpileFile(file: File, opts: TranspileOptions = {}): string {
  const runtime = opts.runtimeImport ?? "@nudojs/core/exec";
  // Bug 15：解构临时名单调计数器（跨语句/prologue 唯一，与源行号解耦）
  const destrTmpSeq = opts.destrTmpSeq ?? { n: 0 };
  // Bug 181：计数器创建处**预置避让**——用户自己声明了 `_d{n}` / `_n{n}`
  // 时，**首次分配**（模块**首条语句**即解构声明）在避让生效前就拿到了
  // `_d0` ⇒ 与用户同名绑定重复词法声明（SyntaxError ⇒ 整模块求值失败 ⇒
  // 导出退化 unknown + 假 nudo:opaque-result）。此处把序号**推过**用户
  // 占用的最大序号，首次分配起即安全（`_d`/`_n` 共用同一序号源）。
  bumpDestrTmpSeq(destrTmpSeq, userIdentInfo(opts.source));
  // Bug 42：try 临时名单调计数器（`__nudoTm_`/`__nudoE_` 同口径）
  const tryTmpSeq = opts.tryTmpSeq ?? { n: 0 };
  // Bug 1160：this 载体名在根单元**分配一次**——真函数 prologue、类/对象
  // 方法首参、访问器 / 字段 / 静态块 thunk 首参共用（声明与 `thisParam`
  // 读方同名）。无碰撞时基名 `__this` 原样返回 ⇒ 产物逐字不变。
  const thisSlot = opts.thisSlot ?? internalTmpName("__this", opts);
  // 宿主内建名遮蔽判定（undefined / NaN / Infinity）：源 AST 任意作用域出现
  // 同名绑定 ⇒ 本单元按「已遮蔽」发射标识符读点（$absVal + 绑定语义），否则
  // 保持字面量精确折叠（旧产物逐字节不变）。调用方补给（mock/env 注入名）
  // 一并并入；无命中不写字段。
  const shadowedIntrinsics = shadowedIntrinsicsOf(file.program, opts.shadowedIntrinsics);
  // Bug 21：模块级 var 提升（模块体是单作用域——块内 var 提升到模块顶；
  // export var 保持声明面不发提升 let，但名字留在发射集——块内同名 var
  // 仍改发赋值，写到导出绑定）
  const varNames = collectVarHoistNames(file.program.body);
  const exportVarNames = collectExportVarNames(file.program.body);
  // 提升声明扣除 export var 名与顶层函数声明名（声明面保留时 let 重声明
  // 是 SyntaxError；var 与函数声明原生同一绑定）；发射集保留并集——
  // 块内同名 var 改发赋值写到导出/函数绑定
  const skipDecl = new Set<string>(exportVarNames);
  for (const s of file.program.body) {
    if (s.type === "FunctionDeclaration" && s.id) skipDecl.add(s.id.name);
  }
  const varDeclNames = [...varNames].filter((n) => !skipDecl.has(n));
  const varHoistLine =
    varDeclNames.length > 0
      ? `let ${varDeclNames.map((n) => `${n} = $lit(void 0)`).join(", ")};`
      : null;
  const varEmitNames = new Set([...varNames, ...exportVarNames]);
  // issue #165：文件级 @nudo:assume 快速门——源文本含引理指令才置
  // assumeDirectiveFile（transpileFnBodyStmts 在函数体边界收待锚定
  // declarator）；无引理的文件锚定收集整体跳过，发射产物逐字节不变。
  const assumeFile = (opts.source ?? "").includes("@nudo:assume");
  // 真实静态声明导出名（源 AST）：顶层 FunctionDeclaration 的 `export `
  // 前缀判据。历史发射 quirk（所有顶层函数一律带 export）已修——否则
  // run.ts 的文本回收会把私有顶层函数并入模块导出面（`export *` 被本地
  // 私有同名函数遮蔽 / 私有名可被跨模块 import / 产物作为真实 ESM 时多出
  // 导出）。只在 AST 上算一次（与 stripStaticExportDecls 的源 AST 名回收
  // 同一口径），不依赖转译产物文本。
  const exportedDeclNames = new Set(staticExportDeclNamesOfProgram(file.program));
  // Bug ②：ESM import 绑定对用户代码不可变（再赋值 TypeError，
  // "Assignment to constant variable"）——import 本地名进模块级 const 面：
  // 标识符赋值/自增/逻辑赋值走既有 $throwConstAssign 通道；嵌套作用域
  // computeConstScope 并集继承、参数/块级 let 遮蔽自动扣除。
  const importConstNames = new Set<string>();
  for (const s of file.program.body) {
    if (s.type !== "ImportDeclaration") continue;
    for (const spec of s.specifiers) importConstNames.add(spec.local.name);
  }
  // 族 59 · W9：模块级 const 作用域集（**只**含 import 绑定 + 调用方传入的
  // 继承集）——模块体自身的 const 声明不进 `constNames`（该表是「用户层直接
  // 赋值 ⇒ TypeError」的判据，加模块自身 const 会改变既有门禁结论）。
  // 模块体自身的 const 只登记 **fn-const 面**（成员写不得重绑 const 根）。
  const moduleConstNames = new Set<string>(opts.constNames ?? []);
  for (const name of importConstNames) moduleConstNames.add(name);
  registerConstFnScope(moduleConstNames, file.program.body, opts.constNames);
  const scopedOpts: TranspileOptions = {
    ...opts,
    destrTmpSeq,
    tryTmpSeq,
    thisSlot,
    constNames: moduleConstNames,
    ...(shadowedIntrinsics ? { shadowedIntrinsics } : {}),
    // 顶层函数 `export ` 前缀判据（空集也传——缺省语义是「不发 export」）
    exportedDeclNames,
    ...(varEmitNames.size > 0 ? { hoistedVarNames: varEmitNames } : {}),
    ...(assumeFile ? { assumeDirectiveFile: true } : {}),
  };
  const lines: string[] = [
    `// nudo evaluator transpile — values are Abs; operators are overloaded calls`,
    runtimeImportOf(runtime),
    ``,
  ];
  if (varHoistLine) lines.push(varHoistLine);
  for (const stmt of file.program.body) {
    lines.push(transpileStatement(stmt, 0, scopedOpts));
  }
  return lines.join("\n") + "\n";
}

/** 解析 + transpile */
export function transpile(source: string, opts?: TranspileOptions): string {
  return transpileSource(source, opts);
}
