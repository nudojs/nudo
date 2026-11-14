/**
 * 循环语句发射（stmt 按域拆分之一）：for / for-in / for-of / while /
 * do-while → $for / $forOf / $whileSeq（有界展开 + pack/unpack 绑定
 * 快照 + 守卫事实剪影——loopBodyGuardsOf / narrowLoopBody 单源接线）。
 * 循环体守卫（Bug 183 / 185）、头绑定作用域形态（Bug 163 / 178）、
 * do-while 首轮入 thunk（Bug 170）等不变量总账见 ./statement.ts 头注释；
 * 主分派（transpileStatement）也在 ./statement.ts。
 */
import type {
  DoWhileStatement,
  Expression,
  ForInStatement,
  ForOfStatement,
  ForStatement,
  Node,
  Statement,
  WhileStatement,
} from "@babel/types";
import type { TranspileOptions } from "../types.ts";
import {
  nullishGuardsOf,
  nullishRemoveCallOf,
  relGuardOf,
  narrowRelArmThunk,
  type NullishGuard,
  type RelGuard,
} from "./predicates.ts";
import {
  indent,
  collectAssignedIds,
  collectLoopBodyTopLevelDeclNames,
  collectArrMutatorReceivers,
  collectPatternNames,
  stmtEmitStateOf,
  internalTmpName,
  expandAliasNames,
  filterAliasGroups,
  computeConstScope,
  copyConstScope,
} from "../helpers.ts";
import { aliasWriteNames, aliasesWithout, filterWrittenAliases } from "./fn-body.ts";
import { HOST_INTRINSIC_SET } from "../intrinsics.ts";
import { emitDestructure } from "../emit.ts";
import { emitTranspileExpression } from "../transpile-dispatch.ts";
import { extractForInitName } from "./block.ts";
import { transpileStatement, undefinedIsIntrinsicOf } from "./statement.ts";

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

/**
 * Bug 178：for 头成员表达式的**根绑定名**（`o.x` → `o`、`o.a.b` → `o`）——
 * 头赋值写回的是根绑定（成员槽经 $set 就地更新 + 根重绑），根须进循环
 * pack/unpack 写回集（否则抽象出口把成员写覆盖成旧值）。根不可重绑
 * （`this.x` / 调用结果）返回 null（不进写回集）。
 */
function memberHeadRootName(m: Node): string | null {
  let cur = m as { type?: string; object?: unknown; name?: string };
  while (cur?.type === "MemberExpression") cur = cur.object as typeof cur;
  if (cur?.type === "Identifier" && cur.name) return cur.name;
  return null;
}

/**
 * 循环 pack 源：同一次 pack 的绑定集合共享一个身份图 memo。
 *
 * memo 必须是**每次 pack 调用**新建的：循环/测试里的就地写会让同一个原始
 * Abs 的值变化，复用旧 memo 会拿回上一轮的陈旧副本。
 */
function packSrcOf(names: readonly string[], opts: TranspileOptions): string {
  const memo = internalTmpName("__packCopyMemo", opts);
  return `((${memo}) => $obj({ ${names.map((n) => `${JSON.stringify(n)}: $copy(${n}, ${memo})`).join(", ")} }))(new WeakMap())`;
}

/** 循环 unpack 源：从 pack 槽逐名读回（不复制——pack 已是本轮私有副本）。 */
function unpackSrcOf(names: readonly string[]): string {
  return `(__lp) => { ${names.map((n) => `${n} = $get(__lp, ${JSON.stringify(n)});`).join(" ")} }`;
}

/**
 * 循环体守卫事实（Bug 183 / 185）：测试为真 ⇒ 体内成立（**事实臂** cons）。
 * nullish 守卫（`v !== null`）与关系守卫（`x > 0`）同口径接线——`for` /
 * `while` 的测试在每轮迭代前求值、为真则进体，语义与 `if` 的事实臂等价。
 * 跳过规则（与既有 while 口径一致）：体侧守卫名有写（含 mutator
 * receiver）/ 体顶层同名词法声明 ⇒ 全部跳过（影子参数吞体侧写 / 重复
 * 声明 SyntaxError）；extraSkip 供 for 主路径排除循环变量（状态线程形参
 * ——影子会顶掉状态线程）。
 */
function loopBodyGuardsOf(
  test: Node | null | undefined,
  bodyLocalDecls: ReadonlySet<string>,
  bodyWrites: ReadonlySet<string>,
  extraSkip?: ReadonlySet<string>,
  undefinedIsIntrinsic = true,
): { nullish: NullishGuard[]; rel: RelGuard | undefined } {
  const skip = (name: string): boolean =>
    bodyWrites.has(name) ||
    bodyLocalDecls.has(name) ||
    (extraSkip?.has(name) ?? false);
  const nullish = nullishGuardsOf(test, undefinedIsIntrinsic).filter(
    (g) => g.arm === "cons" && !skip(g.name),
  );
  const rel = relGuardOf(test);
  return { nullish, rel: rel !== undefined && !skip(rel.name) ? rel : undefined };
}

/**
 * 循环体守卫剪影（Bug 183 / 185）：把守卫事实以**影子参数**接进循环体——
 * nullish 走 $removeNullish 通道（既有口径），关系走 $refineRel 通道
 * （事实臂；补集方向不可健全表示，见 narrowRelArmThunk）。关系剪影在
 * nullish 剪影**内侧**（同名时关系事实作用在已去 nullish 的值上）。
 */
function narrowLoopBody(
  body: string,
  guards: { nullish: NullishGuard[]; rel: RelGuard | undefined },
  depth: number,
  forkBindingNames: ReadonlySet<string> | readonly string[],
): string {
  let out = body;
  if (guards.rel) {
    out = narrowRelArmThunk(`{ ${out} }`, guards.rel, "cons", forkBindingNames);
  }
  if (guards.nullish.length > 0) {
    out = [
      `${indent(depth + 1)}((${guards.nullish.map((g) => g.name).join(", ")}) => {`,
      out,
      `${indent(depth + 1)}})(${guards.nullish.map((g) => nullishRemoveCallOf(g)).join(", ")});`,
    ].join("\n");
  }
  return out;
}

/**
 * 循环体 TranspileOptions 工厂（`for` 主/回退路径、`for-in`/`for-of`、
 * `while`、`do-while` 共用的 ~27 行样板，单一真值源）：
 *
 * - 体是**块作用域**（体 thunk 内）——体顶层词法声明在体内遮蔽外层绑定
 *   ⇒ 别名组按体顶层声明过滤（体内 fork 不得把外层别名伙伴拉进绑定集）；
 *   pack/unpack 发射在**外层**作用域 ⇒ 用未过滤的组。
 * - `bodyLocalDecls`（体顶层声明名）由**调用方分配**、此处填充——守卫
 *   跳过规则（loopBodyGuardsOf）与 pack 名集过滤都还要用它。
 * - `parentConsts` = 体所处外层 const 面，逐发射器不同：`while` /
 *   `do-while` / `for` 回退路径 = `opts.constNames`；`for` 主路径 =
 *   扣除循环变量后的面（循环变量是状态线程形参，遮蔽外层同名 const）；
 *   `for-in`/`for-of` = 循环头名单之上的面（loopConstNames）。
 *
 * 热路径约束：只是把各发射器原有的对象字面量搬进函数体——不新增任何
 * 分配（bodyLocalDecls 由调用方持有）或闭包。
 */
/** 循环头部的别名遮蔽/写名：`for (let ok of …)` 遮蔽、`for (ok of …)` 改写、test/update 写 */
function loopHeaderAliasNames(stmt: Statement): Set<string> {
  const out = new Set<string>();
  const s = stmt as {
    type?: string;
    init?: { type?: string; declarations?: Array<{ id?: unknown }> } | null;
    left?: { type?: string; declarations?: Array<{ id?: unknown }> } | null;
    test?: unknown;
    update?: unknown;
  };
  if (s.type === "ForStatement") {
    if (s.init?.type === "VariableDeclaration") {
      for (const d of s.init.declarations ?? []) collectPatternNames(d.id, out);
    }
    aliasWriteNames(s.init, out);
    aliasWriteNames(s.test, out);
    aliasWriteNames(s.update, out);
  } else if (s.type === "ForInStatement" || s.type === "ForOfStatement") {
    if (s.left?.type === "VariableDeclaration") {
      for (const d of s.left.declarations ?? []) collectPatternNames(d.id, out);
    } else {
      collectPatternNames(s.left, out);
    }
  } else if (s.type === "WhileStatement" || s.type === "DoWhileStatement") {
    aliasWriteNames(s.test, out);
  }
  return out;
}

function loopBodyOptsOf(
  body: Statement,
  opts: TranspileOptions,
  parentConsts: ReadonlySet<string> | undefined,
  bodyLocalDecls: Set<string>,
  headerAliasNames?: ReadonlySet<string> | readonly string[],
): TranspileOptions {
  collectLoopBodyTopLevelDeclNames(body, bodyLocalDecls);
  const bodyAliasGroups = filterAliasGroups(opts.aliasGroups, bodyLocalDecls);
  // NaN 守卫别名：循环头声明/写名遮蔽；体内任意写名也剔除（循环体每轮
  // 重进 ⇒ 被写的别名在后续轮次不再是原守卫值）。
  const loopAliases = opts.nanAliases
    ? filterWrittenAliases(
        aliasesWithout(opts.nanAliases, headerAliasNames ?? []),
        aliasWriteNames(body),
      )
    : undefined;
  return {
    ...opts,
    nanAliases: loopAliases,
    inLoop: (opts.inLoop ?? 0) + 1,
    loopLabel: undefined, // 标签属于本循环；体 opts 不得传给嵌套循环
    // Bug 173：循环体**不是** switch 臂——无标签 break 属于本循环
    // （switch 臂标记不得带进循环体：break 被当臂结束 → 循环跑到结束）
    inSwitchArm: false,
    // Bug 148：循环体是块作用域——其内声明的 const 不可再赋（名单自算）
    constNames: computeConstScope(
      body.type === "BlockStatement" ? body.body : [],
      parentConsts,
    ),
    ...(bodyAliasGroups ? { aliasGroups: bodyAliasGroups } : {}),
  };
}

/** for 两路径（fallback 合成计数器 / init 声明主路径）共享的**体预备块**：
 *  体顶层局部声明收集 → 体 opts（别名组按体顶层声明过滤——体内 fork 不得
 *  把外层别名伙伴拉进绑定集：伙伴名在体内指向体局部绑定）→ 体语句发射 →
 *  循环携带赋值名展开（host 内在名与体局部声明扣除）。
 *  路径差异由 constScope / extraFilter 注入：init 声明主路径先剥离被循环
 *  变量遮蔽的外层 const（loopParentConsts）并在赋值名里扣 initName；
 *  fallback 路径 const 作用域原样、无扣除。发射面与合并前逐字节一致。 */
function forBodyPrep(
  stmt: ForStatement,
  depth: number,
  opts: TranspileOptions,
  constScope: ReadonlySet<string> | undefined,
  extraFilter: (n: string) => boolean,
): {
  bodyLocalDecls: Set<string>;
  forBodyOpts: TranspileOptions;
  bodyStmts: string;
  max: number;
  names: string[];
} {
  const bodyLocalDecls = new Set<string>();
  const forBodyOpts = loopBodyOptsOf(
    stmt.body,
    opts,
    constScope,
    bodyLocalDecls,
    loopHeaderAliasNames(stmt),
  );
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
  const names = expandAliasNames(
    [...assigned].filter((n) => extraFilter(n) && !HOST_INTRINSIC_SET.has(n) && !bodyLocalDecls.has(n)),
    opts,
  );
  return { bodyLocalDecls, forBodyOpts, bodyStmts, max, names };
}

export function emitForStatement(
  stmt: ForStatement,
  depth: number,
  opts: TranspileOptions,
): string {
  const pad = indent(depth);
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
    // Bug 3 fallback：多声明符 / var 头 init 就地声明的 let/const 绑定同样
    // 遮蔽外层同名 const（如 `const s=100; for (let s=0,t2=0; s<2; s+=1)`）
    // ⇒ test / update / body 都须用**扣除这些名字后**的 const 面，否则步进
    // 里的 `s+=1` 命中 isConstAssignTarget ⇒ 误报确定 TypeError。
    const fallbackShadow = new Set<string>();
    if (stmt.init && stmt.init.type === "VariableDeclaration" && stmt.init.kind !== "var") {
      for (const d of stmt.init.declarations) collectPatternNames(d.id, fallbackShadow);
    }
    const fallbackConsts = opts.constNames
      ? copyConstScope(opts.constNames, fallbackShadow)
      : opts.constNames;
    const fallbackOpts: TranspileOptions =
      fallbackConsts === opts.constNames ? opts : { ...opts, constNames: fallbackConsts };
    const testSrc = stmt.test ? emitTranspileExpression(stmt.test, fallbackOpts) : "$lit(true)";
    // 步进表达式只取副作用（写真实绑定）；状态线程是合成计数器。
    // i++/i-- 的后置值语义会丢自增写回（步进闭包内无语句级 rebind pass），
    // 与主路径同口径：标识符 Update 强制 `name = $updateAdd/$updateSub(name)`。
    // Bug 363 配套：步进里的赋值是**循环携带**的重绑定（可变绑定在路径上
    // 取并集是合法 JS）⇒ 赋值记录的 conditional 标记必须为真，否则
    // `for (let c = this; c; c = c.parent)` 这类循环变量改写被误判成
    // 「结构可赋值」违例（real-package 零 FP 红线）。
    const updateOpts: TranspileOptions = {
      ...fallbackOpts,
      conditionalFlow: (opts.conditionalFlow ?? 0) + 1,
    };
    const stepPart = (u: Node): string => {
      const upd = u as { type?: string; operator?: string; argument?: { type?: string; name?: string }; expressions?: unknown[] };
      if (upd.type === "UpdateExpression" && upd.argument?.type === "Identifier" && upd.argument.name) {
        return `${upd.argument.name} = ${upd.operator === "++" ? "$updateAdd" : "$updateSub"}(${upd.argument.name})`;
      }
      if (upd.type === "SequenceExpression") {
        return (upd.expressions ?? []).map((e) => stepPart(e as Node)).join(", ");
      }
      return emitTranspileExpression(u as Expression, updateOpts);
    };
    const updateSrc = stmt.update ? stepPart(stmt.update as Node) : null;
    // 循环体是**块作用域**（体 thunk 内）——体顶层词法声明在体内遮蔽外层
    // 绑定 ⇒ 别名组按体顶层声明过滤（体内 fork 不得把外层别名伙伴拉进绑定
    // 集：伙伴名在体内指向的是体局部绑定 ⇒ 复制/重绑它会断开外层别名身份）。
    // pack/unpack 发射在**外层**作用域（$for 的 opts 实参）⇒ 用未过滤的组。
    // 体预备块与 init 声明主路径共享（forBodyPrep 单源；本路径无循环变量
    // 遮蔽——const 作用域原样、赋值名无扣除）。
    const { bodyLocalDecls, forBodyOpts, bodyStmts, max, names } =
      forBodyPrep(stmt, depth, opts, fallbackConsts, () => true);
    // Bug 183：for 循环体接守卫事实（nullish + 关系）——测试在每轮迭代
    // 前求值、为真则进体，语义与 `if`/`while` 的事实臂等价（此前 for
    // 分支一条都没接 ⇒ `for (; v !== null; )` 与 `while (v !== null)`
    // 结论相反）。跳过规则同 while（体侧写 / 体顶层同名声明）。
    const bodyWrites = new Set<string>();
    collectAssignedIds(stmt.body, bodyWrites);
    collectArrMutatorReceivers(stmt.body, bodyWrites);
    const loopGuards = loopBodyGuardsOf(stmt.test, bodyLocalDecls, bodyWrites, undefined, undefinedIsIntrinsicOf(opts));
    const bodyNarrowed = narrowLoopBody(bodyStmts, loopGuards, depth + 1, names);
    const packSrc = names.length === 0 ? null : packSrcOf(names, opts);
    const unpackSrc = names.length === 0 ? null : unpackSrcOf(names);
    const optsSrc = (() => {
      const extra = opts.loopLabel ? `label: ${JSON.stringify(opts.loopLabel)}` : "";
      if (!extra) return packSrc && unpackSrc
        ? `, { pack: () => ${packSrc}, unpack: ${unpackSrc} }`
        : "";
      return packSrc && unpackSrc
        ? `, { pack: () => ${packSrc}, unpack: ${unpackSrc}, ${extra} }`
        : `, { ${extra} }`;
    })();
    // Bug 1159：$for 的状态线程形参名在**用户表达式的作用域里**（测试
    // thunk / 体 thunk 都直接内联用户源码）⇒ 写死 `__n` 会遮蔽用户同名
    // 绑定（条件与体读到合成计数器而非用户绑定 ⇒ 自信错值）。实际名经
    // 分配器；无碰撞时逐字不变。
    const forState = internalTmpName("__n", opts);
    const stepSrc = updateSrc
      ? `(${forState}) => { ${updateSrc}; return $add(${forState}, $lit(1)); }`
      : `(${forState}) => $add(${forState}, $lit(1))`;
    return [
      initSrc,
      `${pad}// for (fallback: non-declaration init) → $for (bounded unroll, max=${max})`,
      `${pad}$for(`,
      `${indent(depth + 1)}$lit(0),`,
      `${indent(depth + 1)}(${forState}) => ${testSrc},`,
      `${indent(depth + 1)}${stepSrc},`,
      `${indent(depth + 1)}(${forState}) => {`,
      bodyNarrowed,
      `${indent(depth + 1)}  return ${forState};`,
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
  // Bug 3：循环变量 initName 是状态线程形参（`(initName) => {…}`），遮蔽
  // 外层同名 const。test / update 都在该 thunk 内发射 ⇒ 必须用**去影**后的
  // const 面，否则 `for (let s=0; s<3; s+=1)` 的 `s+=1` 命中
  // isConstAssignTarget ⇒ `$throwConstAssign()`（误报确定 TypeError、签名
  // 塌成 never）。原实现把 loopParentConsts 算在 testSrc/updateSrc **之后**
  //（只喂给循环体），头两段仍用未去影的 opts。
  const loopParentConsts =
    opts.constNames && opts.constNames.has(initName)
      ? copyConstScope(opts.constNames, new Set([initName]))
      : opts.constNames;
  const loopHeadOpts: TranspileOptions =
    loopParentConsts === opts.constNames ? opts : { ...opts, constNames: loopParentConsts };
  const testSrc = stmt.test ? emitTranspileExpression(stmt.test, loopHeadOpts) : "$lit(true)";
  // for 步进：**只取副作用**，状态线程恒为循环变量自身（与 fallback 路径
  // 同口径——fallback 用合成计数器 `__n`，主路径用 `initName`）。
  // - Bug 132：标识符 Update 必须走 $updateAdd/$updateSub（ToNumeric ± 1）。
  //   $add 是二元 `+`：bigint + number 走 mixed-bigint 抛 TypeError 臂、
  //   string 左操作数走字符串拼接臂（"5"++ 原生 6，拼接得 "51"）。
  // - Bug 144：步进表达式的**值**不得作状态线程——序列表达式（`i++, n++`）
  //   的值是末项值（后缀自增回旧值），会让循环变量停滞 / 超跑。
  // - Bug 363 配套：步进里的赋值是**循环携带**的重绑定 ⇒ 赋值记录的
  //   conditional 标记必须为真（否则 `for (let c = this; c; c = c.parent)`
  //   这类循环变量改写被误判成结构可赋值违例 ⇒ real-package 零 FP 红线）。
  const updateSrc =
    stmt.update && stmt.update.type === "UpdateExpression" &&
    stmt.update.argument.type === "Identifier"
      ? `${stmt.update.argument.name} = ${stmt.update.operator === "++" ? "$updateAdd" : "$updateSub"}(${stmt.update.argument.name})`
      : stmt.update
        ? emitTranspileExpression(stmt.update, {
            ...loopHeadOpts,
            conditionalFlow: (opts.conditionalFlow ?? 0) + 1,
          })
        : null;
  // 循环体是**块作用域**（体 thunk 内）——体顶层词法声明在体内遮蔽外层
  // 绑定 ⇒ 别名组按体顶层声明过滤（体内 fork 不得把外层别名伙伴拉进绑定
  // 集）。pack/unpack 发射在**外层**作用域（$for 的 opts 实参）⇒ 用未过
  // 滤的组。体预备块与 fallback 路径共享（forBodyPrep 单源；本路径注入
  // loopParentConsts——循环变量遮蔽外层 const——并在赋值名里扣 initName）。
  const { bodyLocalDecls, forBodyOpts, bodyStmts, max, names } =
    forBodyPrep(stmt, depth, opts, loopParentConsts, (n) => n !== initName);
  // Bug 183：for 循环体接守卫事实（nullish + 关系）——同 fallback 路径。
  // 循环变量本身（状态线程形参 initName）排除：影子参数会顶掉状态
  // 线程（`for (let i = 0; i < 3; i++)` 的 i 是状态线程，不得被影子
  // 参数遮蔽）。
  const bodyWrites = new Set<string>();
  collectAssignedIds(stmt.body, bodyWrites);
  collectArrMutatorReceivers(stmt.body, bodyWrites);
  const loopGuards = loopBodyGuardsOf(
    stmt.test,
    bodyLocalDecls,
    bodyWrites,
    new Set([initName]),
    undefinedIsIntrinsicOf(opts),
  );
  const bodyNarrowed = narrowLoopBody(bodyStmts, loopGuards, depth + 1, names);
  const packSrc = names.length === 0 ? null : packSrcOf(names, opts);
  const unpackSrc = names.length === 0 ? null : unpackSrcOf(names);
  // Bug 228：循环变量（状态线程形参 initName）在体里是**形参槽**——体对它的
  // 写在 continue 抛出信号时随信号丢失（$for 拿不到「体退出瞬间的值」）。
  // 原生：for (let i…) 每轮绑定独立，continue 前的 `i = 5` 写进本轮绑定
  // ⇒ 下一轮 i++ 得 6。修法：体用 try/finally 把最新值写回共享槽，
  // $for 的 continue 臂经 loopVar 回调取用（迭代次数/结果随之正确）。
  //
  // Bug 1073：槽名必须**避开用户标识符**——用户源码里声明了同名绑定
  // （`const __nudoLv0 = 1;`）时，生成的 `let __nudoLv0;` 与之**重复
  // 词法声明**（同作用域）⇒ 产物不是合法 JS ⇒ `new Function`
  // SyntaxError（Identifier has already been declared）⇒ **整模块**
  // fail-closed（导出全退化 unknown ⇒ L2 门禁假绿）。与 Bug 1058/1059
  // 同款修法（internalTmpName：撞名则加 `_k` 后缀；无碰撞时原名返回
  // ⇒ 产物逐字不变）。
  const loopVarSlot = internalTmpName(`__nudoLv${stmtEmitStateOf(opts).forLoopVarSeq++}`, opts);
  const optsSrc = (() => {
    const parts: string[] = [];
    if (packSrc && unpackSrc) parts.push(`pack: () => ${packSrc}`, `unpack: ${unpackSrc}`);
    parts.push(`loopVar: () => ${loopVarSlot}`);
    if (opts.loopLabel) parts.push(`label: ${JSON.stringify(opts.loopLabel)}`);
    return `, { ${parts.join(", ")} }`;
  })();
  // 体的 finally 捕获循环变量的最新写（continue / break 抛出信号时也跑到）
  const bodyCaptured = bodyNarrowed
    .split("\n")
    .map((l) => (l.trim() === "" ? l : `${indent(depth + 2)}${l}`))
    .join("\n");
  return [
    `${pad}let ${loopVarSlot};`,
    `${pad}// for → $for (bounded unroll, max=${max})`,
    `${pad}$for(`,
    `${indent(depth + 1)}${initExpr},`,
    `${indent(depth + 1)}(${initName}) => ${testSrc},`,
    `${indent(depth + 1)}(${initName}) => { ${updateSrc ? `${updateSrc};` : ""} return ${initName}; },`,
    `${indent(depth + 1)}(${initName}) => {`,
    `${indent(depth + 2)}try {`,
    bodyCaptured,
    `${indent(depth + 2)}  return ${initName};`,
    `${indent(depth + 2)}} finally {`,
    `${indent(depth + 3)}${loopVarSlot} = ${initName};`,
    `${indent(depth + 2)}}`,
    `${indent(depth + 1)}},`,
    `${indent(depth + 1)}${max}${optsSrc}`,
    `${pad});`,
  ].join("\n");
}

export function emitForInStatement(
  stmt: ForInStatement | ForOfStatement,
  depth: number,
  opts: TranspileOptions,
): string {
  const pad = indent(depth);
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
    // 同块多个 for-in 不得重复声明：单元发射状态袋的计数器唯一化
    // Bug 1159：接收者临时名同样避开用户标识符——`const __fir1 = (用户
    // 表达式)` 的初始化器与循环体都在该块里求值用户代码 ⇒ 写死名会撞
    // TDZ / 遮蔽；首轮编译失败后的 Bug 1139 重试虽会推高计数器「撞巧」
    // 成功，但两次尝试的序号都被用户占用时（`__fir1` … `__fir{n}`）重试
    // 仍 SyntaxError ⇒ 宿主异常冒出。实际名经分配器；无碰撞时逐字不变。
    const recvTmp = internalTmpName(`__fir${++stmtEmitStateOf(opts).forInRecvSeq}`, opts);
    recvPre = [`${pad}const ${recvTmp} = (${emitTranspileExpression(stmt.right as Expression, opts)});`];
    recvSrc = recvTmp;
  } else {
    recvSrc = emitTranspileExpression(stmt.right as Expression, opts);
  }
  const iter = isIn
    ? `$forInKeys(${recvSrc})`
    : recvSrc;
  // for (const x of xs) / for (const [a,b] of xs)
  //
  // Bug 163 / 178：头绑定的**作用域形态**分四种，头绑定不是「一律回调形参」——
  //  - let/const 头：块级、**每轮新绑定** → 回调形参（既有口径，不变）
  //  - var 头：**函数级、整个循环共享一个绑定**、循环后仍可见 → 不得
  //    降级成回调形参（此前形参遮蔽函数级槽 ⇒ 循环外恒 undefined、
  //    且每轮独立绑定 ⇒ 闭包捕获值错）；改为每轮把迭代项**写回同一
  //    函数级槽**（槽已由 collectVarHoistNames 提升到函数体/模块体顶部）
  //  - 标识符头 `for (x of …)`：**赋值**给既有绑定 → 头赋值必须发射
  //  - 成员表达式头 `for (o.x of …)`：**写回成员槽** → 头赋值必须发射
  //    （此前两形态的赋值**整条不发射** ⇒ 目标恒为旧值）
  let bindName = "_item";
  /** 头赋值语句源（写回既有绑定 / 成员槽）；null = 无头赋值 */
  let headAssignSrc: string | null = null;
  /** 头赋值写入的外层绑定名（进 pack/unpack 写回集） */
  const headAssignedNames: string[] = [];
  /** 头解构（let/const）的子名——**回调内块级绑定**，不得进 pack 名集 */
  const headLocalNames = new Set<string>();
  const headKind =
    stmt.left.type === "VariableDeclaration" ? stmt.left.kind : null;
  const headPat =
    stmt.left.type === "VariableDeclaration" ? stmt.left.declarations[0]?.id : null;
  if (stmt.left.type === "VariableDeclaration") {
    if (headPat?.type === "Identifier") {
      if (headKind === "var") {
        // var 头：函数级共享绑定 —— 头赋值写回提升槽（不新建回调形参）
        bindName = "_item";
        headAssignedNames.push(headPat.name);
      } else {
        bindName = headPat.name;
      }
    } else if (headPat?.type === "ObjectPattern" || headPat?.type === "ArrayPattern") {
      // 解构绑定：用临时 _item 再 destructure
      bindName = `_of${stmt.loc?.start.line ?? 0}`;
      const patNames = new Set<string>();
      collectPatternNames(headPat, patNames);
      if (headKind === "var") {
        // var 头解构：子名已提升到函数级槽 → destructure 走**赋值**形态
        // （kw ""），写回同一函数级槽而非块级新绑定
        for (const n of patNames) headAssignedNames.push(n);
      } else {
        // let/const 头解构：子名是**循环体回调内**的块级绑定（emitDestructure
        // 在回调里声明）——pack/unpack 闭包在回调**外**，引用它 ⇒ ReferenceError
        // （`for (let {a} of arr) { a = … }` 的抽象出口直接抛）。
        // 报告外发现：这些名字不是外层绑定（每轮独立 / const 不可再赋）⇒
        // 排除出 pack 名集（体对它们的写只改块级绑定，不外泄）。
        for (const n of patNames) headLocalNames.add(n);
      }
    }
  } else if (stmt.left.type === "Identifier") {
    // 标识符头：赋值给既有绑定（此前降级成回调形参 ⇒ 写回丢失）
    bindName = "_item";
    headAssignedNames.push(stmt.left.name);
  } else if (stmt.left.type === "MemberExpression") {
    // 成员表达式头：迭代项必须写回成员槽（此前整条不发射）
    bindName = "_item";
    const root = memberHeadRootName(stmt.left);
    if (root) headAssignedNames.push(root);
  }
  const bodyLines: string[] = [];
  // for (const x of …) 头绑定在循环体内不可再赋
  const loopConstNames = copyConstScope(opts.constNames, new Set()) ?? new Set<string>();
  if (stmt.left.type === "VariableDeclaration" && stmt.left.kind === "const") {
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
    (stmt.left.kind === "let" || stmt.left.kind === "var")
  ) {
    // let/var 头绑定遮蔽外层 const/import 名（Bug ②）：体内可再赋，
    // 不得误折 TypeError——从继承的 const 面扣除遮蔽名
    // （Bug 161：解构头的子名同样按头种类决定可变性）
    const headId = stmt.left.declarations[0]?.id;
    if (headId?.type === "Identifier") {
      loopConstNames.delete(headId.name);
    } else if (headId?.type === "ObjectPattern" || headId?.type === "ArrayPattern") {
      const patternNames = new Set<string>();
      collectPatternNames(headId, patternNames);
      for (const n of patternNames) loopConstNames.delete(n);
    }
  }
  if (
    stmt.left.type === "VariableDeclaration" &&
    stmt.left.declarations[0] &&
    (stmt.left.declarations[0].id.type === "ObjectPattern" ||
      stmt.left.declarations[0].id.type === "ArrayPattern")
  ) {
    // Bug 161：解构头的绑定种类随头（const 头不可再赋 / let·var 头可再赋）
    // Bug 163：var 头的解构子名是**函数级提升槽**（collectVarHoistNames
    // 收 for 头的 var 声明）→ destructure 走**赋值**形态（kw ""）写回
    // 同一函数级槽；子名未在提升集内时退回块级 let（不得凭空写未声明名）
    const patNames = new Set<string>();
    collectPatternNames(stmt.left.declarations[0].id, patNames);
    const hoisted = opts.hoistedVarNames;
    const varHeadAssigned =
      stmt.left.kind === "var" &&
      hoisted !== undefined &&
      [...patNames].every((n) => hoisted.has(n));
    emitDestructure(
      stmt.left.declarations[0].id as Node,
      bindName,
      varHeadAssigned
        ? ""
        : stmt.left.kind === "const"
          ? "const"
          : "let",
      indent(depth + 2),
      { ...opts, constNames: loopConstNames },
      bodyLines,
      { n: 0 },
    );
  }
  // 循环体是**块作用域**（体 thunk 内）——体顶层词法声明在体内遮蔽外层
  // 绑定 ⇒ 别名组按体顶层声明过滤（体内 fork 不得把外层别名伙伴拉进绑定
  // 集）。pack/unpack 发射在**外层**作用域 ⇒ 用未过滤的组。
  const bodyLocalDecls = new Set<string>();
  const bodyOpts = loopBodyOptsOf(
    stmt.body,
    opts,
    loopConstNames,
    bodyLocalDecls,
    loopHeaderAliasNames(stmt),
  );
  const bodyStmts =
    stmt.body.type === "BlockStatement"
      ? stmt.body.body.map((s) => transpileStatement(s, depth + 2, bodyOpts)).join("\n")
      : transpileStatement(stmt.body, depth + 2, bodyOpts);
  // Bug 163 / 178：头赋值发射（写回既有绑定 / 成员槽）——复用通用赋值
  // 通道（const 守卫 / $set·$idxSet 写回 / 根重绑），不另起一套。
  // 目标节点：var 头 / 标识符头 = 头标识符；成员头 = 头成员表达式。
  if (headAssignedNames.length > 0 || stmt.left.type === "MemberExpression") {
    const headTarget: Node | null =
      stmt.left.type === "MemberExpression"
        ? (stmt.left as unknown as Node)
        : stmt.left.type === "Identifier"
          ? ({ type: "Identifier", name: stmt.left.name } as unknown as Node)
          : stmt.left.type === "VariableDeclaration" &&
              headKind === "var" &&
              headPat?.type === "Identifier"
            ? ({ type: "Identifier", name: headPat.name } as unknown as Node)
            : null;
    if (headTarget) {
      const synth = {
        type: "AssignmentExpression",
        operator: "=",
        left: headTarget,
        right: { type: "Identifier", name: bindName },
      } as unknown as Expression;
      headAssignSrc = emitTranspileExpression(synth, bodyOpts);
    }
  }
  const max = opts.maxLoopIters ?? 8;
  // 与 while/for 同协议：体内外层绑定 pack/unpack，抽象/空迭代出口可 join
  const assigned = new Set<string>();
  collectAssignedIds(stmt.body, assigned);
  collectArrMutatorReceivers(stmt.body, assigned);
  // Bug 163 / 178：头赋值写入的外层绑定（var 头槽 / 标识符头 / 成员头根）
  // 同样进写回集——否则抽象出口把头写覆盖成旧值
  for (const n of headAssignedNames) {
    // const 绑定被头赋值 = 原生 TypeError（$throwConstAssign 通道），
    // 不得再进 pack/unpack（重绑 const 绑定是非法 JS）
    if (opts.constNames?.has(n)) continue;
    assigned.add(n);
  }
  const names = expandAliasNames(
    [...assigned].filter(
      (n) =>
        n !== bindName &&
        !HOST_INTRINSIC_SET.has(n) &&
        !bodyLocalDecls.has(n) &&
        // 报告外发现：头解构（let/const）的子名是回调内块级绑定——pack/unpack
        // 闭包在回调外，引用它 ⇒ ReferenceError（`for (let {a} of arr)` 抽象
        // 出口直接抛）。排除：它们不是外层绑定（每轮独立 / const 不可再赋）。
        !headLocalNames.has(n),
    ),
    opts,
  );
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
      : `, { pack: () => ${packSrcOf(names, opts)}, unpack: ${unpackSrcOf(names)}${tailOpts ? `, ${tailOpts}` : ""} }`;
  return [
    ...recvPre,
    // Bug 201：`for await` 的挂起门——原生每轮一个 await；引擎既有建模
    // 是同步驱动 ⇒ **整循环一个**挂起点（循环前 yield，循环体在恢复点
    // 跑）。口径偏差已登记（与引擎既有的同步 for-await 建模一致）。
    // 只有**生成器级**位置的 for await 才发门（分支臂/循环体里的是宿主
    // thunk——yield 会是语法错误）。
    ...(isForAwait &&
    typeof (stmt as { start?: number }).start === "number" &&
    opts.asyncForAwaitGates?.has(String((stmt as { start?: number }).start))
      ? [`${pad}yield $lit(void 0);`]
      : []),
    `${pad}$forOf(${iter}, (${bindName}, _i) => {`,
    // Bug 163 / 178：头赋值在**每轮进体时**写回目标（原生：每轮把
    // 迭代项赋给头目标）——放在 destructure 之前、循环体语句之前
    ...(headAssignSrc ? [`${indent(depth + 2)}${headAssignSrc};`] : []),
    ...bodyLines,
    bodyStmts,
    `${pad}}, ${max}${optsSrc});`,
  ].join("\n");
}

export function emitWhileStatement(
  stmt: WhileStatement,
  depth: number,
  opts: TranspileOptions,
): string {
  const pad = indent(depth);
  const test = emitTranspileExpression(stmt.test, opts);
  // 循环体是**块作用域**（体 thunk 内）——体顶层词法声明在体内遮蔽外层
  // 绑定 ⇒ 别名组按体顶层声明过滤（体内 fork 不得把外层别名伙伴拉进绑定
  // 集）。pack/unpack 发射在**外层**作用域 ⇒ 用未过滤的组。
  const bodyLocalDecls = new Set<string>();
  const bodyOpts = loopBodyOptsOf(
    stmt.body,
    opts,
    opts.constNames,
    bodyLocalDecls,
    loopHeaderAliasNames(stmt),
  );
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
  // Bug 185：关系守卫（`x > 0`）与 nullish 守卫**同口径**接进循环体
  // （此前 while 只接 nullish ⇒ 同一机制内部不自洽：`while (x > 0)`
  // 的体内 x 折不出 > 0 事实）。事实臂 = 测试为真 ⇒ 体内成立。
  const loopGuards = loopBodyGuardsOf(stmt.test, bodyLocalDecls, bodyWrites, undefined, undefinedIsIntrinsicOf(opts));
  const names = expandAliasNames([...assigned].filter((n) => !HOST_INTRINSIC_SET.has(n) && !bodyLocalDecls.has(n)), opts);
  const bodyNarrowed = narrowLoopBody(body, loopGuards, depth, names);
  const loopOpts = opts.loopLabel ? `label: ${JSON.stringify(opts.loopLabel)}` : "";
  if (names.length === 0) {
    return [
      `${pad}// while → $whileSeq (bounded, max=${max})`,
      `${pad}$whileSeq(() => ${test}, () => {`,
      bodyNarrowed,
      `${pad}}, ${max}${loopOpts ? `, { ${loopOpts} }` : ""});`,
    ].join("\n");
  }
  const packSrc = packSrcOf(names, opts);
  const unpackSrc = unpackSrcOf(names);
  return [
    `${pad}// while → $whileSeq (instrumented bindings: ${names.join(", ")})`,
    `${pad}$whileSeq(() => ${test}, () => {`,
    bodyNarrowed,
    `${pad}}, ${max}, { pack: () => ${packSrc}, unpack: ${unpackSrc}${loopOpts ? `, ${loopOpts}` : ""} });`,
  ].join("\n");
}

export function emitDoWhileStatement(
  stmt: DoWhileStatement,
  depth: number,
  opts: TranspileOptions,
): string {
  const pad = indent(depth);
  // do { body } while (test) ≡ body; while (test) { body }（有界、可 instrument）
  const test = emitTranspileExpression(stmt.test, opts);
  // 循环体是**块作用域**（体 thunk 内）——体顶层词法声明在体内遮蔽外层
  // 绑定 ⇒ 别名组按体顶层声明过滤（体内 fork 不得把外层别名伙伴拉进绑定
  // 集）。pack/unpack 发射在**外层**作用域 ⇒ 用未过滤的组。
  const bodyLocalDecls = new Set<string>();
  const bodyOpts = loopBodyOptsOf(
    stmt.body,
    opts,
    opts.constNames,
    bodyLocalDecls,
    loopHeaderAliasNames(stmt),
  );
  const bodyStmts =
    stmt.body.type === "BlockStatement"
      ? stmt.body.body.map((s) => transpileStatement(s, depth + 1, bodyOpts)).join("\n")
      : transpileStatement(stmt.body, depth + 1, bodyOpts);
  const max = opts.maxLoopIters ?? 8;
  const assigned = new Set<string>();
  collectAssignedIds(stmt.body, assigned);
  collectAssignedIds(stmt.test, assigned);
  collectArrMutatorReceivers(stmt.body, assigned);
  // do-while 守卫收窄（issue #118 v3）：**只**收窄内层 $whileSeq 的体
  // 拷贝（第 2 轮起先过测试，cons 臂事实成立）；首次独立拷贝先于任何
  // 测试求值执行（`do { m[0] } while ((m = f()))` 首轮 m 可能
  // nullish），保持未收窄（sound）。跳过规则与 while 同口径：体侧守卫
  // 名有写 / 体顶层同名词法声明 → 全部跳过；测试侧赋值不算。
  const bodyWrites = new Set<string>();
  collectAssignedIds(stmt.body, bodyWrites);
  collectArrMutatorReceivers(stmt.body, bodyWrites);
  const names = expandAliasNames([...assigned].filter((n) => !HOST_INTRINSIC_SET.has(n) && !bodyLocalDecls.has(n)), opts);
  // Bug 185 同构缺口：do-while 的**关系守卫**（`x > 0`）此前没接进体侧
  // （只接了 nullish 守卫）⇒ 体内 x 折不出 > 0 事实（同一机制内部不
  // 自洽：for / while 都接了）。改用 loopBodyGuardsOf + narrowLoopBody
  // （与 for / while **同口径**）：nullish 走 $removeNullish 影子参数、
  // 关系走 $refineRel 影子参数（事实臂；补集方向不可健全表示）。
  const loopGuards = loopBodyGuardsOf(stmt.test, bodyLocalDecls, bodyWrites, undefined, undefinedIsIntrinsicOf(opts));
  const innerBody = narrowLoopBody(bodyStmts, loopGuards, depth, names);
  const packSrc = names.length === 0 ? null : packSrcOf(names, opts);
  const unpackSrc = names.length === 0 ? null : unpackSrcOf(names);
  const loopOpts = opts.loopLabel ? `label: ${JSON.stringify(opts.loopLabel)}` : "";
  const optsSrc =
    packSrc && unpackSrc
      ? `, { pack: () => ${packSrc}, unpack: ${unpackSrc}${loopOpts ? `, ${loopOpts}` : ""} }`
      : loopOpts
        ? `, { ${loopOpts} }`
        : "";
  // Bug 170：体**恒在循环 thunk 内**执行。旧口径把首份体拷贝放在
  // `$whileSeq` **之外**（`body; while (T) { body }`）——此刻没有任何循环
  // 在运行，体里的 `break` / `continue` 发射的 $loopBreak() /
  // $loopContinue() 无人吸收 → 信号冒泡出函数体 → 被记成「函数抛
  // NudoLoopSignal」（L2 门禁假红 + 签名退化成 unknown）。
  // 修法：`do B while(T)` ≡ `$whileSeq(() => 首轮 ? true : T, () => {
  // 首轮 ? B₁ : B₂ })`——首轮用「首轮标记」把首份体 B₁ 移进 thunk
  // （原生 do-while 首轮**先**跑体、后求值条件 ⇒ 首轮不求值 T），
  // 此后各轮先过 T 再跑 B₂。B₁ / B₂ 两份拷贝沿用既有形态（首轮不收窄、
  // 次轮收窄——issue #118 v3：收窄事实来自 T，首轮 T 尚未求值）。
  //
  // Bug 1159：首轮标记是**块级词法绑定**，而体 thunk 里内联用户体源码
  // ⇒ 写死 `__nudoDwFirst` 会遮蔽用户同名绑定（体读到引擎布尔而非用户值）。
  // 实际名经分配器；无碰撞时逐字不变。
  const dwFirst = internalTmpName("__nudoDwFirst", opts);
  return [
    `${pad}// do-while → $whileSeq (体恒在 thunk 内，bounded, max=${max})`,
    `${pad}{`,
    `${indent(depth + 1)}let ${dwFirst} = true;`,
    `${indent(depth + 1)}$whileSeq(() => ${dwFirst} ? $lit(true) : ${test}, () => {`,
    `${indent(depth + 2)}if (${dwFirst}) {`,
    `${indent(depth + 3)}${dwFirst} = false;`,
    bodyStmts,
    `${indent(depth + 2)}} else {`,
    innerBody,
    `${indent(depth + 2)}}`,
    `${indent(depth + 1)}}, ${max}${optsSrc});`,
    `${pad}}`,
  ].join("\n");
}
