/**
 * 语句 switch 主分派（stmt 按域拆分之一；方法/函数体入口在 ./fn-body.ts，
 * 块 thunk 化在 ./block.ts）。
 *
 * 不变量：
 * - switchBodySeq 是模块内私有计数器（跨语句/函数去重），只随
 *   transpileStatement 的 switch 共享体发射递增；
 * - 语句级 emit 协议（fork 臂隔离/mutator rebinds/守卫剪影）与表达式侧
 *   short-circuit.ts 同源；控制流谓词在 ../stmt-predicates.ts（leaf）；
 * - 未 lowering 的语句统一 default unsupported（不得假精确 no-op）。
 */
import type { Expression, Node, Statement } from "@babel/types";
import type { TranspileOptions } from "../types.ts";
import {
  stmtCompletesControl,
  stmtReturns,
  withImplicitReturn,
  narrowNullishArmThunks,
  narrowTypeArmThunk,
  nullishGuardsOf,
  nullishRemoveCallOf,
  typeGuardOf,
  discriminantGuardsOf,
  narrowDiscriminantArmThunks,
  relGuardOf,
  narrowRelArmThunk,
} from "../stmt-predicates.ts";
import {
  matchAsOverride,
  fnBodyHasThis,
  fnBodyHasOwnArguments,
  indent,
  collectForkBindingNames,
  collectAssignedIds,
  collectLoopBodyTopLevelDeclNames,
  collectArrMutatorReceivers,
  collectPatternNames,
  finalizerBits,
} from "../helpers.ts";
import { HOST_INTRINSIC_SET, UNDEF_LIT } from "../intrinsics.ts";
import { NudoUnsupportedError } from "../../unsupported.ts";
import {
  emitArrMutatorRebinds,
  emitDestructure,
  emitParamBinding,
  forkBindingDecls,
  forkJoinBindings,
  matchOptionalRequire,
  catchMayRethrow,
} from "../emit.ts";
import { emitTranspileExpression } from "../transpile-dispatch.ts";
import { paramNamesOf, transpileFnBodyStmts } from "./fn-body.ts";
import { transpileBlockAsThunk, extractForInitName } from "./block.ts";
import { transpileClass } from "../class-emit.ts";
/** switch 共享体函数名序号（跨语句/函数去重） */
let switchBodySeq = 0;

/** Bug 98：非纯 for-in 接收者临时名计数器（同块多 for-in 防重复声明） */
let forInRecvSeq = 0;

/** Bug 98：for-in 接收者重读是否无副作用——标识符 / 非计算成员链
 *  （o、o.sub、o.a.b）。其余形态（调用、计算键、三元/短路等）经
 *  emitTranspileExpression 可能含求值副作用，重读会重复副作用 →
 *  循环头一次性求值入 __firN 临时。 */
function isPureForInRecv(n: Expression): boolean {
  switch (n.type) {
    case "Identifier":
      return true;
    case "MemberExpression":
      return !n.computed && isPureForInRecv(n.object as Expression);
    default:
      return false;
  }
}

export function transpileStatement(stmt: Statement, depth: number, opts: TranspileOptions): string {
  const pad = indent(depth);
  switch (stmt.type) {
    case "ExportNamedDeclaration": {
      const decl = stmt.declaration;
      if (!decl) {
        // 保留合法 ESM 形态：run.ts 后处理改写为 __nudoExport（modules 表
        // 注入绑定）；真实 .mjs import 消费者直接吃标准 ESM 语义。
        if (depth !== 0) return `${pad}/* nested export specifiers skipped */`;
        // ExportNamespaceSpecifier：`export * as ns from "spec"`（Babel 8 无 local）
        const nsSpecs = stmt.specifiers.filter((s) => s.type === "ExportNamespaceSpecifier");
        if (nsSpecs.length > 0) {
          if (!stmt.source) return `${pad}/* export * as without source skipped */`;
          return nsSpecs
            .map((s) => {
              // string 导出名（export * as "a-b" from）重发射必须保引号
              const exported =
                s.exported.type === "Identifier"
                  ? s.exported.name
                  : JSON.stringify(s.exported.value);
              return `${pad}export * as ${exported} from ${JSON.stringify(stmt.source!.value)};`;
            })
            .join("\n");
        }
        const specs = stmt.specifiers
          .filter(
            (s): s is typeof s & {
              local: { type?: string; name?: string; value?: string };
              exported: { type?: string; name?: string; value?: string };
            } => "local" in s,
          )
          .map((s) => {
            // DESIGN-003：别名导出段 `export { _nudo_1 as class }` /
            // string 导出名 `export { _nudo_1 as "a-b" }` 重发射——保留字
            // 导出名合法（IdentifierName），string 名必须保引号
            const local =
              s.local.type === "Identifier" ? s.local.name : JSON.stringify(s.local.value);
            const exported =
              s.exported.type === "Identifier"
                ? s.exported.name
                : JSON.stringify(s.exported.value);
            return local === exported ? local : `${local} as ${exported}`;
          })
          .join(", ");
        if (stmt.source) {
          return `${pad}export { ${specs} } from ${JSON.stringify(stmt.source.value)};`;
        }
        return `${pad}export { ${specs} };`;
      }
      const inner = transpileStatement(decl as Statement, depth, {
        ...opts,
        // Bug 21：export var 保持声明面（host ESM export 收集依赖声明语句；
        // 名字从模块级提升集扣除），init 内嵌套函数体由边界重算不受此标志
        ...(decl.type === "VariableDeclaration" && decl.kind === "var"
          ? { keepVarDecl: true }
          : {}),
      });
      // 顶层 export const/let/class：保留 export 面（run.ts 收集进 exports，
      // 供 directive case 经 callTranspiledExport 求值；模块图依赖此表）
      if (depth === 0 && (decl.type === "VariableDeclaration" || decl.type === "ClassDeclaration") && !pad) {
        return `export ${inner}`;
      }
      return inner;
    }
    case "ExportAllDeclaration": {
      if (depth !== 0) return `${pad}/* nested export * skipped */`;
      return `${pad}export * from ${JSON.stringify(stmt.source.value)};`;
    }
    case "ImportDeclaration": {
      // 保留 import；run.ts 会改写为 __nudoBindImport
      const specs = stmt.specifiers
        .map((s) => {
          if (s.type === "ImportSpecifier") {
            const imported =
              s.imported.type === "Identifier" ? s.imported.name : String(s.imported);
            return imported === s.local.name ? imported : `${imported} as ${s.local.name}`;
          }
          if (s.type === "ImportDefaultSpecifier") return `default as ${s.local.name}`;
          if (s.type === "ImportNamespaceSpecifier") return `* as ${s.local.name}`;
          return "";
        })
        .filter(Boolean);
      if (specs.length === 0) {
        return `${pad}import ${JSON.stringify(stmt.source.value)};`;
      }
      return `${pad}import { ${specs.join(", ")} } from ${JSON.stringify(stmt.source.value)};`;
    }
    case "ExportDefaultDeclaration": {
      const d = stmt.declaration;
      if (d.type === "FunctionDeclaration" || d.type === "ClassDeclaration") {
        // 匿名默认函数/类合成名字（原 <anonymous fn skipped> 整条丢失）；
        // 输出 `function X {}` + `export default X;`——真实 ESM 与 run.ts
        // 后处理（→ __nudoExport("default", X)）都合法。
        const name =
          d.id?.name ?? (d.type === "FunctionDeclaration" ? "__nudoDefaultFn" : "__nudoDefaultClass");
        const named = d.id ? d : ({ ...d, id: { type: "Identifier", name } } as Statement);
        const inner = transpileStatement(named, depth + 1, opts);
        return `${inner}\n${pad}export default ${name};`;
      }
      return `${pad}export default ${emitTranspileExpression(d as Expression, opts)};`;
    }
    case "FunctionDeclaration": {
      if (!stmt.id) return `${pad}// <anonymous fn skipped>`;
      // 嵌套函数声明不是 export 面；函数体是新边界，inLoop 必须归零
      const exportKw = depth === 0 ? "export " : "";
      const hasThis = fnBodyHasThis(stmt as { body?: Node | null });
      // `arguments`：体/嵌套箭头引用（含参数默认值）时建独立 tuple 槽（strict 映射，见 $arguments）
      const hasArgs = fnBodyHasOwnArguments(stmt as { body?: Node | null; params?: Node[] });
      const fnOpts: TranspileOptions = {
        ...opts,
        inLoop: 0,
        // 函数体是新边界：return 是本函数的返回，不是外层 if 臂的退出信号
        conditionalFlow: 0,
        inFunction: true,
        ...(hasThis ? { thisParam: "__this" } : {}),
        argsBinding: hasArgs ? "__nudoArgs" : undefined,
        // Bug 52：函数体是新生成器边界——外层 try 不覆盖体内 yield
        yieldTryCtx: 0,
      };
      const { sig, rest, prologue, defaulted } = emitParamBinding(
        stmt.params as Node[],
        indent(depth + 2),
        fnOpts,
      );
      const named = sig;
      // Bug 69：宿主签名默认参占位 `_p{i}` 按位补显式默认 `= void 0`——
      // 宿主 fn.length 与原生对齐（首个默认值前形参数；占位收 undefined
      // 的绑定语义不变，$orDefault 缺参归一同效）
      const defaultedSet = new Set(defaulted);
      const hostSig = named.map((p, i) => (defaultedSet.has(i) ? `${p} = void 0` : p));
      // Bug 7：缺参归一——省略的尾实参以宿主 undefined 绑定宿主签名形参，
      // 裸值流进 $add 等算子读 .shape 崩溃（假 may-throw），直接 return 时
      // 经结果通道泄漏裸 undefined。函数边界统一 $absVal 收形：省略 ≡ 显式
      // 传 undefined（$orDefault 默认参 / $typeof / $get nullish 硬抛均按
      // lit(undefined) 折叠）。rest 不经宿主绑定（restBind 按 arguments
      // 切片，长度保持原生），不在归一名单；sloppy arguments 别名只覆盖
      // i < arguments.length 的槽位，归一不改变 arguments.length。
      const bindParams = named.map((p) => `${indent(depth + 2)}${p} = $absVal(${p});`);
      // Bug 16：__this 必须 let——`this.s = v` 的赋值包装发射
      // `__this = $set(__this, …)` 重绑（构造调用 this 是对象时执行到），
      // const 重绑宿主 TypeError
      const thisPrologue = hasThis
        ? `${indent(depth + 2)}let __this = $rawThis(this);\n`
        : "";
      // 真实 function 有宿主 arguments → 投成独立 tuple（不破坏下方 restBind）
      const argsPrologue = hasArgs
        ? `${indent(depth + 2)}let __nudoArgs = $arguments(arguments);\n`
        : "";
      // 顺序：缺参归一 → __nudoArgs/__this 建立 → 参数默认值/解构（默认值
      // 可读自有 arguments（`a = arguments.length`）与 this——槽必须先于
      // prologue 声明，否则 TDZ ReferenceError）
      const bodyStmts =
        stmt.body.type === "BlockStatement"
          ? withImplicitReturn(
              stmt.body,
              [...bindParams, thisPrologue, argsPrologue, ...prologue, transpileFnBodyStmts(stmt.body.body, depth + 2, fnOpts, {
                // Bug 21：函数体 var 提升边界——参数模式名已绑定，不得提升
                skip: paramNamesOf(stmt.params as Node[]),
              })]
                .filter(Boolean)
                .join("\n"),
              depth + 2,
            )
          : `${indent(depth + 2)}${bindParams.map((l) => `${l.trim()} `).join("")}${thisPrologue.trim()}${argsPrologue.trim()}return ${emitTranspileExpression(stmt.body as unknown as Expression, fnOpts)};`;
      // 函数体自包含边界：体内 $loopReturn 早退（循环 / if 臂 both-return）
      // 在函数自身边界收成返回值——裸宿主调用（e2e 真实 .mjs 导入、模块
      // 顶层互调）不经引擎调用边界（callTranspiledExportFullInner /
      // callAtFunctionBoundary 的 NudoReturn 捕获），必须体内自吸收。
      // 引擎路径不受影响：settleForkArms 对 ret 值恰一次交付（双 ret 抛出
      // / 单 ret 入 exits），此处捕获的即全部早退值。
      const bodySrc = bodyStmts.includes("$loopReturn(")
        ? [
            `${indent(depth + 1)}try {`,
            bodyStmts,
            `${indent(depth + 1)}} catch (__nudoFnRet) {`,
            `${indent(depth + 1)}  return $catchReturn(__nudoFnRet);`,
            `${indent(depth + 1)}}`,
          ].join("\n")
        : bodyStmts;
      // Bug 44：rest 绑定经 $restBind——真调用按 arguments 切片包 $arr（长度
      // 保持原生）；签名符号执行的开放数组哨兵直通（不塌缩固定 1 元组）
      const restBind = rest
        ? `${indent(depth + 1)}const ${rest} = $restBind(arguments, ${named.length});\n`
        : "";
      // function* → $gen 收集 yield。宿主函数是普通 function（transpile 已去
      // generator 化）——__nudoNonCtor 标记由 hoistNonCtorMarkers
      // 提升到作用域顶部（先用后声明也可见，Bug 9）
      if (stmt.generator) {
        return [
          `${pad}${exportKw}function ${stmt.id.name}(${hostSig.join(", ")}) {`,
          restBind,
          `${indent(depth + 1)}return $gen(() => {`,
          bodySrc,
          `${indent(depth + 1)}});`,
          `${pad}}`,
        ].join("\n");
      }
      // async 声明同口径：宿主函数是普通 function（body 包 $async）
      if (stmt.async) {
        return [
          `${pad}${exportKw}function ${stmt.id.name}(${hostSig.join(", ")}) {`,
          restBind,
          `${indent(depth + 1)}return $async(() => {`,
          bodySrc,
          `${indent(depth + 1)}});`,
          `${pad}}`,
        ].join("\n");
      }
      return [
        `${pad}${exportKw}function ${stmt.id.name}(${hostSig.join(", ")}) {`,
        restBind,
        bodySrc,
        `${pad}}`,
      ].join("\n");
    }
    case "ReturnStatement": {
      const asVar = matchAsOverride(stmt as Node, opts);
      // C2.1：循环体内 return 不是「回调返回」，而是函数提前返回
      // try 内：先 drain 抽象 throwExits，有则 rethrow 让 catch 吸收；正常返回值进 loopExits 后由出口 join
      // if 臂 thunk 内（conditionalFlow>0，非循环）：return 同理是函数退出
      // 信号——裸 JS return 只退出 thunk，值会被语句位 $fork 丢弃（fork-arm
      // × try-region 早退被 fall-through 覆盖的根因）；$loopReturn 沿
      // loopExits 侧信道由函数边界 join（runForkArm/settleForkArms 已按
      // kind:"ret" 处理：确定臂直抛 NudoReturn，抽象臂 exits.push 后兄弟
      // 臂/fall-through 继续探索）。
      const prefix =
        (opts.inLoop ?? 0) > 0 || (opts.conditionalFlow ?? 0) > 0 ? "$loopReturn" : "return";
      const markExpr = opts.tryMarkName ?? "$tryCurrentMark()";
      // return 表达式推导 hover：把返回值记到 **`return` 关键字起始位**
      // （不是 argument 起始位——后者与内部根标识符值读记录同键，
      // first-wins 会让 return 记录丢失；挂关键词位则 hover `return`
      // 精确命中，表达式内部子表达式由既有记录覆盖）。裸 `return;`
      // 不记录。$nodoPos 记录并原样返回（语义恒等；无收集器时直通）
      const retPos =
        opts.recordPositions && stmt.argument?.loc && stmt.loc
          ? `, ${stmt.loc.start.line}, ${stmt.loc.start.column}`
          : "";
      const emitRet = (src: string, mutNodes?: Node | null): string => {
        const rec = retPos === "" ? src : `$nodoPos(${src}${retPos})`;
        const retRebinds = mutNodes ? emitArrMutatorRebinds(mutNodes, opts, pad) : [];
        if ((opts.inTry ?? 0) > 0) {
          // Bug 145：临时量名固定为 `__nudoRet`——同一词法块内出现两个
          // return 时就是**重复 const 声明**（new Function 编译期 SyntaxError
          // → 整模块 fail-closed：同文件所有函数退化为 unknown / never）。
          // 修法：把每个 return 的临时量收进**自己的块**（块作用域独立 →
          // 不再同名冲突）；return 仍在块内——块不改变 return 的函数退出语义。
          return [
            `${pad}{`,
            `${indent(depth + 1)}const __nudoRet = ${rec};`,
            ...retRebinds,
            `${indent(depth + 1)}{`,
            `${indent(depth + 2)}const __xs = $tryTakeSince(${markExpr});`,
            `${indent(depth + 2)}if (__xs.length) {`,
            `${indent(depth + 3)}$pushLoopExit(__nudoRet);`,
            `${indent(depth + 3)}$throw(__xs.reduce((a, b) => $join(a, b)));`,
            `${indent(depth + 2)}}`,
            `${indent(depth + 2)}${opts.tryRethrowCatch ? "$tryReleaseSoftCatch();" : opts.hasTryHandler === false ? "$tryReleaseSoftOut();" : "$tryDigestSoftCatch();"}`,
            `${indent(depth + 1)}}`,
            `${indent(depth + 1)}${prefix}(__nudoRet);`,
            `${pad}}`,
          ].join("\n");
        }
        if (retRebinds.length === 0) return `${pad}${prefix}(${rec});`;
        return [
          `${pad}let __mutRet = ${rec};`,
          ...retRebinds,
          `${pad}${prefix}(__mutRet);`,
        ].join("\n");
      };
      if (asVar) return emitRet(asVar);
      if (!stmt.argument) return emitRet(`$lit(void 0)`);
      const retSrc = emitTranspileExpression(stmt.argument, opts);
      return emitRet(retSrc, stmt.argument as Node);
    }
    case "ThrowStatement": {
      const arg = stmt.argument ? emitTranspileExpression(stmt.argument, opts) : "$lit(void 0)";
      return `${pad}$throw(${arg});`;
    }
    case "ExpressionStatement": {
      // Bug 49/51：数组 mutator 在 $invoke 调用点就地变更（引用语义——
      // $arrMutContainer 的 writeBack 保持 Abs 身份，变量别名 / 成员槽 /
      // Map 条目同步可见），语句与表达式位置统一走普通调用发射，不再
      // 语句位重绑（旧的「先求值再重绑」P0 顺序让同表达式内第二个
      // mutator 看到变更前容器，且 CallExpression 接收者丢变更）。
      // 此处的写回只剩 defineProperty/delete。
      const expr = stmt.expression as Expression;
      const exprRebinds = emitArrMutatorRebinds(expr, opts, pad);
      if (exprRebinds.length > 0) {
        return [
          `${pad}${emitTranspileExpression(expr, opts)};`,
          ...exprRebinds,
        ].join("\n");
      }
      return `${pad}${emitTranspileExpression(stmt.expression, opts)};`;
    }
    case "VariableDeclaration": {
      // const → let：成员/下标写经不可变 Abs 更新后需重绑根绑定
      // Bug 21：var 是函数作用域——名字已提升到函数体顶部（hoistedVarNames）
      // 时改发赋值（块内 var 不再退化成块级绑定；重声明合法；跨块写共享）。
      // 未提升的名字（参数遮蔽 / export var 保持声明面 / 无提升层的合成体）
      // 保持 host `var` 声明（原生重声明/参数共存语义）。
      const isVar = stmt.kind === "var" && opts.keepVarDecl !== true;
      const hoistedVar = opts.hoistedVarNames;
      const kw = "let";
      const asVar = matchAsOverride(stmt as Node, opts);
      const lines: string[] = [];
      // Bug 15：跨语句共享计数器（挂 opts）——同行/无 loc 的多条解构不再
      // 因行号后缀撞车（重复 const → 整模块 SyntaxError）
      const tmpSeq = opts.destrTmpSeq ?? { n: 0 };
      for (const d of stmt.declarations) {
        if (d.id.type === "Identifier") {
          // 声明位位置记录（hover 重放 recordPositions 时）：把 init 绑定值
          // 记到 declarator id 起点——非调用初始化（三元 / 可选链 / 字面量）
          // 的局部量声明位 hover 由 A0 直读，不再依赖调用记录配对
          const recInit = (initSrc: string): string =>
            opts.recordPositions && d.id.loc
              ? `$nodoPos(${initSrc}, ${d.id.loc.start.line}, ${d.id.loc.start.column})`
              : initSrc;
          // issue #165：@nudo:assume 引理锚定——函数体直接子语句的
          // declarator 命中 anchorDeclNodes（节点身份判定：嵌套块 /
          // 嵌套函数体 / for-init 的声明不在集合内，天然不包）时，init
          // 最内层包 $assumeAnchor，把非 lit term α-改名 var(<name>)
          //（SSA：引理作用于绑定值，从定义点到作用域尾）。包在 $nodoPos
          // 位置记录与 @nudo:as 覆盖之**内层**——锚定最贴近求值、位置记录
          // 在外；as 覆盖命中时整体替换 init，不再锚定。解构分支不包
          //（保守）。运行时护栏（premise 不含该名 le 原子则直通原值）
          // 见 runtime/ops.ts。
          const anchored = opts.anchorDeclNodes?.has(d) === true;
          // 窄化捕获：闭包内 d.id 无法保持 Identifier 收窄，名字先落局部
          const declName = d.id.name;
          const anchorInit = (initSrc: string): string =>
            anchored
              ? `$assumeAnchor(${initSrc}, ${JSON.stringify(declName)})`
              : initSrc;
          if (isVar && hoistedVar?.has(d.id.name)) {
            // 提升绑定上的赋值：裸 `var x;` 无写跳过（绑定已由顶部 let 提供）
            if (!d.init) {
              if (depth === 0) {
                lines.push(`${pad}$recordBinding(${JSON.stringify(d.id.name)}, ${d.id.name});`);
              }
              continue;
            }
            const init = recInit(
              asVar
                ? asVar
                : anchorInit(emitTranspileExpression(d.init, opts)),
            );
            lines.push(`${pad}${d.id.name} = ${init};`);
            if (depth === 0) {
              lines.push(`${pad}$recordBinding(${JSON.stringify(d.id.name)}, ${d.id.name});`);
            }
            if (!asVar) {
              lines.push(...emitArrMutatorRebinds(d.init as Node, opts, pad));
            }
            continue;
          }
          // @nudo:as：覆盖整个声明语句的 init
          const init = recInit(
            asVar
              ? asVar
              : anchorInit(
                  d.init
                    ? emitTranspileExpression(d.init, opts)
                    : "$lit(void 0)",
                ),
          );
          const declKw = isVar ? "var" : kw;
          lines.push(`${pad}${declKw} ${d.id.name} = ${init};`);
          // 顶层绑定表（checkSource varAbs / scanLiteralCalls 实参解析）
          if (depth === 0) {
            lines.push(`${pad}$recordBinding(${JSON.stringify(d.id.name)}, ${d.id.name});`);
          }
          // P1：表达式位置 mutator（`const x = a.pop()`）同样重绑容器
          if (d.init && !asVar) {
            lines.push(...emitArrMutatorRebinds(d.init as Node, opts, pad));
          }
          continue;
        }
        // 解构：先绑定 init 到临时，再逐项 $get / $idx
        if (!d.init) {
          lines.push(`${pad}// destructure without init`);
          continue;
        }
        const initSrc = emitTranspileExpression(d.init, opts);
        const tmp = `_d${tmpSeq.n++}`;
        lines.push(`${pad}const ${tmp} = ${initSrc};`);
        lines.push(...emitArrMutatorRebinds(d.init as Node, opts, pad));
        // var 解构：名字已提升 → kw ""（赋值模式）；未提升（参数遮蔽 /
        // export var）→ host `var` 声明
        let destrKw = kw;
        if (isVar) {
          const patNames = new Set<string>();
          collectPatternNames(d.id, patNames);
          destrKw = [...patNames].some((n) => hoistedVar?.has(n)) ? "" : "var";
        }
        emitDestructure(d.id as Node, tmp, destrKw, pad, opts, lines, tmpSeq);
      }
      return lines.join("\n");
    }
    case "IfStatement": {
      const test = emitTranspileExpression(stmt.test, opts);
      // 抽象分支：普通绑定 + 数组 mutator + 对象写根 都要 snapshot/join
      const recvSet = new Set<string>([
        ...collectForkBindingNames(stmt.consequent),
        ...collectForkBindingNames(stmt.alternate),
      ]);
      const testRebinds = emitArrMutatorRebinds(stmt.test as Node, opts, pad);
      const names = [...recvSet];
      const padIn = indent(depth + 1);
      // 块级作用域：同一函数内多个 if 都改 errors 时，__fk0_* 不得重复声明
      const padDecl = names.length > 0 ? padIn : pad;
      const wrapArm = (thunk: string, outPrefix: string): string => {
        if (names.length === 0) return thunk;
        return [
          `() => {`,
          ...names.map((n) => `${padIn}${n} = $copy(__fk0_${n});`),
          `${padIn}let __cont = true;`,
          `${padIn}try {`,
          `${padIn}  return (${thunk})();`,
          `${padIn}} catch (e) {`,
          `${padIn}  if ($isForkExit(e)) __cont = false;`,
          `${padIn}  throw e;`,
          `${padIn}} finally {`,
          `${padIn}  if (__cont) {`,
          ...names.map((n) => `${padIn}    __${outPrefix}${n} = ${n};`),
          ...names.map((n) => `${padIn}    __${outPrefix}set_${n} = true;`),
          `${padIn}  }`,
          `${padIn}}`,
          `}`,
        ].join("\n");
      };
      const consRaw = transpileBlockAsThunk(stmt.consequent, depth, {
        ...opts,
        conditionalFlow: (opts.conditionalFlow ?? 0) + 1,
      });
      const altRaw = stmt.alternate
        ? transpileBlockAsThunk(stmt.alternate, depth, {
            ...opts,
            conditionalFlow: (opts.conditionalFlow ?? 0) + 1,
          })
        : null;
      // nullish 守卫臂收窄（issue #97）：`if (p === null) …` 的 else 臂 /
      // `if (p !== null) …` 的 then 臂内，p 以 $removeNullish 影子重绑——
      // 后续 p.major 不再记 may-throw。守卫名在 fork 绑定集（臂内写）时跳过。
      // typeof 类型守卫（Bug 23）：事实臂绑匹配成员、对侧臂绑补集。
      // issue #118 v3 / #120：多名复合测试（`obj == null || node.p == null`
      // 穿透臂双事实）与赋值即守卫（`if ((m = re.exec(s)))`）经
      // nullishGuardsOf 一臂多事实齐用。
      const guards = nullishGuardsOf(stmt.test);
      const tguard = typeGuardOf(stmt.test);
      const dguards = discriminantGuardsOf(stmt.test);
      // 关系守卫（Bug 1）：`if (x >= 0)` 真臂 x 影子重绑带界 Abs——
      // 裸 `return x` 不再丢守卫事实（return-constraint gate 假阳根因）
      const rguard = relGuardOf(stmt.test);
      const consNarrowed = narrowRelArmThunk(
        narrowDiscriminantArmThunks(
          narrowTypeArmThunk(
            narrowNullishArmThunks(consRaw, guards, "cons", recvSet),
            tguard,
            "cons",
            recvSet,
          ),
          dguards,
          "cons",
          recvSet,
        ),
        rguard,
        "cons",
        recvSet,
      );
      const altNarrowed =
        altRaw === null
          ? null
          : narrowDiscriminantArmThunks(
              narrowTypeArmThunk(
                narrowNullishArmThunks(altRaw, guards, "alt", recvSet),
                tguard,
                "alt",
                recvSet,
              ),
              dguards,
              "alt",
              recvSet,
            );
      const cons = wrapArm(consNarrowed, "fk1_");
      // 缺 else：names 空时**省略** $fork 第三参（不得发裸 undefined 哨兵——
      // 那是标识符，被遮蔽后会把 Abs 当 alternate 函数传进去）；有 fork 绑定时
      // 需要真 alternate 参与 join，折 UNDEF_LIT。
      const alt = names.length
        ? wrapArm(altNarrowed === null ? `() => ${UNDEF_LIT}` : altNarrowed, "fk2_")
        : altNarrowed;
      const altArg = alt === null ? "" : `, ${alt}`;
      // Bug 135：fork 快照（__fk0_*）是**臂的基线**——基线必须取自**测试
      // 求值之后**。此前快照行排在 $fork(...) 之前，而测试表达式是 $fork 的
      // 第一实参（后求值）——于是测试里的副作用（f() 计数 / getter / 赋值 /
      // 自增）在臂入口被 `n = $copy(__fk0_n)` 整体回滚（原生保留）。
      // 修法：测试先落临时量 __fkT，再取快照，$fork 用 __fkT。
      const joinLines = names.length
        ? [
            `${padDecl}const __fkT = (${test});`,
            ...testRebinds,
            ...forkBindingDecls(names, padDecl),
          ]
        : testRebinds;
      const applyJoin = names.length ? forkJoinBindings(names, padDecl).join("\n") : "";
      // 有 fork 绑定（快照基线）时测试已落 __fkT；否则测试仍是 $fork 的实参
      const testRef = names.length > 0 ? "__fkT" : test;
      // 两分支都以 return/throw 退出时，$fork 即函数返回值
      // （循环/switch 臂内：用 $loopReturn 抛 NudoReturn，与早退语义一致）
      // else-if 链经 completeElseChains 补全最终 else 后同样命中本路径。
      const inCtrl = (opts.inLoop ?? 0) > 0;
      const openBlock = names.length > 0 ? `${pad}{` : null;
      const closeBlock = names.length > 0 ? `${pad}}` : null;
      if (
        stmtReturns(stmt.consequent) &&
        stmt.alternate !== undefined &&
        stmt.alternate !== null &&
        stmtReturns(stmt.alternate)
      ) {
        if (names.length === 0) {
          return [
            ...joinLines,
            inCtrl
              ? `${pad}$loopReturn($fork(${testRef}, ${cons}${altArg}));`
              : `${pad}return $fork(${testRef}, ${cons}${altArg});`,
          ].join("\n");
        }
        return [
          openBlock,
          ...joinLines,
          `${padDecl}const __fkR = $fork(${testRef}, ${cons}${altArg});`,
          applyJoin,
          inCtrl ? `${padDecl}$loopReturn(__fkR);` : `${padDecl}return __fkR;`,
          closeBlock,
        ].join("\n");
      }
      return [
        openBlock,
        ...joinLines,
        `${padDecl}$fork(${testRef}, ${cons}${altArg});`,
        applyJoin,
        closeBlock,
      ]
        .filter((l) => l !== null && l !== "")
        .join("\n");
    }
    case "ForStatement": {
      const initName = extractForInitName(stmt.init);
      if (!initName) {
        // 回退：非 `let i = …` 形态（空 init / 赋值表达式 / 逗号序列）。
        // 此前整条循环被丢弃（unsupported for-init）——循环体零次执行。
        // 修复：init 就地求值（副作用写真实绑定），$for 以合成计数器作状态
        // 线程，test/update/body 闭包读真实绑定；计数器恒前进，不触发
        // 不动点早停（外部绑定经 pack/unpack 收口）。
        const initSrc =
          stmt.init == null
            ? null
            : stmt.init.type === "VariableDeclaration"
              ? transpileStatement(stmt.init as Statement, depth, opts)
              : `${pad}${emitTranspileExpression(stmt.init as Expression, opts)};`;
        const testSrc = stmt.test ? emitTranspileExpression(stmt.test, opts) : "$lit(true)";
        // 步进表达式只取副作用（写真实绑定）；状态线程是合成计数器。
        // i++/i-- 的后置值语义会丢自增写回（步进闭包内无语句级 rebind pass），
        // 与主路径同口径：标识符 Update 强制 `name = $updateAdd/$updateSub(name)`。
        const stepPart = (u: Node): string => {
          const upd = u as { type?: string; operator?: string; argument?: { type?: string; name?: string }; expressions?: unknown[] };
          if (upd.type === "UpdateExpression" && upd.argument?.type === "Identifier" && upd.argument.name) {
            return `${upd.argument.name} = ${upd.operator === "++" ? "$updateAdd" : "$updateSub"}(${upd.argument.name})`;
          }
          if (upd.type === "SequenceExpression") {
            return (upd.expressions ?? []).map((e) => stepPart(e as Node)).join(", ");
          }
          return emitTranspileExpression(u as Expression, opts);
        };
        const updateSrc = stmt.update ? stepPart(stmt.update as Node) : null;
        const forBodyOpts: TranspileOptions = {
          ...opts,
          inLoop: (opts.inLoop ?? 0) + 1,
          loopLabel: undefined, // 标签属于本循环；体 opts 不得传给嵌套循环
        };
        const bodyStmts =
          stmt.body.type === "BlockStatement"
            ? stmt.body.body.map((s) => transpileStatement(s, depth + 2, forBodyOpts)).join("\n")
            : transpileStatement(stmt.body, depth + 2, forBodyOpts);
        const max = opts.maxLoopIters ?? 8;
        const assigned = new Set<string>();
        collectAssignedIds(stmt.body, assigned);
        collectAssignedIds(stmt.test, assigned);
        collectAssignedIds(stmt.update, assigned);
        collectArrMutatorReceivers(stmt.body, assigned);
        const bodyLocalDecls = new Set<string>();
        collectLoopBodyTopLevelDeclNames(stmt.body, bodyLocalDecls);
        const names = [...assigned].filter((n) => !HOST_INTRINSIC_SET.has(n) && !bodyLocalDecls.has(n));
        const packSrc =
          names.length === 0
            ? null
            : `$obj({ ${names.map((n) => `${JSON.stringify(n)}: $copy(${n})`).join(", ")} })`;
        const unpackSrc =
          names.length === 0
            ? null
            : `(__lp) => { ${names.map((n) => `${n} = $get(__lp, ${JSON.stringify(n)});`).join(" ")} }`;
        const optsSrc = (() => {
          const extra = opts.loopLabel ? `label: ${JSON.stringify(opts.loopLabel)}` : "";
          if (!extra) return packSrc && unpackSrc
            ? `, { pack: () => ${packSrc}, unpack: ${unpackSrc} }`
            : "";
          return packSrc && unpackSrc
            ? `, { pack: () => ${packSrc}, unpack: ${unpackSrc}, ${extra} }`
            : `, { ${extra} }`;
        })();
        const stepSrc = updateSrc
          ? `(__n) => { ${updateSrc}; return $add(__n, $lit(1)); }`
          : `(__n) => $add(__n, $lit(1))`;
        return [
          initSrc,
          `${pad}// for (fallback: non-declaration init) → $for (bounded unroll, max=${max})`,
          `${pad}$for(`,
          `${indent(depth + 1)}$lit(0),`,
          `${indent(depth + 1)}(__n) => ${testSrc},`,
          `${indent(depth + 1)}${stepSrc},`,
          `${indent(depth + 1)}(__n) => {`,
          bodyStmts,
          `${indent(depth + 1)}  return __n;`,
          `${indent(depth + 1)}},`,
          `${indent(depth + 1)}${max}${optsSrc}`,
          `${pad});`,
        ]
          .filter((l) => l !== null && l !== "")
          .join("\n");
      }
      const initExpr =
        stmt.init && stmt.init.type === "VariableDeclaration" && stmt.init.declarations[0]?.init
          ? emitTranspileExpression(stmt.init.declarations[0].init, opts)
          : "$lit(void 0)";
      const testSrc = stmt.test ? emitTranspileExpression(stmt.test, opts) : "$lit(true)";
      // for 步进：**只取副作用**，状态线程恒为循环变量自身（与 fallback 路径
      // 同口径——fallback 用合成计数器 `__n`，主路径用 `initName`）。
      // - Bug 132：标识符 Update 必须走 $updateAdd/$updateSub（ToNumeric ± 1）。
      //   $add 是二元 `+`：bigint + number 走 mixed-bigint 抛 TypeError 臂、
      //   string 左操作数走字符串拼接臂（"5"++ 原生 6，拼接得 "51"）。
      // - Bug 144：步进表达式的**值**不得作状态线程——序列表达式（`i++, n++`）
      //   的值是末项值（后缀自增回旧值），会让循环变量停滞 / 超跑。
      const updateSrc =
        stmt.update && stmt.update.type === "UpdateExpression" &&
        stmt.update.argument.type === "Identifier"
          ? `${stmt.update.argument.name} = ${stmt.update.operator === "++" ? "$updateAdd" : "$updateSub"}(${stmt.update.argument.name})`
          : stmt.update
            ? emitTranspileExpression(stmt.update, opts)
            : null;
      const forBodyOpts: TranspileOptions = {
        ...opts,
        inLoop: (opts.inLoop ?? 0) + 1,
        loopLabel: undefined, // 标签属于本循环；体 opts 不得传给嵌套循环
        // 循环变量是状态线程参数（`(initName) => {…}`），遮蔽外层
        // const/import 同名绑定（Bug ②）——体内赋值合法，扣除误折面
        ...(opts.constNames && opts.constNames.has(initName)
          ? {
              constNames: new Set([...opts.constNames].filter((n) => n !== initName)),
            }
          : {}),
      };
      const bodyStmts =
        stmt.body.type === "BlockStatement"
          ? stmt.body.body.map((s) => transpileStatement(s, depth + 2, forBodyOpts)).join("\n")
          : transpileStatement(stmt.body, depth + 2, forBodyOpts);
      const max = opts.maxLoopIters ?? 8;
      const assigned = new Set<string>();
      collectAssignedIds(stmt.body, assigned);
      collectAssignedIds(stmt.test, assigned);
      collectAssignedIds(stmt.update, assigned);
      collectArrMutatorReceivers(stmt.body, assigned);
      const bodyLocalDecls = new Set<string>();
      collectLoopBodyTopLevelDeclNames(stmt.body, bodyLocalDecls);
      const names = [...assigned].filter((n) => n !== initName && !HOST_INTRINSIC_SET.has(n) && !bodyLocalDecls.has(n));
      const packSrc =
        names.length === 0
          ? null
          : `$obj({ ${names.map((n) => `${JSON.stringify(n)}: $copy(${n})`).join(", ")} })`;
      const unpackSrc =
        names.length === 0
          ? null
          : `(__lp) => { ${names.map((n) => `${n} = $get(__lp, ${JSON.stringify(n)});`).join(" ")} }`;
      const optsSrc = (() => {
        const extra = opts.loopLabel ? `label: ${JSON.stringify(opts.loopLabel)}` : "";
        if (!extra) return packSrc && unpackSrc
          ? `, { pack: () => ${packSrc}, unpack: ${unpackSrc} }`
          : "";
        return packSrc && unpackSrc
          ? `, { pack: () => ${packSrc}, unpack: ${unpackSrc}, ${extra} }`
          : `, { ${extra} }`;
      })();
      return [
        `${pad}// for → $for (bounded unroll, max=${max})`,
        `${pad}$for(`,
        `${indent(depth + 1)}${initExpr},`,
        `${indent(depth + 1)}(${initName}) => ${testSrc},`,
        `${indent(depth + 1)}(${initName}) => { ${updateSrc ? `${updateSrc};` : ""} return ${initName}; },`,
        `${indent(depth + 1)}(${initName}) => {`,
        bodyStmts,
        `${indent(depth + 1)}  return ${initName};`,
        `${indent(depth + 1)}},`,
        `${indent(depth + 1)}${max}${optsSrc}`,
        `${pad});`,
      ].join("\n");
    }
    case "BlockStatement": {
      // 真块级作用域：同名 let/const 遮蔽外层，不得摊平成重复 let 声明
      const body = transpileFnBodyStmts(stmt.body, depth + 1, opts);
      return `${pad}{\n${body}\n${pad}}`;
    }
    case "SwitchStatement": {
      const disc = emitTranspileExpression(stmt.discriminant as Expression, opts);
      type Arm = { tests: string[]; stmts: Statement[]; isDefault: boolean };

      // 1) 空 case 测试并入下一有体臂；default 独立
      const pre: Arm[] = [];
      let pendingTests: string[] = [];
      for (const c of stmt.cases) {
        const testSrc = c.test ? emitTranspileExpression(c.test as Expression, opts) : null;
        if (testSrc === null) {
          if (pendingTests.length > 0 && c.consequent.length > 0) {
            pre.push({ tests: pendingTests, stmts: c.consequent, isDefault: false });
            pendingTests = [];
          }
          pre.push({ tests: [], stmts: c.consequent, isDefault: true });
          continue;
        }
        if (c.consequent.length === 0) {
          pendingTests.push(testSrc);
          continue;
        }
        pre.push({ tests: [...pendingTests, testSrc], stmts: c.consequent, isDefault: false });
        pendingTests = [];
      }
      if (pendingTests.length > 0) {
        pre.push({ tests: pendingTests, stmts: [], isDefault: false });
      }

      // 2) 非 break 贯穿：把后续臂体串进当前臂（JS 语义）
      const merged: Arm[] = pre.map((arm) => ({ ...arm, tests: [...arm.tests], stmts: [...arm.stmts] }));
      for (let i = 0; i < merged.length; i++) {
        const arm = merged[i]!;
        const body = [...arm.stmts];
        let j = i + 1;
        while (j < merged.length && !stmtCompletesControl(body[body.length - 1] as Statement)) {
          body.push(...merged[j]!.stmts);
          if (stmtCompletesControl(body[body.length - 1] as Statement)) break;
          j++;
        }
        arm.stmts = body;
      }

      const armReturns = (arm: Arm): boolean =>
        arm.stmts.length > 0 && arm.stmts.every(stmtReturns);
      const nonDefaultArms = merged.filter((a) => !a.isDefault);
      const defaultArm = merged.find((a) => a.isDefault);
      // 无 default 不得当终止；allReturn 仍按源 default 判定
      const allReturn =
        defaultArm !== undefined &&
        nonDefaultArms.length > 0 &&
        nonDefaultArms.every(armReturns) &&
        armReturns(defaultArm);

      const caseLines: string[] = [];
      const sharedBodyDecls: string[] = [];
      let defaultSrc: string | null = null;
      const bodyIdxBase = switchBodySeq;
      let bodyIdx = 0;
      const armOpts: TranspileOptions = {
        ...opts,
        inLoop: (opts.inLoop ?? 0) + 1,
        inSwitchArm: true,
      };
      const recvSet = new Set<string>([
        ...merged.flatMap((a) => collectForkBindingNames(...a.stmts)),
        ...collectForkBindingNames(stmt.discriminant as Node),
      ]);
      const names = [...recvSet];
      // 源有 default 则每臂一槽；无 default 时多一个「no-match=快照」槽
      const nArms = merged.filter((a) => !a.isDefault).length + (defaultArm ? 1 : 0) + (defaultArm ? 0 : 1);
      const wrapArmThunk = (thunk: string, outIdx: number): string => {
        if (names.length === 0) return thunk;
        // 与 if-fork 同口径：return/throw 臂不写 continue 路径绑定
        return [
          `() => {`,
          ...names.map((n) => `${indent(depth + 1)}${n} = $copy(__sw0_${n});`),
          `${indent(depth + 1)}let __cont = true;`,
          `${indent(depth + 1)}try {`,
          `${indent(depth + 2)}return (${thunk})();`,
          `${indent(depth + 1)}} catch (e) {`,
          `${indent(depth + 2)}if ($isForkExit(e)) __cont = false;`,
          `${indent(depth + 2)}throw e;`,
          `${indent(depth + 1)}} finally {`,
          `${indent(depth + 2)}if (__cont) {`,
          ...names.map((n) => `${indent(depth + 3)}__sw${outIdx + 1}_${n} = ${n};`),
          ...names.map((n) => `${indent(depth + 3)}__sw${outIdx + 1}set_${n} = true;`),
          `${indent(depth + 2)}}`,
          `${indent(depth + 1)}}`,
          `}`,
        ].join("\n");
      };
      let armSeq = 0;
      for (const arm of merged) {
        const body =
          arm.stmts.length === 0
            ? ""
            : arm.stmts.map((s) => transpileStatement(s, depth + 2, armOpts)).join("\n");
        const rawThunk = `() => {\n${body}\n${indent(depth + 1)}}`;
        const thunk = wrapArmThunk(rawThunk, armSeq);
        armSeq++;
        const shared = arm.tests.length > 1 && !arm.isDefault;
        const runRef = shared ? `__swBody${bodyIdxBase + bodyIdx++}` : thunk;
        if (shared) {
          sharedBodyDecls.push(`${pad}const ${runRef} = ${thunk};`);
        }
        if (arm.isDefault) {
          defaultSrc = thunk;
        } else {
          for (const t of arm.tests) {
            caseLines.push(`{ test: ${t}, run: ${runRef} },`);
          }
        }
      }
      // 无 default：合成 no-match 臂，把快照写入 join 槽（抽象 disc 时参与 join）
      if (!defaultArm && names.length > 0) {
        defaultSrc = wrapArmThunk(`() => {\n${indent(depth + 2)}return $lit(void 0);\n${indent(depth + 1)}}`, armSeq);
      }
      switchBodySeq += Math.max(bodyIdx, 1);
      const dflt = defaultSrc ? `, ${defaultSrc}` : "";
      const discRebinds = emitArrMutatorRebinds(stmt.discriminant as Node, opts, pad);
      const switchCall = (discRef: string): string =>
        `$switch(${discRef}, [\n${caseLines.map((l) => indent(depth + 1) + l).join("\n")}\n${indent(depth + 1)}]${dflt})`;
      if (names.length === 0) {
        return [
          ...discRebinds,
          ...sharedBodyDecls,
          allReturn
            ? `${pad}return ${switchCall(disc)};`
            : `${pad}${switchCall(disc)};`,
        ].join("\n");
      }
      const decls = names.flatMap((n) => [
        `${pad}const __sw0_${n} = $copy(${n});`,
        ...Array.from({ length: Math.max(nArms, armSeq + (defaultArm ? 0 : 1)) }, (_, i) =>
          `${pad}let __sw${i + 1}_${n}; let __sw${i + 1}set_${n} = false;`,
        ),
      ]);
      const slotCount = Math.max(nArms, armSeq + (defaultArm ? 0 : 1));
      const joins = names.map((n) => {
        const slots = Array.from(
          { length: slotCount },
          (_, i) => `(__sw${i + 1}set_${n} ? __sw${i + 1}_${n} : null)`,
        );
        return `${pad}${n} = (() => { const __p = [${slots.join(",")}].filter((x) => x !== null); return __p.length === 0 ? ${n} : __p.reduce((a, b) => $join(a, b)); })();`;
      });
      // shared body 必须在声明 __sw0_* 的同一块内，否则闭包解析不到槽位绑定
      //
      // Bug 135：__sw0_* 是**臂的基线**——基线必须取自**判别式求值之后**。
      // 此前判别式是 $switch(...) 的第一实参（后求值），而快照行排在它之前
      // ——判别式里的副作用（f() 计数 / 赋值 / 自增）在臂入口被整体回滚。
      // 修法：判别式先落 __swD（连同其自身写回），再取快照，$switch 用 __swD。
      return [
        `${pad}{`,
        `${pad}const __swD = (${disc});`,
        ...discRebinds,
        ...decls.map((l) => l.replace(new RegExp(`^${pad}`), `${pad}`)),
        ...sharedBodyDecls.map((l) =>
          l.startsWith(pad) ? `${pad}${l.slice(pad.length)}` : `${pad}${l}`,
        ),
        `${pad}const __swR = ${switchCall("__swD")};`,
        ...joins,
        allReturn ? `${pad}return __swR;` : null,
        `${pad}}`,
      ]
        .filter((l): l is string => l !== null)
        .join("\n");
    }
    case "TryStatement": {
      // 可选 require：两侧都可折叠 → 优先成功侧（__nudoRequireOptional）
      const optReq = matchOptionalRequire(stmt as unknown as Parameters<typeof matchOptionalRequire>[0]);
      if (optReq) {
        const reqSrc = `__nudoRequireOptional(${JSON.stringify(optReq.specs)})`;
        const cond = (opts.inLoop ?? 0) > 0 || (opts.conditionalFlow ?? 0) > 0;
        const assignSrc = `((__v) => { $assignRecord(${JSON.stringify(optReq.name)}, ${optReq.name}, __v, ${optReq.locLine}, ${optReq.locCol}, ${cond});${!opts.inFunction ? ` $recordBinding(${JSON.stringify(optReq.name)}, __v);` : ""} return ${optReq.name} = __v; })(${reqSrc})`;
        const lines = [`${pad}${assignSrc};`];
        if (stmt.finalizer) {
          const finBody =
            stmt.finalizer.type === "BlockStatement"
              ? stmt.finalizer.body.map((s) => transpileStatement(s, depth, opts)).join("\n")
              : transpileStatement(stmt.finalizer as unknown as Statement, depth, opts);
          lines.push(finBody);
        }
        return lines.join("\n");
      }
      // Bug 42：try 临时名走单调查询计数器——同作用域同一行两个 try
      // （压缩/生成代码）按行号命名会重复 const 声明 → new Function
      // SyntaxError 整模块 fail-closed；loc 缺失 `?? 0` 同样撞车
      const tryTmpSeq = opts.tryTmpSeq ?? { n: 0 };
      const tmpNo = tryTmpSeq.n++;
      const markName = `__nudoTm_${tmpNo}`;
      // Bug 52：yield 点 try 上下文位——try 块与 catch 体在本 try 的
      // finally/catch 覆盖内；finally 体不在自身 finally 覆盖内（外层 ctx
      // 原样）。位值与 runtime/control.ts 的 YIELD_* 常量钉死同步（transpile
      // 不 import runtime）：1 = TRY_FINALLY，2 = TRY_CATCH，4 = FINALLY_
      // YIELDS，8 = FINALLY_RETURNS，16 = CATCH_RETURNS，32 = CATCH_YIELDS，
      // 64 = CATCH_RETHROWS
      const fin = stmt.finalizer
        ? finalizerBits(stmt.finalizer as Node)
        : undefined;
      const finBits = stmt.finalizer
        ? 1 | (fin!.yields ? 4 : 0) | (fin!.returns ? 8 : 0)
        : 0;
      // R1a：catch 静态事实（finalizerBits 同口径：含 yield / 含 return /
      // 可能 rethrow）——描述**最近** enclosing catch 的吸收结局，故本 try
      // 带 handler 时替换外层 catch 事实位（外层 catch 只有在内层重抛后才
      // 可达，此时结局不可分类 → 64 降级）。内层可能 rethrow 且外层还有
      // catch → 二次吸收路径外层事实未标注，同样置 64。
      const catchFacts = stmt.handler
        ? (() => {
            const cb = finalizerBits(stmt.handler!.body as Node);
            const rethrows = catchMayRethrow(stmt.handler!) && ((opts.yieldTryCtx ?? 0) & 2) !== 0;
            return 2 | (cb.returns ? 16 : 0) | (cb.yields ? 32 : 0) | (rethrows ? 64 : 0);
          })()
        : 0;
      const innerYieldCtx =
        ((opts.yieldTryCtx ?? 0) & ~(16 | 32 | 64)) | finBits | catchFacts;
      const tryOpts: TranspileOptions = {
        ...opts,
        inTry: (opts.inTry ?? 0) + 1,
        tryMarkName: markName,
        hasTryHandler: !!stmt.handler,
        tryRethrowCatch: stmt.handler ? catchMayRethrow(stmt.handler) : false,
        yieldTryCtx: innerYieldCtx,
      };
      const tryBody =
        stmt.block.type === "BlockStatement"
          ? stmt.block.body.map((s) => transpileStatement(s, depth + 1, tryOpts)).join("\n")
          : transpileStatement(stmt.block as unknown as Statement, depth + 1, tryOpts);
      const lines = [
        `${pad}const ${markName} = $tryMark();`,
        `${pad}try {`,
        tryBody,
        `${pad}}`,
      ];
      // catch ([a, b]) / catch ({v})：模式参此前只绑载体名 "e"，子名静默丢
      // 绑定 → catch 体自由读 spurious-throw 面（差分 FALSE-THROW）。
      // 载体改用 catchTmp 原生绑定（可再赋、与用户子名不撞车），守卫区内
      // emitDestructure 绑定全部子名（let 语义：catch 参块内可再赋）。
      const handlerParam = stmt.handler?.param as Node | null | undefined;
      const patternParam =
        handlerParam &&
        (handlerParam.type === "ObjectPattern" || handlerParam.type === "ArrayPattern")
          ? handlerParam
          : null;
      const catchParam =
        handlerParam?.type === "Identifier"
          ? (handlerParam as unknown as { name: string }).name
          : "e";
      const catchTmp = `__nudoE_${tmpNo}`;
      // Bug 52：catch 体仍受本 try 的 finally 覆盖（.return 注入值可被改写），
      // 但注入到 catch 内 yield 的 .throw 不再被**本** catch 重新吸收
      //（native：catch 内 throw 直接穿出 try，经 finally 上抛）——只并
      // 外层 ctx + 本 finally 位（含 finalizer 静态事实）
      // P4b：catch 参数遮蔽外层 const / 类体不可变自有名——体内写的是
      // catch 绑定（let 语义，原生可再赋 no-throw），不得假 TypeError。
      const catchShadow = new Set<string>();
      if (stmt.handler?.param) collectPatternNames(stmt.handler.param, catchShadow);
      const catchOpts: TranspileOptions = {
        ...opts,
        yieldTryCtx: (opts.yieldTryCtx ?? 0) | finBits,
        ...(opts.constNames && catchShadow.size > 0
          ? {
              constNames: new Set(
                [...opts.constNames].filter((n) => !catchShadow.has(n)),
              ),
            }
          : {}),
      };
      const transpileCatchBody = (d: number, o: TranspileOptions): string =>
        !stmt.handler
          ? ""
          : stmt.handler.body.type === "BlockStatement"
            ? stmt.handler.body.body.map((s) => transpileStatement(s, d, o)).join("\n")
            : transpileStatement(stmt.handler.body as unknown as Statement, d, o);
      if (stmt.handler) {
        const catchBody = transpileCatchBody(depth + 1, catchOpts);
        const softVar = `__soft_${markName}`;
        lines.push(`${pad}catch (${catchTmp}) {`);
        // NudoReturn 是控制流信号，不是 catch 绑定
        lines.push(`${indent(depth + 1)}$rethrowIfNudoReturn(${catchTmp});`);
        // soft：入口摘下、不立刻消化；catch 落出口 discard，rethrow orphan 上浮
        lines.push(`${indent(depth + 1)}const ${softVar} = $tryDetachSoftCatch();`);
        lines.push(`${indent(depth + 1)}const __xs_${markName} = $tryTakeSince(${markName});`);
        lines.push(`${indent(depth + 1)}__xs_${markName}.push($catchVal(${catchTmp}));`);
        lines.push(
          // catch 绑定可再赋（let 语义），不是 const；模式参载体 = catchTmp
          patternParam
            ? `${indent(depth + 1)}${catchTmp} = __xs_${markName}.reduce((a, b) => $join(a, b));`
            : `${indent(depth + 1)}let ${catchParam} = __xs_${markName}.reduce((a, b) => $join(a, b));`,
        );
        lines.push(`${indent(depth + 1)}try {`);
        if (patternParam) {
          // 模式参绑定入守卫区：$iterCheck/$get 抛出的 TypeError 经 rethrow
          // 包装上抛 = native 口径（解构抛错不是 catch 体可消化的路径）
          emitDestructure(
            patternParam,
            catchTmp,
            "let",
            indent(depth + 2),
            catchOpts,
            lines,
            opts.destrTmpSeq ?? { n: 0 },
          );
        }
        lines.push(catchBody);
        lines.push(`${indent(depth + 1)}} catch (__rethrow_${markName}) {`);
        lines.push(`${indent(depth + 2)}$tryOrphanSoft(${softVar});`);
        lines.push(`${indent(depth + 2)}throw __rethrow_${markName};`);
        lines.push(`${indent(depth + 1)}}`);
        lines.push(`${indent(depth + 1)}$tryDiscardSoft(${softVar});`);
        lines.push(`${pad}}`);
      }
      // catch 体内（任意深度语句，不含嵌套函数/类体）出现 throw → 视为可能
      // rethrow：正常完成路径的 soft 效果不得消化（假想 soft throw 经
      // catch rethrow 逃逸——与 evalTry 的 catchR.threw 口径一致，含条件
      // throw 的保守上浮）。
      const softExit = !stmt.handler
        ? "$tryReleaseSoftOut();"
        : catchMayRethrow(stmt.handler)
          ? "$tryReleaseSoftCatch();"
          : "$tryDigestSoftCatch();";
      if (stmt.finalizer) {
        const finBody =
          stmt.finalizer.type === "BlockStatement"
            ? stmt.finalizer.body
                .map((s) => transpileStatement(s, depth + 1, opts))
                .join("\n")
            : transpileStatement(stmt.finalizer as unknown as Statement, depth + 1, opts);
        lines.push(`${pad}finally {`);
        lines.push(finBody);
        // finally 内收口 soft + mark（catch 与 finally 之间不得插入语句）
        lines.push(`${indent(depth + 1)}${softExit}`);
        lines.push(`${indent(depth + 1)}$tryPopMark();`);
        lines.push(`${pad}}`);
      } else {
        // 合成 finally：保证 try 合法，并在此收口 soft/mark
        lines.push(`${pad}finally {`);
        lines.push(`${indent(depth + 1)}${softExit}`);
        lines.push(`${indent(depth + 1)}$tryPopMark();`);
        lines.push(`${pad}}`);
      }
      // try/catch/finally 之后再 drain 未吸收的抽象 throw
      if (stmt.handler) {
        const catchBody = transpileCatchBody(depth + 2, catchOpts);
        lines.push(`${pad}{`);
        lines.push(`${indent(depth + 1)}const __post_${markName} = $tryTakeSince(${markName});`);
        lines.push(`${indent(depth + 1)}if (__post_${markName}.length) {`);
        lines.push(
          patternParam
            ? `${indent(depth + 2)}let ${catchTmp} = __post_${markName}.reduce((a, b) => $join(a, b));`
            : `${indent(depth + 2)}let ${catchParam} = __post_${markName}.reduce((a, b) => $join(a, b));`,
        );
        if (patternParam) {
          emitDestructure(
            patternParam,
            catchTmp,
            "let",
            indent(depth + 2),
            catchOpts,
            lines,
            opts.destrTmpSeq ?? { n: 0 },
          );
        }
        lines.push(
          catchBody
            .split("\n")
            .map((l) => (l ? `${indent(depth + 2)}${l.trimStart()}` : l))
            .join("\n"),
        );
        lines.push(`${indent(depth + 1)}}`);
        lines.push(`${pad}}`);
      } else {
        lines.push(`${pad}{`);
        lines.push(`${indent(depth + 1)}const __post_${markName} = $tryTakeSince(${markName});`);
        lines.push(`${indent(depth + 1)}if (__post_${markName}.length) {`);
        lines.push(`${indent(depth + 2)}$throw(__post_${markName}.reduce((a, b) => $join(a, b)));`);
        lines.push(`${indent(depth + 1)}}`);
        lines.push(`${pad}}`);
      }
      return lines.join("\n");
    }
    case "ForOfStatement":
    case "ForInStatement": {
      const isIn = stmt.type === "ForInStatement";
      // Babel 把 `for await (… of …)` 解析为 ForOfStatement + await:true——
      // 不得丢标志（Bug 13）：否则异步可迭代性永不校验，且仅异步可迭代的
      // 接收者被同步 $elems 投影（对象槽位折进迭代产出）。
      const isForAwait = !isIn && (stmt as { await?: boolean }).await === true;
      // for-in：键序列由 $forInKeys 投影（整数键升序/字符串插入序/hole 跳过）
      // Bug 98：非纯接收者（调用/计算键/短路等副作用面）先求值一次入
      // __forInRecv（原生单次求值口径），iter 与重查 thunk 共用；纯接收者
      // （标识符 / 非计算成员链）直接重读绑定——delete 写回可见。
      let recvPre: string[] = [];
      let recvSrc = "";
      if (isIn && !isPureForInRecv(stmt.right as Expression)) {
        // 同块多个 for-in 不得重复声明：模块级计数器唯一化
        const recvTmp = `__fir${++forInRecvSeq}`;
        recvPre = [`${pad}const ${recvTmp} = (${emitTranspileExpression(stmt.right as Expression, opts)});`];
        recvSrc = recvTmp;
      } else {
        recvSrc = emitTranspileExpression(stmt.right as Expression, opts);
      }
      const iter = isIn
        ? `$forInKeys(${recvSrc})`
        : recvSrc;
      // for (const x of xs) / for (const [a,b] of xs)
      let bindName = "_item";
      if (stmt.left.type === "VariableDeclaration") {
        const decl = stmt.left.declarations[0];
        if (decl?.id.type === "Identifier") bindName = decl.id.name;
        else if (decl?.id.type === "ObjectPattern" || decl?.id.type === "ArrayPattern") {
          // 解构绑定：用临时 _item 再 destructure
          bindName = `_of${stmt.loc?.start.line ?? 0}`;
        }
      } else if (stmt.left.type === "Identifier") {
        bindName = stmt.left.name;
      }
      const bodyLines: string[] = [];
      // for (const x of …) 头绑定在循环体内不可再赋
      const loopConstNames = new Set(opts.constNames);
      let loopBindIsConst = false;
      if (stmt.left.type === "VariableDeclaration" && stmt.left.kind === "const") {
        loopBindIsConst = true;
        if (stmt.left.declarations[0]?.id.type === "Identifier") {
          loopConstNames.add(stmt.left.declarations[0].id.name);
        } else if (
          stmt.left.declarations[0]?.id.type === "ObjectPattern" ||
          stmt.left.declarations[0]?.id.type === "ArrayPattern"
        ) {
          const patternNames = new Set<string>();
          collectPatternNames(stmt.left.declarations[0].id, patternNames);
          for (const n of patternNames) loopConstNames.add(n);
        }
      } else if (
        stmt.left.type === "VariableDeclaration" &&
        (stmt.left.kind === "let" || stmt.left.kind === "var") &&
        stmt.left.declarations[0]?.id.type === "Identifier"
      ) {
        // let/var 头绑定遮蔽外层 const/import 名（Bug ②）：体内可再赋，
        // 不得误折 TypeError——从继承的 const 面扣除遮蔽名
        loopConstNames.delete(stmt.left.declarations[0].id.name);
      }
      if (
        stmt.left.type === "VariableDeclaration" &&
        stmt.left.declarations[0] &&
        (stmt.left.declarations[0].id.type === "ObjectPattern" ||
          stmt.left.declarations[0].id.type === "ArrayPattern")
      ) {
        emitDestructure(
          stmt.left.declarations[0].id as Node,
          bindName,
          "const",
          indent(depth + 2),
          { ...opts, constNames: loopConstNames },
          bodyLines,
          { n: 0 },
        );
      }
      const bodyOpts: TranspileOptions = {
        ...opts,
        constNames: loopConstNames,
        inLoop: (opts.inLoop ?? 0) + 1,
        loopLabel: undefined,
      };
      const bodyStmts =
        stmt.body.type === "BlockStatement"
          ? stmt.body.body.map((s) => transpileStatement(s, depth + 2, bodyOpts)).join("\n")
          : transpileStatement(stmt.body, depth + 2, bodyOpts);
      const max = opts.maxLoopIters ?? 8;
      // 与 while/for 同协议：体内外层绑定 pack/unpack，抽象/空迭代出口可 join
      const assigned = new Set<string>();
      collectAssignedIds(stmt.body, assigned);
      collectArrMutatorReceivers(stmt.body, assigned);
      const bodyLocalDecls = new Set<string>();
      collectLoopBodyTopLevelDeclNames(stmt.body, bodyLocalDecls);
      const names = [...assigned].filter((n) => n !== bindName && !HOST_INTRINSIC_SET.has(n) && !bodyLocalDecls.has(n));
      const loopOpts = opts.loopLabel ? `label: ${JSON.stringify(opts.loopLabel)}` : "";
      const forAwaitOpt = isForAwait ? "forAwait: true" : "";
      // Bug 98：for-in 接收者以 thunk 传给 $forOf——快照键进体前逐迭代重查
      // 在场（体内 delete 的未访问键跳过，与原生 EnumerateObjectProperties
      // 一致）。纯接收者 thunk 每迭代重读当前绑定（delete 写回
      // o = $del(o, k) / 成员链 o = $set(o, …) 经闭包可见）；副作用接收者
      // 已在循环头求值入 __forInRecv，重查按该快照引用（此形态 delete
      // 不可见，保持快照口径——副作用一次求值优先）。
      const forInRecvOpt = isIn ? `forInRecv: () => (${recvSrc})` : "";
      const tailOpts = [loopOpts, forAwaitOpt, forInRecvOpt].filter(Boolean).join(", ");
      const optsSrc =
        names.length === 0
          ? tailOpts
            ? `, { ${tailOpts} }`
            : ""
          : `, { pack: () => $obj({ ${names.map((n) => `${JSON.stringify(n)}: $copy(${n})`).join(", ")} }), unpack: (__lp) => { ${names.map((n) => `${n} = $get(__lp, ${JSON.stringify(n)});`).join(" ")} }${tailOpts ? `, ${tailOpts}` : ""} }`;
      return [
        ...recvPre,
        `${pad}$forOf(${iter}, (${bindName}, _i) => {`,
        ...bodyLines,
        bodyStmts,
        `${pad}}, ${max}${optsSrc});`,
      ].join("\n");
    }
    case "WhileStatement": {
      const test = emitTranspileExpression(stmt.test, opts);
      const bodyOpts: TranspileOptions = {
        ...opts,
        inLoop: (opts.inLoop ?? 0) + 1,
        loopLabel: undefined,
      };
      const body =
        stmt.body.type === "BlockStatement"
          ? stmt.body.body.map((s) => transpileStatement(s, depth + 1, bodyOpts)).join("\n")
          : transpileStatement(stmt.body, depth + 1, bodyOpts);
      const max = opts.maxLoopIters ?? 8;
      // body/test 内被赋值的标识符 → pack/unpack，抽象条件出口可 join（P0 健全）
      // 注：mutator 接收者不入集——与既有 while 精度口径一致（for/for-of/
      // do-while 入集；while 保持 #136 的 {0,1} 出口 join 精度）
      const assigned = new Set<string>();
      collectAssignedIds(stmt.body, assigned);
      collectAssignedIds(stmt.test, assigned);
      const bodyLocalDecls = new Set<string>();
      collectLoopBodyTopLevelDeclNames(stmt.body, bodyLocalDecls);
      // while 守卫收窄（issue #118 v3）：测试的 cons 臂事实作用于循环体——
      // `while ((m = re.exec(s)))` 每轮测试真值 ⇒ 该轮体内 m 非 nullish，
      // `m[2].trim()` 不再撞 null 臂记假 may-throw（#97/#118 臂剪影的循环
      // 版）。体工厂逐迭代调用，IIFE 在**每次进体**时以当前绑定求 remove
      // 串（不跨迭代缓存）；$whileSeq 先 test() 后 body()，体内事实成立。
      // 体侧守卫名有写（含 mutator receiver）/体顶层同名词法声明 → 跳过
      // 全部（影子参数吞体侧写 / 重复声明 SyntaxError）；测试侧赋值恰是
      // `(m = …)` 惯用形态，不构成跳过。pack/unpack 名集（体∪测试）不变。
      const bodyWrites = new Set<string>();
      collectAssignedIds(stmt.body, bodyWrites);
      collectArrMutatorReceivers(stmt.body, bodyWrites);
      const loopGuards = nullishGuardsOf(stmt.test).filter(
        (g) => g.arm === "cons" && !bodyWrites.has(g.name) && !bodyLocalDecls.has(g.name),
      );
      const bodyNarrowed =
        loopGuards.length === 0
          ? body
          : [
              `${indent(depth + 1)}((${loopGuards.map((g) => g.name).join(", ")}) => {`,
              body,
              `${indent(depth + 1)}})(${loopGuards.map((g) => nullishRemoveCallOf(g)).join(", ")});`,
            ].join("\n");
      const names = [...assigned].filter((n) => !HOST_INTRINSIC_SET.has(n) && !bodyLocalDecls.has(n));
      const loopOpts = opts.loopLabel ? `label: ${JSON.stringify(opts.loopLabel)}` : "";
      if (names.length === 0) {
        return [
          `${pad}// while → $whileSeq (bounded, max=${max})`,
          `${pad}$whileSeq(() => ${test}, () => {`,
          bodyNarrowed,
          `${pad}}, ${max}${loopOpts ? `, { ${loopOpts} }` : ""});`,
        ].join("\n");
      }
      const packSrc = `$obj({ ${names.map((n) => `${JSON.stringify(n)}: $copy(${n})`).join(", ")} })`;
      const unpackSrc = `(__lp) => { ${names.map((n) => `${n} = $get(__lp, ${JSON.stringify(n)});`).join(" ")} }`;
      return [
        `${pad}// while → $whileSeq (instrumented bindings: ${names.join(", ")})`,
        `${pad}$whileSeq(() => ${test}, () => {`,
        bodyNarrowed,
        `${pad}}, ${max}, { pack: () => ${packSrc}, unpack: ${unpackSrc}${loopOpts ? `, ${loopOpts}` : ""} });`,
      ].join("\n");
    }
    case "DoWhileStatement": {
      // do { body } while (test) ≡ body; while (test) { body }（有界、可 instrument）
      const test = emitTranspileExpression(stmt.test, opts);
      const bodyOpts: TranspileOptions = {
        ...opts,
        inLoop: (opts.inLoop ?? 0) + 1,
        loopLabel: undefined,
      };
      const bodyStmts =
        stmt.body.type === "BlockStatement"
          ? stmt.body.body.map((s) => transpileStatement(s, depth + 1, bodyOpts)).join("\n")
          : transpileStatement(stmt.body, depth + 1, bodyOpts);
      const max = opts.maxLoopIters ?? 8;
      const assigned = new Set<string>();
      collectAssignedIds(stmt.body, assigned);
      collectAssignedIds(stmt.test, assigned);
      collectArrMutatorReceivers(stmt.body, assigned);
      const bodyLocalDecls = new Set<string>();
      collectLoopBodyTopLevelDeclNames(stmt.body, bodyLocalDecls);
      // do-while 守卫收窄（issue #118 v3）：**只**收窄内层 $whileSeq 的体
      // 拷贝（第 2 轮起先过测试，cons 臂事实成立）；首次独立拷贝先于任何
      // 测试求值执行（`do { m[0] } while ((m = f()))` 首轮 m 可能
      // nullish），保持未收窄（sound）。跳过规则与 while 同口径：体侧守卫
      // 名有写 / 体顶层同名词法声明 → 全部跳过；测试侧赋值不算。
      const bodyWrites = new Set<string>();
      collectAssignedIds(stmt.body, bodyWrites);
      collectArrMutatorReceivers(stmt.body, bodyWrites);
      const loopGuards = nullishGuardsOf(stmt.test).filter(
        (g) => g.arm === "cons" && !bodyWrites.has(g.name) && !bodyLocalDecls.has(g.name),
      );
      const innerBody =
        loopGuards.length === 0
          ? bodyStmts
          : [
              `${indent(depth + 1)}((${loopGuards.map((g) => g.name).join(", ")}) => {`,
              bodyStmts,
              `${indent(depth + 1)}})(${loopGuards.map((g) => nullishRemoveCallOf(g)).join(", ")});`,
            ].join("\n");
      const names = [...assigned].filter((n) => !HOST_INTRINSIC_SET.has(n) && !bodyLocalDecls.has(n));
      const packSrc =
        names.length === 0
          ? null
          : `$obj({ ${names.map((n) => `${JSON.stringify(n)}: $copy(${n})`).join(", ")} })`;
      const unpackSrc =
        names.length === 0
          ? null
          : `(__lp) => { ${names.map((n) => `${n} = $get(__lp, ${JSON.stringify(n)});`).join(" ")} }`;
      const loopOpts = opts.loopLabel ? `label: ${JSON.stringify(opts.loopLabel)}` : "";
      const optsSrc =
        packSrc && unpackSrc
          ? `, { pack: () => ${packSrc}, unpack: ${unpackSrc}${loopOpts ? `, ${loopOpts}` : ""} }`
          : loopOpts
            ? `, { ${loopOpts} }`
            : "";
      return [
        `${pad}// do-while → body + $whileSeq (bounded, max=${max})`,
        `{`,
        bodyStmts,
        `${indent(depth + 1)}$whileSeq(() => ${test}, () => {`,
        innerBody,
        `${indent(depth + 1)}}, ${max}${optsSrc});`,
        `${pad}}`,
      ].join("\n");
    }
    case "ClassDeclaration": {
      return transpileClass(stmt, depth, opts);
    }
    case "BreakStatement": {
      // switch 臂内无标签 break = 臂结束（fall-through 合并已按结构吸收）
      if (opts.inSwitchArm && !stmt.label) return `${pad}return;`;
      // 带标签 break 可指向循环或 labeled block（`foo: { break foo; }`）；
      // 统一生成 $loopBreak(label)，由同标签循环/标签块吸收
      if (stmt.label) {
        return `${pad}$loopBreak(${JSON.stringify(stmt.label.name)});`;
      }
      if ((opts.inLoop ?? 0) > 0) {
        return `${pad}$loopBreak();`;
      }
      return `${pad}/* skip break (outside loop) */`;
    }
    case "ContinueStatement": {
      // continue 只能目标循环；labeled block 不可 continue
      if ((opts.inLoop ?? 0) > 0) {
        return `${pad}$loopContinue(${stmt.label ? JSON.stringify(stmt.label.name) : ""});`;
      }
      return `${pad}/* skip continue (outside loop) */`;
    }
    case "LabeledStatement": {
      // 标签包循环：把标签传给内层循环的 $for/$whileSeq/$forOf（信号匹配）
      if (
        stmt.body.type === "ForStatement" ||
        stmt.body.type === "WhileStatement" ||
        stmt.body.type === "DoWhileStatement" ||
        stmt.body.type === "ForOfStatement" ||
        stmt.body.type === "ForInStatement"
      ) {
        return transpileStatement(stmt.body, depth, { ...opts, loopLabel: stmt.label.name });
      }
      // 非循环标签块：break label 跳出本块——try 吸收同标签 break 信号
      const bodySrc = transpileStatement(stmt.body, depth + 2, opts);
      return [
        `${pad}{`,
        `${indent(depth + 1)}try {`,
        bodySrc,
        `${indent(depth + 1)}} catch (__e) {`,
        `${indent(depth + 2)}if (!$isBreakTo(__e, ${JSON.stringify(stmt.label.name)})) throw __e;`,
        `${indent(depth + 1)}}`,
        `${pad}}`,
      ].join("\n");
    }
    case "EmptyStatement":
    case "DebuggerStatement":
      // 良性无操作语句：显式 no-op（不得落 default throw）
      return "";
    default:
      throw new NudoUnsupportedError(
        `statement:${stmt.type}`,
        stmt.loc ? { line: stmt.loc.start.line, column: stmt.loc.start.column } : undefined,
      );
  }
}
