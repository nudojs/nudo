/**
 * 语句 / 块 / class 发射：transpileStatement、transpileBodyNode、transpileClass。
 */
import type { Statement, Expression, Node, File } from "@babel/types";
import type { TranspileOptions } from "./types.ts";
import { NudoUnsupportedError } from "../unsupported.ts";
import {
  isExpression,
  matchAsOverride,
  matchReplacement,
  fnBodyHasThis,
  fnBodyHasOwnArguments,
  indent,
  collectFreeAssignedNames,
  collectForkBindingNames,
  collectAssignedIds,
  collectArrMutatorReceivers,
  staticKeyOf,
  symbolKeyOf,
  paramDisplayNames,
} from "./helpers.ts";
import { BIN_OPS, COMPOUND_OPS, isStatefulMethodName } from "./ops.ts";
import {
  emitArrMutatorRebinds,
  emitDestructure,
  emitParamBinding,
  emitParamBindingFromArgs,
  forkArmThunk,
  forkBindingDecls,
  forkJoinBindings,
  matchOptionalRequire,
  catchMayRethrow,
} from "./emit.ts";
import { memberPathOf, readPathSrc, setPathSrc, readPrefix, setParentPathSrc } from "./member-path.ts";
import { emitTranspileExpression } from "./transpile-dispatch.ts";

/** switch 共享体函数名序号（跨语句/函数去重） */
let switchBodySeq = 0;

// 控制流谓词 → stmt-predicates.ts（leaf）
export {
  stmtCompletesControl,
  stmtReturns,
  isTerminalStmt,
  completeElseChain,
  completeElseChains,
  withImplicitReturn,
} from "./stmt-predicates.ts";
import {
  stmtCompletesControl,
  stmtReturns,
  isTerminalStmt,
  completeElseChain,
  completeElseChains,
  withImplicitReturn,
} from "./stmt-predicates.ts";

/**
 * 方法/函数体统一发射：早退 if 提升（transpileFnBodyStmts）+ 可选隐式 return。
 * ObjectMethod / ClassMethod / 属性位 FunctionExpression 必须走本入口——
 * 逐语句 map(transpileStatement) 会绕过提升，`if (c) return X; return Y`
 * 的早退值被语句级 $fork thunk 吞掉（恒折 fall-through 值的假精确）。
 */
export function emitFnBlockBody(
  body: Node | undefined | null,
  depth: number,
  opts: TranspileOptions,
  o: { implicitReturn?: boolean } = {},
): string {
  const implicitReturn = o.implicitReturn !== false;
  if (!body) {
    return implicitReturn ? `${indent(depth)}return $lit(undefined);` : "";
  }
  if (body.type !== "BlockStatement") {
    return `${indent(depth)}return ${emitTranspileExpression(body as Expression, opts)};`;
  }
  const stmts = transpileFnBodyStmts(body.body as Statement[], depth, opts);
  return implicitReturn ? withImplicitReturn(body, stmts, depth) : stmts;
}

export function transpileFnBodyStmts(stmtsIn: Statement[], depth: number, opts: TranspileOptions): string {
  const stmts = completeElseChains(stmtsIn);
  for (let i = 0; i < stmts.length; i++) {
    const stmt = stmts[i]!;
    if (stmt.type !== "IfStatement" || stmt.alternate != null) continue;
    if (!stmtReturns(stmt.consequent)) continue;
    const rest = stmts.slice(i + 1);
    if (rest.length === 0) continue;
    const head = stmts
      .slice(0, i)
      .map((s) => transpileStatement(s, depth, opts))
      .join("\n");
    const test = emitTranspileExpression(stmt.test, opts);
    // P0.1：早退提升同样必须隔离臂间 mutator/普通绑定
    const recvSet = new Set<string>([
      ...collectForkBindingNames(stmt.consequent),
      ...collectForkBindingNames(stmt.test),
      ...collectForkBindingNames(...rest),
    ]);
    const names = [...recvSet];
    const pad = indent(depth);
    const padIn = indent(depth + 1);
    // 与 IfStatement 同协议：set-flag 哨兵 + forkJoinBindings
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
    const testRecvs = collectArrMutatorReceivers(stmt.test);
    const testRebinds = testRecvs.size
      ? emitArrMutatorRebinds(stmt.test as Node, opts, pad)
      : [];
    const cons = wrapArm(transpileBlockAsThunk(stmt.consequent, depth, opts), "fk1_");
    const altBody = transpileFnBodyStmts(rest, depth + 1, { ...opts, inLoop: opts.inLoop });
    const altThunk = `() => {\n${altBody}\n${pad}}`;
    const alt = wrapArm(altThunk, "fk2_");
    const inCtrl = (opts.inLoop ?? 0) > 0 || (opts.inTry ?? 0) > 0;
    const applyJoin = names.length ? forkJoinBindings(names, pad).join("\n") : "";
    if (names.length === 0) {
      const promoted = [
        ...testRebinds,
        inCtrl
          ? `${pad}$loopReturn($fork(${test}, ${cons}, ${alt}));`
          : `${pad}return $fork(${test}, ${cons}, ${alt});`,
      ].join("\n");
      return head ? `${head}\n${promoted}` : promoted;
    }
    const promoted = [
      `${pad}{`,
      ...testRebinds,
      ...forkBindingDecls(names, padIn),
      `${padIn}const __fkR = $fork(${test}, ${cons}, ${alt});`,
      applyJoin.split("\n").map((l) => l.replace(/^\s*/, padIn)).join("\n"),
      inCtrl
        ? `${padIn}$loopReturn(__fkR);`
        : `${padIn}return __fkR;`,
      `${pad}}`,
    ].join("\n");
    return head ? `${head}\n${promoted}` : promoted;
  }
  return stmts.map((s) => transpileStatement(s, depth, opts)).join("\n");
}


export function transpileBodyNode(node: Node, opts: TranspileOptions): string {
  if (isExpression(node as { type: string })) {
    return `return ${emitTranspileExpression(node as Expression, opts)};`;
  }
  return withImplicitReturn(node, transpileStatement(node as Statement, 1, opts), 1);
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
        const specs = stmt.specifiers
          .filter(
            (s): s is typeof s & {
              local: { type?: string; name?: string; value?: string };
              exported: { type?: string; name?: string; value?: string };
            } => "local" in s,
          )
          .map((s) => {
            const local = s.local.type === "Identifier" ? s.local.name : s.local.value;
            const exported =
              s.exported.type === "Identifier" ? s.exported.name : s.exported.value;
            return local === exported ? local : `${local} as ${exported}`;
          })
          .join(", ");
        if (stmt.source) {
          return `${pad}export { ${specs} } from ${JSON.stringify(stmt.source.value)};`;
        }
        return `${pad}export { ${specs} };`;
      }
      const inner = transpileStatement(decl as Statement, depth, opts);
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
      // `arguments`：体直接引用时建独立 tuple 槽（strict 映射，见 $arguments）
      const hasArgs = fnBodyHasOwnArguments(stmt as { body?: Node | null });
      const fnOpts: TranspileOptions = {
        ...opts,
        inLoop: 0,
        inFunction: true,
        ...(hasThis ? { thisParam: "__this" } : {}),
        argsBinding: hasArgs ? "__nudoArgs" : undefined,
      };
      const { sig, rest, prologue } = emitParamBinding(
        stmt.params as Node[],
        indent(depth + 2),
        fnOpts,
      );
      const named = sig;
      const paramsSig = rest ? [...named, `...${rest}`] : named;
      const params = paramsSig.join(", ");
      const thisPrologue = hasThis
        ? `${indent(depth + 2)}const __this = $rawThis(this);\n`
        : "";
      // 真实 function 有宿主 arguments → 投成独立 tuple（不破坏下方 restBind）
      const argsPrologue = hasArgs
        ? `${indent(depth + 2)}let __nudoArgs = $arguments(arguments);\n`
        : "";
      const bodyStmts =
        stmt.body.type === "BlockStatement"
          ? withImplicitReturn(
              stmt.body,
              [...prologue, thisPrologue, argsPrologue, transpileFnBodyStmts(stmt.body.body, depth + 2, fnOpts)]
                .filter(Boolean)
                .join("\n"),
              depth + 2,
            )
          : `${indent(depth + 2)}${thisPrologue.trim()}${argsPrologue.trim()}return ${emitTranspileExpression(stmt.body as unknown as Expression, fnOpts)};`;
      const restBind = rest
        ? `${indent(depth + 1)}const ${rest} = arguments.length > ${named.length} ? $arr(Array.from(arguments).slice(${named.length})) : $arr([]);\n`
        : "";
      // function* → $gen 收集 yield
      if (stmt.generator) {
        return [
          `${pad}${exportKw}function ${stmt.id.name}(${named.join(", ")}) {`,
          restBind,
          `${indent(depth + 1)}return $gen(() => {`,
          bodyStmts,
          `${indent(depth + 1)}});`,
          `${pad}}`,
        ].join("\n");
      }
      if (stmt.async) {
        return [
          `${pad}${exportKw}function ${stmt.id.name}(${named.join(", ")}) {`,
          restBind,
          `${indent(depth + 1)}return $async(() => {`,
          bodyStmts,
          `${indent(depth + 1)}});`,
          `${pad}}`,
        ].join("\n");
      }
      return [
        `${pad}${exportKw}function ${stmt.id.name}(${named.join(", ")}) {`,
        restBind,
        bodyStmts,
        `${pad}}`,
      ].join("\n");
    }
    case "ReturnStatement": {
      const asVar = matchAsOverride(stmt as Node, opts);
      // C2.1：循环体内 return 不是「回调返回」，而是函数提前返回
      // try 内：先 drain 抽象 throwExits，有则 rethrow 让 catch 吸收；正常返回值进 loopExits 后由出口 join
      const prefix = (opts.inLoop ?? 0) > 0 ? "$loopReturn" : "return";
      const markExpr = opts.tryMarkName ?? "$tryCurrentMark()";
      const emitRet = (src: string, mutNodes?: Node | null): string => {
        const retRebinds = mutNodes ? emitArrMutatorRebinds(mutNodes, opts, pad) : [];
        if ((opts.inTry ?? 0) > 0) {
          return [
            `${pad}const __nudoRet = ${src};`,
            ...retRebinds,
            `${pad}{`,
            `${indent(depth + 1)}const __xs = $tryTakeSince(${markExpr});`,
            `${indent(depth + 1)}if (__xs.length) {`,
            `${indent(depth + 2)}$pushLoopExit(__nudoRet);`,
            `${indent(depth + 2)}$throw(__xs.reduce((a, b) => $join(a, b)));`,
            `${indent(depth + 1)}}`,
            `${indent(depth + 1)}${opts.tryRethrowCatch ? "$tryReleaseSoftCatch();" : opts.hasTryHandler === false ? "$tryReleaseSoftOut();" : "$tryDigestSoftCatch();"}`,
            `${pad}}`,
            `${pad}${prefix}(__nudoRet);`,
          ].join("\n");
        }
        if (retRebinds.length === 0) return `${pad}${prefix}(${src});`;
        return [
          `${pad}let __mutRet = ${src};`,
          ...retRebinds,
          `${pad}${prefix}(__mutRet);`,
        ].join("\n");
      };
      if (asVar) return emitRet(asVar);
      if (!stmt.argument) return emitRet(`$lit(undefined)`);
      const retSrc = emitTranspileExpression(stmt.argument, opts);
      return emitRet(retSrc, stmt.argument as Node);
    }
    case "ThrowStatement": {
      const arg = stmt.argument ? emitTranspileExpression(stmt.argument, opts) : "$lit(undefined)";
      return `${pad}$throw(${arg});`;
    }
    case "ExpressionStatement": {
      // C1.4：数组 mutator 语句重绑到**变更后容器**（$arrMutContainer），
      // 不得绑到 JS 返回值（pop 返回元素，会污染 receiver Abs）。
      // 表达式内 mutator：先求值（$invoke 只读容器），再重绑（P0 顺序）。
      const expr = stmt.expression as Expression;
      const exprRebinds = emitArrMutatorRebinds(expr, opts, pad);
      if (
        expr.type === "CallExpression" &&
        expr.callee.type === "MemberExpression" &&
        !expr.callee.computed &&
        expr.callee.property.type === "Identifier"
      ) {
        const methodName = (expr.callee.property as { name: string }).name;
        if (
          ["push", "unshift", "splice", "pop", "shift", "reverse", "sort"].includes(methodName)
        ) {
          const argSrcs = expr.arguments
            .map((a) =>
              a.type === "SpreadElement" ? "$lit(undefined)" : emitTranspileExpression(a as Expression, opts),
            )
            .join(", ");
          const objNode = expr.callee.object as Node;
          // 标识符：直接重绑绑定名
          if (objNode.type === "Identifier") {
            const name = (objNode as { name: string }).name;
            return `${pad}${name} = $arrMutContainer(${name}, ${JSON.stringify(methodName)}, [${argSrcs}]);`;
          }
          // 成员路径（this.arr / obj.x）：读-改-写重绑根，禁止 `$get(...) = …`
          if (objNode.type === "MemberExpression" || objNode.type === "ThisExpression") {
            const path =
              objNode.type === "MemberExpression"
                ? memberPathOf(objNode as unknown as { object: Node; property: Node; computed: boolean }, opts)
                : null;
            if (path) {
              const recvSrc = readPathSrc(path);
              const mutSrc = `$arrMutContainer(${recvSrc}, ${JSON.stringify(methodName)}, [${argSrcs}])`;
              return `${pad}${path.rootSrc} = ${setPathSrc(path, mutSrc)};`;
            }
            // 根不可重绑（this 无 thisParam 等）：保持纯调用
            return `${pad}${emitTranspileExpression(stmt.expression, opts)};`;
          }
        }
      }
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
      const kw = "let";
      const asVar = matchAsOverride(stmt as Node, opts);
      const lines: string[] = [];
      let tmpSeq = 0;
      for (const d of stmt.declarations) {
        if (d.id.type === "Identifier") {
          // @nudo:as：覆盖整个声明语句的 init
          const init = asVar
            ? asVar
            : d.init
              ? emitTranspileExpression(d.init, opts)
              : "$lit(undefined)";
          lines.push(`${pad}${kw} ${d.id.name} = ${init};`);
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
        const tmp = `_d${tmpSeq++}_${stmt.loc?.start.line ?? 0}`;
        lines.push(`${pad}const ${tmp} = ${initSrc};`);
        lines.push(...emitArrMutatorRebinds(d.init as Node, opts, pad));
        emitDestructure(d.id as Node, tmp, kw, pad, opts, lines, { n: 0 });
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
      const testRecvs = collectArrMutatorReceivers(stmt.test);
      const testRebinds = testRecvs.size
        ? emitArrMutatorRebinds(stmt.test as Node, opts, pad)
        : [];
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
        : "undefined";
      const cons = wrapArm(consRaw, "fk1_");
      const alt = names.length
        ? wrapArm(altRaw === "undefined" ? "() => $lit(undefined)" : altRaw, "fk2_")
        : altRaw;
      const joinLines = names.length
        ? [...testRebinds, ...forkBindingDecls(names, padDecl)]
        : testRebinds;
      const applyJoin = names.length ? forkJoinBindings(names, padDecl).join("\n") : "";
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
              ? `${pad}$loopReturn($fork(${test}, ${cons}, ${alt}));`
              : `${pad}return $fork(${test}, ${cons}, ${alt});`,
          ].join("\n");
        }
        return [
          openBlock,
          ...joinLines,
          `${padDecl}const __fkR = $fork(${test}, ${cons}, ${alt});`,
          applyJoin,
          inCtrl ? `${padDecl}$loopReturn(__fkR);` : `${padDecl}return __fkR;`,
          closeBlock,
        ].join("\n");
      }
      return [
        openBlock,
        ...joinLines,
        `${padDecl}$fork(${test}, ${cons}, ${alt});`,
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
        // 与主路径同口径：标识符 Update 强制 `name = $add/$sub(name, 1)`。
        const stepPart = (u: Node): string => {
          const upd = u as { type?: string; operator?: string; argument?: { type?: string; name?: string }; expressions?: unknown[] };
          if (upd.type === "UpdateExpression" && upd.argument?.type === "Identifier" && upd.argument.name) {
            return `${upd.argument.name} = ${upd.operator === "++" ? "$add" : "$sub"}(${upd.argument.name}, $lit(1))`;
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
            ? stmt.body.body
                .map((s) => transpileStatement(s, depth + 2, forBodyOpts))
                .join("\n")
            : transpileStatement(stmt.body, depth + 2, forBodyOpts);
        const max = opts.maxLoopIters ?? 8;
        const assigned = new Set<string>();
        collectAssignedIds(stmt.body, assigned);
        collectAssignedIds(stmt.test, assigned);
        collectAssignedIds(stmt.update, assigned);
        collectArrMutatorReceivers(stmt.body, assigned);
        const names = [...assigned].filter((n) => n !== "undefined");
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
          : "$lit(undefined)";
      const testSrc = stmt.test ? emitTranspileExpression(stmt.test, opts) : "$lit(true)";
      // for 步进闭包需要**自增后的新值**作状态线程；不能走 UpdateExpression 的
      // 后置旧值语义（那会丢自增副作用）
      const updateSrc =
        stmt.update && stmt.update.type === "UpdateExpression" &&
        stmt.update.argument.type === "Identifier"
          ? `${stmt.update.argument.name} = ${stmt.update.operator === "++" ? "$add" : "$sub"}(${stmt.update.argument.name}, $lit(1))`
          : stmt.update
            ? emitTranspileExpression(stmt.update, opts)
            : `$lit(undefined)`;
      const forBodyOpts: TranspileOptions = {
        ...opts,
        inLoop: (opts.inLoop ?? 0) + 1,
        loopLabel: undefined, // 标签属于本循环；体 opts 不得传给嵌套循环
      };
      const bodyStmts =
        stmt.body.type === "BlockStatement"
          ? stmt.body.body
              .map((s) => transpileStatement(s, depth + 2, forBodyOpts))
              .join("\n")
          : transpileStatement(stmt.body, depth + 2, forBodyOpts);
      const max = opts.maxLoopIters ?? 8;
      const assigned = new Set<string>();
      collectAssignedIds(stmt.body, assigned);
      collectAssignedIds(stmt.test, assigned);
      collectAssignedIds(stmt.update, assigned);
      collectArrMutatorReceivers(stmt.body, assigned);
      const names = [...assigned].filter((n) => n !== initName && n !== "undefined");
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
        `${indent(depth + 1)}(${initName}) => ${updateSrc},`,
        `${indent(depth + 1)}(${initName}) => {`,
        bodyStmts,
        `${indent(depth + 1)}  return ${initName};`,
        `${indent(depth + 1)}},`,
        `${indent(depth + 1)}${max}${optsSrc}`,
        `${pad});`,
      ].join("\n");
    }
    case "BlockStatement":
      // 块内同用早退提升：`{ if (c) return X; … }` 的 return 是函数级语义
      return transpileFnBodyStmts(stmt.body, depth, opts);
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
        defaultSrc = wrapArmThunk(`() => {\n${indent(depth + 2)}return $lit(undefined);\n${indent(depth + 1)}}`, armSeq);
      }
      switchBodySeq += Math.max(bodyIdx, 1);
      const dflt = defaultSrc ? `, ${defaultSrc}` : "";
      const discRebinds = collectArrMutatorReceivers(stmt.discriminant as Node).size
        ? emitArrMutatorRebinds(stmt.discriminant as Node, opts, pad)
        : [];
      const switchCall = `$switch(${disc}, [\n${caseLines.map((l) => indent(depth + 1) + l).join("\n")}\n${indent(depth + 1)}]${dflt})`;
      if (names.length === 0) {
        return [
          ...discRebinds,
          ...sharedBodyDecls,
          allReturn
            ? `${pad}return ${switchCall};`
            : `${pad}${switchCall};`,
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
      return [
        ...discRebinds,
        `${pad}{`,
        ...decls.map((l) => l.replace(new RegExp(`^${pad}`), `${pad}`)),
        ...sharedBodyDecls.map((l) =>
          l.startsWith(pad) ? `${pad}${l.slice(pad.length)}` : `${pad}${l}`,
        ),
        `${pad}const __swR = ${switchCall};`,
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
      const markName = `__nudoTm_${stmt.loc?.start.line ?? 0}`;
      const tryOpts: TranspileOptions = {
        ...opts,
        inTry: (opts.inTry ?? 0) + 1,
        tryMarkName: markName,
        hasTryHandler: !!stmt.handler,
        tryRethrowCatch: stmt.handler ? catchMayRethrow(stmt.handler) : false,
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
      const catchParam =
        stmt.handler?.param?.type === "Identifier"
          ? (stmt.handler.param as { name: string }).name
          : "e";
      const catchTmp = `__nudoE_${stmt.loc?.start.line ?? 0}`;
      const transpileCatchBody = (d: number, o: TranspileOptions): string =>
        !stmt.handler
          ? ""
          : stmt.handler.body.type === "BlockStatement"
            ? stmt.handler.body.body.map((s) => transpileStatement(s, d, o)).join("\n")
            : transpileStatement(stmt.handler.body as unknown as Statement, d, o);
      if (stmt.handler) {
        const catchBody = transpileCatchBody(depth + 1, opts);
        const softVar = `__soft_${markName}`;
        lines.push(`${pad}catch (${catchTmp}) {`);
        // NudoReturn 是控制流信号，不是 catch 绑定
        lines.push(`${indent(depth + 1)}$rethrowIfNudoReturn(${catchTmp});`);
        // soft：入口摘下、不立刻消化；catch 落出口 discard，rethrow orphan 上浮
        lines.push(`${indent(depth + 1)}const ${softVar} = $tryDetachSoftCatch();`);
        lines.push(`${indent(depth + 1)}const __xs_${markName} = $tryTakeSince(${markName});`);
        lines.push(`${indent(depth + 1)}__xs_${markName}.push($catchVal(${catchTmp}));`);
        lines.push(
          `${indent(depth + 1)}const ${catchParam} = __xs_${markName}.reduce((a, b) => $join(a, b));`,
        );
        lines.push(`${indent(depth + 1)}try {`);
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
        const catchBody = transpileCatchBody(depth + 2, opts);
        lines.push(`${pad}{`);
        lines.push(`${indent(depth + 1)}const __post_${markName} = $tryTakeSince(${markName});`);
        lines.push(`${indent(depth + 1)}if (__post_${markName}.length) {`);
        lines.push(
          `${indent(depth + 2)}const ${catchParam} = __post_${markName}.reduce((a, b) => $join(a, b));`,
        );
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
      // for-in：键序列由 $forInKeys 投影（整数键升序/字符串插入序/hole 跳过）
      const iter = isIn
        ? `$forInKeys(${emitTranspileExpression(stmt.right as Expression, opts)})`
        : emitTranspileExpression(stmt.right as Expression, opts);
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
          opts,
          bodyLines,
          { n: 0 },
        );
      }
      const bodyOpts: TranspileOptions = {
        ...opts,
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
      const names = [...assigned].filter((n) => n !== bindName && n !== "undefined");
      const loopOpts = opts.loopLabel ? `label: ${JSON.stringify(opts.loopLabel)}` : "";
      const optsSrc =
        names.length === 0
          ? loopOpts
            ? `, { ${loopOpts} }`
            : ""
          : `, { pack: () => $obj({ ${names.map((n) => `${JSON.stringify(n)}: $copy(${n})`).join(", ")} }), unpack: (__lp) => { ${names.map((n) => `${n} = $get(__lp, ${JSON.stringify(n)});`).join(" ")} }${loopOpts ? `, ${loopOpts}` : ""} }`;
      return [
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
      const assigned = new Set<string>();
      collectAssignedIds(stmt.body, assigned);
      collectAssignedIds(stmt.test, assigned);
      const names = [...assigned].filter((n) => n !== "undefined");
      const loopOpts = opts.loopLabel ? `label: ${JSON.stringify(opts.loopLabel)}` : "";
      if (names.length === 0) {
        return [
          `${pad}// while → $whileSeq (bounded, max=${max})`,
          `${pad}$whileSeq(() => ${test}, () => {`,
          body,
          `${pad}}, ${max}${loopOpts ? `, { ${loopOpts} }` : ""});`,
        ].join("\n");
      }
      const packSrc = `$obj({ ${names.map((n) => `${JSON.stringify(n)}: $copy(${n})`).join(", ")} })`;
      const unpackSrc = `(__lp) => { ${names.map((n) => `${n} = $get(__lp, ${JSON.stringify(n)});`).join(" ")} }`;
      return [
        `${pad}// while → $whileSeq (instrumented bindings: ${names.join(", ")})`,
        `${pad}$whileSeq(() => ${test}, () => {`,
        body,
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
      const names = [...assigned].filter((n) => n !== "undefined");
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
        bodyStmts,
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

/** class C extends P { ctor, methods } → $class(...) */
export function transpileClass(
  stmt: {
    id?: { name: string } | null;
    body: { body: unknown[] };
    superClass?: { type: string; name?: string } | null;
  },
  depth: number,
  opts: TranspileOptions,
): string {
  const pad = indent(depth);
  const name = stmt.id?.name ?? "AnonymousClass";
  const superName =
    stmt.superClass?.type === "Identifier" ? stmt.superClass.name : undefined;
  const methods = stmt.body.body as Array<{
    type: string;
    key?: { type: string; name?: string; value?: unknown };
    params?: unknown[];
    body?: { type: string; body?: unknown[] };
    kind?: string;
    async?: boolean;
    static?: boolean;
    value?: unknown;
  }>;

  const ctorParts: string[] = [];
  const methodParts: string[] = [];
  const staticMethodParts: string[] = [];
  const staticFieldParts: string[] = [];
  /** 方法形参展示名（未调用方法槽 shape.params） */
  const methodParamEntries: Array<[string, string[]]> = [];
  const staticMethodParamEntries: Array<[string, string[]]> = [];
  const accessorDefs = new Map<string, { get?: string; set?: string }>();
  const staticAccessorDefs = new Map<string, { get?: string; set?: string }>();

  const paramsOf = (m: { params?: unknown[] }): string[] =>
    (m.params ?? []).map((p) => {
      const id = p as { type?: string; name?: string };
      return id?.type === "Identifier" && id.name ? id.name : "_";
    });

  const methodOptsBase: TranspileOptions = {
    ...opts,
    inLoop: 0,
    inTry: 0,
    inFunction: true,
    thisParam: "__this",
    className: name,
  };

  for (const m of methods) {
    // 静态字段 ClassProperty
    if (m.type === "ClassProperty" || m.type === "ClassPrivateProperty") {
      const fname =
        m.key?.type === "Identifier" ? m.key.name : m.key?.type === "StringLiteral" ? String(m.key.value) : null;
      if (fname && m.value) {
        const vsrc = emitTranspileExpression(m.value as Expression, opts);
        staticFieldParts.push(`${indent(depth + 2)}${JSON.stringify(fname)}: ${vsrc},`);
      }
      continue;
    }
    if (m.type !== "ClassMethod" && m.type !== "ObjectMethod") continue;
    const mname =
      (m.key?.type === "Identifier"
        ? m.key.name
        : m.key?.type === "StringLiteral"
          ? String(m.key.value)
          : undefined) ?? "method";
    const params = paramsOf(m);
    const paramList = params.filter((p) => p !== "_").join(", ");
    // get/set 访问器：实例进 spec.accessors，静态进 spec.staticAccessors
    if (m.kind === "get" || m.kind === "set") {
      const accBodyOpts: TranspileOptions = { ...opts, inLoop: 0, inTry: 0, thisParam: "__this" };
      const accBody = m.body as Node | undefined;
      const target = m.static ? staticAccessorDefs : accessorDefs;
      const def = target.get(mname) ?? {};
      if (m.kind === "get") {
        const accBodyStmts = emitFnBlockBody(accBody, depth + 3, accBodyOpts);
        def.get = `(__this) => {\n${accBodyStmts}\n${indent(depth + 3)}}`;
      } else {
        const vname = params.length > 0 && params[0] !== "_" ? params[0]! : "__v";
        // setter 尾部 return __this——implicitReturn 关闭
        const setBody = emitFnBlockBody(accBody, depth + 3, accBodyOpts, { implicitReturn: false });
        def.set = `(__this, ${vname}) => {\n${setBody}\n${indent(depth + 4)}return __this;\n${indent(depth + 3)}}`;
      }
      target.set(mname, def);
      continue;
    }
    // ctor 有显式 `return __this`（下方追加）——不得加隐式 return 抢行
    const isCtor = m.kind === "constructor" || mname === "constructor";
    const mHasArgs = fnBodyHasOwnArguments({ body: m.body as Node });
    const methodOpts: TranspileOptions = {
      ...methodOptsBase,
      argsBinding: mHasArgs ? "__nudoArgs" : undefined,
    };
    let bodyStmts = emitFnBlockBody(
      m.body as Node | undefined,
      depth + 3,
      m.static ? { ...opts, argsBinding: mHasArgs ? "__nudoArgs" : undefined } : methodOpts,
      { implicitReturn: !isCtor },
    );
    if (mHasArgs) {
      const bound = emitParamBindingFromArgs(
        (m.params ?? []) as Node[],
        indent(depth + 4),
        methodOpts,
        "__nudoArgs",
      );
      bodyStmts = [
        `${indent(depth + 4)}let __nudoArgs = $arguments(__margs);`,
        ...bound.prologue,
        bodyStmts,
      ].join("\n");
    }
    if (m.static) {
      staticMethodParts.push(
        `${indent(depth + 3)}${mname}: (${mHasArgs ? "...__margs" : paramList}) => {`,
        bodyStmts,
        `${indent(depth + 3)}},`,
      );
      staticMethodParamEntries.push([mname, paramDisplayNames(m.params)]);
      continue;
    }
    if (m.kind === "constructor" || mname === "constructor") {
      ctorParts.push(
        `${indent(depth + 2)}ctor: (__this, ${mHasArgs ? "...__margs" : paramList}) => {`,
        bodyStmts,
        `${indent(depth + 3)}return __this;`,
        `${indent(depth + 2)}},`,
      );
    } else if (m.async) {
      methodParts.push(
        `${indent(depth + 3)}${mname}: (__this, ${mHasArgs ? "...__margs" : paramList}) => {`,
        `${indent(depth + 4)}return $async(() => {`,
        bodyStmts,
        `${indent(depth + 4)}});`,
        `${indent(depth + 3)}},`,
      );
      methodParamEntries.push([mname, paramDisplayNames(m.params)]);
    } else {
      methodParts.push(
        `${indent(depth + 3)}${mname}: (__this, ${mHasArgs ? "...__margs" : paramList}) => {`,
        bodyStmts,
        `${indent(depth + 3)}},`,
      );
      methodParamEntries.push([mname, paramDisplayNames(m.params)]);
    }
  }

  const specLines: string[] = [];
  if (superName) {
    // 活引用而非名字字符串：class B extends A {} 在 A 声明前求值时
    // 触发 let TDZ ReferenceError（原生语义）；宿主全局（extends Map）按名解析
    specLines.push(`${indent(depth + 2)}extends: ${superName},`);
  }
  if (staticFieldParts.length) {
    specLines.push(`${indent(depth + 2)}statics: {`, ...staticFieldParts, `${indent(depth + 2)}},`);
  }
  if (staticMethodParts.length) {
    specLines.push(
      `${indent(depth + 2)}staticMethods: {`,
      ...staticMethodParts,
      `${indent(depth + 2)}},`,
    );
  }
  if (staticMethodParamEntries.length) {
    specLines.push(`${indent(depth + 2)}staticMethodParams: {`);
    for (const [k, names] of staticMethodParamEntries) {
      specLines.push(`${indent(depth + 3)}${JSON.stringify(k)}: [${names.map((n) => JSON.stringify(n)).join(", ")}],`);
    }
    specLines.push(`${indent(depth + 2)}},`);
  }
  if (ctorParts.length) {
    specLines.push(...ctorParts);
  }
  if (methodParts.length) {
    specLines.push(`${indent(depth + 2)}methods: {`, ...methodParts, `${indent(depth + 2)}},`);
  }
  if (methodParamEntries.length) {
    specLines.push(`${indent(depth + 2)}methodParams: {`);
    for (const [k, names] of methodParamEntries) {
      specLines.push(`${indent(depth + 3)}${JSON.stringify(k)}: [${names.map((n) => JSON.stringify(n)).join(", ")}],`);
    }
    specLines.push(`${indent(depth + 2)}},`);
  }
  if (accessorDefs.size > 0) {
    const accParts: string[] = [];
    for (const [k, def] of accessorDefs) {
      const members: string[] = [];
      if (def.get) members.push(`${indent(depth + 4)}get: ${def.get},`);
      if (def.set) members.push(`${indent(depth + 4)}set: ${def.set},`);
      accParts.push(`${indent(depth + 3)}${JSON.stringify(k)}: {`, ...members, `${indent(depth + 3)}},`);
    }
    specLines.push(
      `${indent(depth + 2)}accessors: {`,
      ...accParts,
      `${indent(depth + 2)}},`,
    );
  }
  if (staticAccessorDefs.size > 0) {
    const accParts: string[] = [];
    for (const [k, def] of staticAccessorDefs) {
      const members: string[] = [];
      if (def.get) members.push(`${indent(depth + 4)}get: ${def.get},`);
      if (def.set) members.push(`${indent(depth + 4)}set: ${def.set},`);
      accParts.push(`${indent(depth + 3)}${JSON.stringify(k)}: {`, ...members, `${indent(depth + 3)}},`);
    }
    specLines.push(
      `${indent(depth + 2)}staticAccessors: {`,
      ...accParts,
      `${indent(depth + 2)}},`,
    );
  }

  return [
    // let：静态成员写 A.x = v 经 $set 不可变更新后需重绑类绑定
    `${pad}let ${name} = $class(${JSON.stringify(name)}, {`,
    ...specLines,
    `${pad}});`,
  ].join("\n");
}

export function transpileBlockAsThunk(stmt: Statement, depth: number, opts: TranspileOptions): string {
  if (stmt.type === "BlockStatement") {
    const inner = transpileFnBodyStmts(stmt.body, depth + 1, opts);
    return `() => {\n${inner}\n${indent(depth)}}`;
  }
  if (stmt.type === "ReturnStatement") {
    const v = stmt.argument ? emitTranspileExpression(stmt.argument, opts) : "$lit(undefined)";
    // C2.1：循环体内的 return 是函数提前返回，不是 thunk 的表达式值
    if ((opts.inLoop ?? 0) > 0) {
      return `() => { $loopReturn(${v}); }`;
    }
    return `() => ${v}`;
  }
  const one = transpileStatement(stmt, depth + 1, opts);
  return `() => {\n${one}\n${indent(depth)}}`;
}

export function extractForInitName(init: Statement | Expression | null | undefined): string | null {
  if (!init || init.type !== "VariableDeclaration") return null;
  // `var` 是函数作用域共享绑定——不得走每迭代参数槽（闭包会误做成 per-iteration）。
  // 返回 null 路由到 fallback：init 就地发射，test/update/body 读真实绑定。
  if (init.kind === "var") return null;
  const d = init.declarations[0];
  return d?.id.type === "Identifier" ? d.id.name : null;
}
