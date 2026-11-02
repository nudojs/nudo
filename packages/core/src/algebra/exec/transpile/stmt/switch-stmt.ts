/**
 * switch 语句发射（stmt 按域拆分之一）：臂合并（空 case 贯穿 / default
 * 紧跟空 case 共享体）、case 测试惰性求值（getter + 抽象路径补求值）、
 * 臂级 pack/join 快照协议、break 标签信号（Bug 147）与 case 标签窄化
 * （Bug 184）的不变量注释随 emitSwitchStatement 原样保留；总账另见
 * ./statement.ts 头注释（switchBodySeq 计数器 / 臂标签栈语义）。
 * 主分派（transpileStatement）在 ./statement.ts。
 */
import type { Expression, Node, Statement, SwitchStatement } from "@babel/types";
import type { TranspileOptions } from "../types.ts";
import {
  stmtCompletesControl,
  stmtReturns,
  switchCaseFacts,
  narrowCaseLabelArmThunk,
} from "./predicates.ts";
import {
  indent,
  collectForkBindingNames,
  stmtEmitStateOf,
  internalTmpName,
  internalTmpNameSet,
  expandAliasNames,
  filterAliasGroups,
  collectScopeShadowNames,
} from "../helpers.ts";
import {
  emitArrMutatorRebinds,
  switchTmpNames,
} from "../emit.ts";
import { emitTranspileExpression } from "../transpile-dispatch.ts";
import { transpileStatement, undefinedIsIntrinsicOf } from "./statement.ts";

export function emitSwitchStatement(
  stmt: SwitchStatement,
  depth: number,
  opts: TranspileOptions,
): string {
  const pad = indent(depth);
  const disc = emitTranspileExpression(stmt.discriminant as Expression, opts);
  // `src`：臂体在源 AST 里的**原数组引用**——`case 1: default: body` 形态下
  // default 的 consequent 与前一个 case 臂共享同一份（Bug 146：合并阶段
  // 不得再串一份 → 体被执行两次）。
  type Arm = {
    tests: string[];
    /** case 测试的源节点（Bug 184：case 标签窄化事实的字面量识别） */
    testNodes: Node[];
    stmts: Statement[];
    isDefault: boolean;
    src?: Statement[];
  };

  // 1) 空 case 测试并入下一有体臂；default 独立
  const pre: Arm[] = [];
  let pendingTests: string[] = [];
  let pendingNodes: Node[] = [];
  for (const c of stmt.cases) {
    const testSrc = c.test ? emitTranspileExpression(c.test as Expression, opts) : null;
    if (testSrc === null) {
      // Bug 146：default 紧跟空 case（`case 1: default: body`）——default
      // 的 consequent 与前一个 case 臂**共享同一份语句**：case 臂负责
      // 「命中 case 1 时落入 default 体」，default 臂负责「全不命中时也
      // 落入 default 体」。两条路径各自引用同一份体，但**合并阶段不得
      // 再串一份**（否则体在同一条臂里执行两次：返回值错、副作用翻倍）。
      if (pendingTests.length > 0 && c.consequent.length > 0) {
        pre.push({ tests: pendingTests, testNodes: pendingNodes, stmts: c.consequent, isDefault: false, src: c.consequent });
        pendingTests = [];
        pendingNodes = [];
      }
      pre.push({ tests: [], testNodes: [], stmts: c.consequent, isDefault: true, src: c.consequent });
      continue;
    }
    if (c.consequent.length === 0) {
      pendingTests.push(testSrc);
      pendingNodes.push(c.test as Node);
      continue;
    }
    pre.push({ tests: [...pendingTests, testSrc], testNodes: [...pendingNodes, c.test as Node], stmts: c.consequent, isDefault: false });
    pendingTests = [];
    pendingNodes = [];
  }
  if (pendingTests.length > 0) {
    pre.push({ tests: pendingTests, testNodes: pendingNodes, stmts: [], isDefault: false });
  }

  // 2) 非 break 贯穿：把后续臂体串进当前臂（JS 语义）
  const merged: Arm[] = pre.map((arm) => ({ ...arm, tests: [...arm.tests], stmts: [...arm.stmts] }));
  for (let i = 0; i < merged.length; i++) {
    const arm = merged[i]!;
    const body = [...arm.stmts];
    let j = i + 1;
    while (j < merged.length && !stmtCompletesControl(body[body.length - 1] as Statement)) {
      const next = merged[j]!;
      // Bug 146：下一个臂与当前臂**共享同一份源语句**（default 紧跟空
      // case）——体已在当前臂里，不得再串一份（否则执行两次）。
      if (!(next.src && next.src === arm.src)) {
        body.push(...next.stmts);
        if (stmtCompletesControl(body[body.length - 1] as Statement)) break;
      }
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

  // Bug 184：case 标签窄化事实（命中 / 排除）——按臂序，与 merged 同序
  const caseFacts = switchCaseFacts(
    stmt.discriminant,
    pre.map((a) => ({ tests: a.testNodes, isDefault: a.isDefault })),
    undefinedIsIntrinsicOf(opts),
  );

  const caseLines: string[] = [];
  const sharedBodyDecls: string[] = [];
  let defaultSrc: string | null = null;
  // 本 switch 的序号/标签栈都挂在单元发射状态袋上（跨语句/函数去重，
  // 根单元每次新建——同源 ⇒ 同产物）
  const emit = stmtEmitStateOf(opts);
  const bodyIdxBase = emit.switchBodySeq;
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
  const names = expandAliasNames(recvSet, opts);
  // 源有 default 则每臂一槽；无 default 时多一个「no-match=快照」槽
  const nArms = merged.filter((a) => !a.isDefault).length + (defaultArm ? 1 : 0) + (defaultArm ? 0 : 1);
  // Bug 147：switch 臂的 break 标签——带标签的 break 信号不被外层循环
  // 吸收（$isBreakTo 只匹配同标签），由 switch 臂入口的 catch 吸收。
  // Bug 1159：标签是**信号字符串**（`$loopBreak(标签)` / `$isBreakTo` 按
  // 字符串比对）⇒ 写死名会与用户同名标签（`__nudoSw0: { … break; }`）相撞：
  // 臂内无标签 break 的信号被用户的**标签块** catch 吸收 ⇒ 不退出 switch
  // （少执行/多执行后续语句 ⇒ 自信错值）。实际名经分配器避让用户词形；
  // 无碰撞时基名原样返回 ⇒ 产物逐字不变。
  const breakLabel = internalTmpName(`__nudoSw${emit.switchBreakSeq++}`, opts);
  // Bug 168：case 测试**惰性**求值——$switch 的 cases 实参数组在调用前
  // 全部求值（JS 实参语义）⇒ 命中第一个 case 后后续 case 测试仍会执行。
  // 修法：test 改为 getter（$switch 按序匹配时才读 c.test）⇒ 命中即停
  // （原生 CaseBlock：逐个求值 case 测试，命中即跳出求值循环）。
  const hasTests = stmt.cases.some((c) => c.test != null);
  const testSrcs: string[] = [];
  // Bug 1151-b：switch 协议内部临时名（基线快照 `__sw0_*` / 臂槽位
  // `__sw${i}_*` / 臂标志 `__cont`）**避开用户标识符**——写死名会遮蔽
  // 用户同名绑定（自信错值 ⇒ 闸门假绿）。分配器与声明点（`decls`）同源
  // ⇒ 「成对一致」。
  const sw = switchTmpNames(names, nArms, opts);
  // 快照/恢复/测试刷新各自的身份图 memo：一次操作内的别名绑定共享副本，
  // 循环引用也不会在 switch 臂里栈溢出。
  const swCopyMemo = internalTmpName("__swCopyMemo", opts);
  const swArmMemo = internalTmpName("__swArmMemo", opts);
  const swRefreshMemo = internalTmpName("__swRefreshMemo", opts);
  // Bug 1159：case 测试机制 / 共享体的**块级**内部名同样避开用户标识符
  // ——测试 thunk（`() => (用户 case 表达式)`）与臂 thunk 都在本块作用域
  // 里求值用户表达式 ⇒ 写死名 `__swT` / `__swTestRead` / `__swEval` /
  // `__swAllDone` 会**遮蔽**用户同名外层绑定（`const __swAllDone = 42`
  // 被读成引擎的 false ⇒ 自信错值）或撞 **TDZ**（`let __swTestRead` 在
  // 臂体顶层 ⇒ 臂入口的 `if (!__swTestRead)` 抛 ReferenceError）。
  // 同 `switchTmpNames` 口径（批内一次分配）；无碰撞时基名原样返回 ⇒
  // 产物逐字不变。
  const [swT, swTV, swTD, swAllDone, swTestRead, swEval, swEvalAll, swI, swJ] =
    internalTmpNameSet(
      [
        "__swT",
        "__swTV",
        "__swTD",
        "__swAllDone",
        "__swTestRead",
        "__swEval",
        "__swEvalAll",
        "__swI",
        "__swJ",
      ],
      opts,
    );
  // 本函数与 `forkArmThunkExpr` **刻意不共用**：switch 臂协议多出
  // ①抽象判别式的 case 测试补求值 prologue（`__swTestRead` / `__swEvalAll`）、
  // ②break 信号吸收（`$isBreakTo` —— if-fork 臂不吸收 break）、
  // ③多臂槽位按 `outIdx` 取、④finally 仅在存在绑定名时发射。共享面只剩
  // 快照恢复 / try-catch-finally 骨架；强行参数化会把 break 语义藏进标志位。
  const wrapArmThunk = (thunk: string, outIdx: number): string => {
    // 与 if-fork 同口径：return/throw 臂不写 continue 路径绑定
    const lines: string[] = [`() => {`];
    // 抽象判别式路径（$switch 不读 case 测试 getter）→ 臂入口补求值全部
    // case 测试（原生：case 测试按序求值到命中为止；抽象路径判不出命中
    // ⇒ 全部求值 = 上界）
    if (hasTests) lines.push(`${indent(depth + 1)}if (!${swTestRead}) ${swEvalAll}();`);
    if (names.length > 0) {
      lines.push(`${indent(depth + 1)}const ${swArmMemo} = new WeakMap();`);
      lines.push(...names.map((n, i) => `${indent(depth + 1)}${n} = $copy(${sw.snap[i]}, ${swArmMemo});`));
      lines.push(`${indent(depth + 1)}let ${sw.cont} = true;`);
    }
    lines.push(`${indent(depth + 1)}try {`);
    lines.push(`${indent(depth + 2)}return (${thunk})();`);
    lines.push(`${indent(depth + 1)}} catch (e) {`);
    // Bug 147：switch 臂的 break 信号 → 臂结束（switch 随之结束）
    lines.push(`${indent(depth + 2)}if ($isBreakTo(e, ${JSON.stringify(breakLabel)})) {`);
    lines.push(`${indent(depth + 3)}/* switch 臂 break：臂结束 */`);
    lines.push(`${indent(depth + 2)}} else {`);
    if (names.length > 0) lines.push(`${indent(depth + 3)}if ($isForkExit(e)) ${sw.cont} = false;`);
    lines.push(`${indent(depth + 3)}throw e;`);
    lines.push(`${indent(depth + 2)}}`);
    lines.push(`${indent(depth + 1)}}`);
    if (names.length > 0) {
      lines.push(`${indent(depth + 1)}finally {`);
      lines.push(`${indent(depth + 2)}if (${sw.cont}) {`);
      lines.push(...names.map((n, i) => `${indent(depth + 3)}${sw.arm[outIdx]![i]} = ${n};`));
      lines.push(...names.map((_n, i) => `${indent(depth + 3)}${sw.armSet[outIdx]![i]} = true;`));
      lines.push(`${indent(depth + 2)}}`);
      lines.push(`${indent(depth + 1)}}`);
    }
    lines.push(`}`);
    return lines.join("\n");
  };
  let armSeq = 0;
  // Bug 147：臂体发射期间本 switch 的 break 标签生效（嵌套 switch 各自一份；
  // 栈式保存/恢复挂单元发射状态袋）
  const prevBreakLabel = emit.curSwitchBreakLabel;
  emit.curSwitchBreakLabel = breakLabel;
  try {
    for (let armIdx = 0; armIdx < merged.length; armIdx++) {
      const arm = merged[armIdx]!;
      // 臂体是**块作用域**（臂 thunk 内）——臂内词法声明在臂内遮蔽外层绑定
      // ⇒ 别名组按臂内声明过滤（臂内 fork 不得把外层别名伙伴拉进绑定集：
      // 伙伴名在臂内指向臂局部绑定 ⇒ 复制/重绑它会断开外层别名身份）。
      // switch 自身的 pack/join 发射在**外层**作用域 ⇒ 用未过滤的组。
      const armAliasGroups = filterAliasGroups(
        armOpts.aliasGroups,
        collectScopeShadowNames(arm.stmts),
      );
      const armBodyOpts: TranspileOptions = armAliasGroups
        ? { ...armOpts, aliasGroups: armAliasGroups }
        : armOpts;
      const body =
        arm.stmts.length === 0
          ? ""
          : arm.stmts.map((s) => transpileStatement(s, depth + 2, armBodyOpts)).join("\n");
      // Bug 184：case 标签窄化——命中 / 排除事实影子重绑进臂体
      const rawThunk = narrowCaseLabelArmThunk(
        `() => {\n${body}\n${indent(depth + 1)}}`,
        caseFacts[armIdx],
        names,
      );
      const thunk = wrapArmThunk(rawThunk, armSeq);
      armSeq++;
      const shared = arm.tests.length > 1 && !arm.isDefault;
      const runRef = shared
        ? internalTmpName(`__swBody${bodyIdxBase + bodyIdx++}`, opts)
        : thunk;
      if (shared) {
        sharedBodyDecls.push(`${pad}const ${runRef} = ${thunk};`);
      }
      if (arm.isDefault) {
        defaultSrc = thunk;
      } else {
        for (const t of arm.tests) {
          const testIdx = testSrcs.length;
          testSrcs.push(t);
          // Bug 168：test 为 getter——$switch 按序匹配时才求值（命中即停）
          caseLines.push(
            `{ get test() { ${swTestRead} = true; return ${swEval}(${testIdx}); }, run: ${runRef} },`,
          );
        }
      }
    }
  } finally {
    emit.curSwitchBreakLabel = prevBreakLabel;
  }
  // 无 default：合成 no-match 臂，把快照写入 join 槽（抽象 disc 时参与 join）
  if (!defaultArm && names.length > 0) {
    defaultSrc = wrapArmThunk(`() => {\n${indent(depth + 2)}return $lit(void 0);\n${indent(depth + 1)}}`, armSeq);
  }
  emit.switchBodySeq += Math.max(bodyIdx, 1);
  const dflt = defaultSrc ? `, ${defaultSrc}` : "";
  const discRebinds = emitArrMutatorRebinds(stmt.discriminant as Node, opts, pad);
  const switchCall = (discRef: string): string =>
    `$switch(${discRef}, [\n${caseLines.map((l) => indent(depth + 1) + l).join("\n")}\n${indent(depth + 1)}]${dflt})`;
  // Bug 168/169：case 测试的惰性求值机制（test thunk + 缓存 + 抽象路径
  // 补求值）+ 基线刷新（case 测试求值后刷新快照槽 ⇒ 臂入口恢复的是
  // 「测试之后」的状态 ⇒ 测试里的写不被抹掉）。名称经 Bug 1159 分配器。
  const testHelpers: string[] = [];
  if (testSrcs.length > 0) {
    const refresh = names.map((n, i) => `${indent(depth + 2)}${sw.snap[i]} = $copy(${n}, ${swRefreshMemo});`);
    testHelpers.push(
      `${pad}const ${swT} = [${testSrcs.map((t) => `() => (${t})`).join(", ")}];`,
      `${pad}const ${swTV} = [];`,
      `${pad}const ${swTD} = [];`,
      `${pad}let ${swAllDone} = false;`,
      `${pad}let ${swTestRead} = false;`,
      // 形参 / 循环变量同样经分配器——不得与用户绑定同名（用户 case
      // 表达式在该块作用域里求值 ⇒ `__swI` 之类若写死会遮蔽用户绑定）
      `${pad}const ${swEval} = (${swI}) => {`,
      `${indent(depth + 1)}if (!${swTD}[${swI}]) {`,
      `${indent(depth + 2)}${swTD}[${swI}] = true;`,
      `${indent(depth + 2)}${swTV}[${swI}] = ${swT}[${swI}]();`,
      `${indent(depth + 2)}const ${swRefreshMemo} = new WeakMap();`,
      ...refresh,
      `${indent(depth + 1)}}`,
      `${indent(depth + 1)}return ${swTV}[${swI}];`,
      `${pad}};`,
      `${pad}const ${swEvalAll} = () => {`,
      `${indent(depth + 1)}if (${swAllDone}) return;`,
      `${indent(depth + 1)}${swAllDone} = true;`,
      `${indent(depth + 1)}for (let ${swJ} = 0; ${swJ} < ${swT}.length; ${swJ}++) ${swEval}(${swJ});`,
      `${pad}};`,
    );
  }
  if (names.length === 0) {
    const lines = [
      ...discRebinds,
      ...testHelpers,
      ...sharedBodyDecls,
      allReturn
        ? `${pad}return ${switchCall(disc)};`
        : `${pad}${switchCall(disc)};`,
    ];
    // 测试机制带块级绑定（__swT / __swTV / …）→ switch 包块（同名不撞）
    if (testHelpers.length === 0) return lines.join("\n");
    return [`${pad}{`, ...lines, `${pad}}`].join("\n");
  }
  // 槽位数 ≡ nArms（恒等式：slotCount = max(nArms, armSeq + (defaultArm ? 0 : 1))
  // 且 armSeq ≡ merged.length ⇒ 两支下都等于 nArms）⇒ 分配器按 nArms 分配
  // 即可覆盖全部槽位（`sw.arm` / `sw.armSet` 的长度 = nArms）。
  const slotCount = Math.max(nArms, armSeq + (defaultArm ? 0 : 1));
  const decls = [
    `${pad}const ${swCopyMemo} = new WeakMap();`,
    ...names.flatMap((n, ni) => [
      // 基线可被 case 测试求值刷新（Bug 169）——故 let 而非 const
      `${pad}let ${sw.snap[ni]} = $copy(${n}, ${swCopyMemo});`,
      ...Array.from({ length: slotCount }, (_, i) =>
        `${pad}let ${sw.arm[i]![ni]}; let ${sw.armSet[i]![ni]} = false;`,
      ),
    ]),
  ];
  const joins = names.map((n, ni) => {
    const slots = Array.from(
      { length: slotCount },
      (_, i) => `(${sw.armSet[i]![ni]} ? ${sw.arm[i]![ni]} : null)`,
    );
    return `${pad}${n} = (() => { const ${sw.joinArr} = [${slots.join(",")}].filter((x) => x !== null); return ${sw.joinArr}.length === 0 ? ${n} : ${sw.joinArr}.reduce((a, b) => $join(a, b)); })();`;
  });
  // shared body 必须在声明 __sw0_* 的同一块内，否则闭包解析不到槽位绑定
  //
  // Bug 135：__sw0_* 是**臂的基线**——基线必须取自**判别式求值之后**。
  // 此前判别式是 $switch(...) 的第一实参（后求值），而快照行排在它之前
  // ——判别式里的副作用（f() 计数 / 赋值 / 自增）在臂入口被整体回滚。
  // 修法：判别式先落 __swD（连同其自身写回），再取快照，$switch 用 __swD。
  return [
    `${pad}{`,
    `${pad}const ${sw.disc} = (${disc});`,
    ...discRebinds,
    ...decls.map((l) => l.replace(new RegExp(`^${pad}`), `${pad}`)),
    ...testHelpers,
    ...sharedBodyDecls.map((l) =>
      l.startsWith(pad) ? `${pad}${l.slice(pad.length)}` : `${pad}${l}`,
    ),
    `${pad}const ${sw.result} = ${switchCall(sw.disc)};`,
    ...joins,
    allReturn ? `${pad}return ${sw.result};` : null,
    `${pad}}`,
  ]
    .filter((l): l is string => l !== null)
    .join("\n");
}

