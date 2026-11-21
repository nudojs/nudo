/**
 * export — 契约面 / 观测面：从契约或 case 证据算出**统一的参数面与返回面**。
 *
 * 契约面（手写契约：sidecar `*.nudo.js` ∪ inline `@nudo:contract`）与观测面
 * （`@nudo:case` 见证 / 调用点证据）**按形参合流**，不是二选一：
 * - 契约覆盖的形参位 ⇒ 契约 Abs（权威：用户申报的调用域）；
 * - 契约未覆盖的形参位 ⇒ 声明形参表 + 观测证据（**不丢位**）。
 *
 * 槽位表以**声明形参表**为骨架（形参名 / 槽位数 / 剩余参数 / 默认值 / 解构形参），
 * 契约与观测证据填值 ⇒ 槽名不靠 `argN` 凭空造、槽数不靠观测实参个数
 * （Bug 604 / 605）。
 *
 * 本模块只做**面计算**（不写盘、不上屏）；产物面（zod / standard / guard / dts）
 * 由各面模块消费本模块的产物。
 */
import {
  abs as makeAbs,
  constraintToEntryAbs,
  formatConstraint,
  joinAbs,
  locateContractParam,
  withProvenance,
  obj,
  type Abs,
  type EffectiveContract,
  type FormalParam,
  type NudoConstraint,
} from "@nudojs/core";
import { absTypeForTsTypeText, wrapPromise } from "@nudojs/core/internal";
import { domainEvidenceCases, widenObservedLiterals } from "@nudojs/service/emit";
import { tryEvalCall, type CaseResult, type FunctionAnalysis } from "@nudojs/service";
import { evidencePathOf } from "./selection.ts";

/** 统一参数面的一条：槽位键 + entry Abs + 可选性 + 结构标记。 */
export type ParamFace = {
  /**
   * 槽位键：zod 面对象槽键 / standard 面导出名后缀（`<fn>_<name>`）。
   *
   * 键取**声明形参名**（剩余参数取裸名 `rest`，不带 `...`；解构形参无契约覆盖
   * 时取求值占位 `_p0`）。点路径契约（`"card.grade"`）取路径**首段**（`card`）——
   * 槽位键是对象属性名，点路径不是一个属性名（Bug 620）。
   */
  name: string;
  /** 槽位 Abs（entry Abs） */
  abs: Abs;
  /**
   * 顶层形参可选性——**三来源口径，与 dts 面逐位同**：
   * 1. 契约覆盖该位 ⇒ 契约级 `isOptional`（契约是用户申报的调用域，权威）；
   * 2. 契约未覆盖 ⇒ 声明级默认值（`formals` 里 `kind === "default"`）；
   * 3. 再退 ⇒ 观测级（该位在最简观测调用里缺席）。
   *
   * 1 与 2 **取并**（BUG-108）：契约没写 `optional` 不等于否决实现签名里的
   * 默认值——声明级默认值是 JS 语义的「可省略」，standard 面一直这么算。
   *
   * 剩余参数位在**对象槽面**上恒可选（BUG-109）：槽缺省 = 空 rest 数组 =
   * 零实参调用。dts 面走独立路径（`...rest: T[]`，TS 的剩余参数不能带 `?`），
   * 两者语义一致（`g()` 合法）。解构位恒不可选（TS：绑定模式参数不能带 `?`）。
   */
  optional?: boolean;
  /** 剩余参数位（槽值是**数组**：rest 之后的实参合成） */
  isRest?: boolean;
  /**
   * ABS-03：契约原文（可读注记；sidecar 表达式原文 / 指令约束名，
   * 缺省 = pred 全展）。只进 dts 的 `Contract:` JSDoc 行，不参与类型投影。
   */
  display?: string;
  /** 契约键的点路径展开（`"card.grade"` ⇒ `["card","grade"]`） */
  fieldPath?: string[];
};

/**
 * 导出面上下文：契约域**种子重算**（Bug 612）与**违约复核**（Bug 626）需要源码
 * 与绝对路径（求值器按路径解析相对 import）。
 */
export type FaceContext = {
  /** 源码文本 */
  source: string;
  /** 绝对路径（求值器的 fromFile） */
  filePath: string;
  /** `@nudo:mock` 种子（与调度器同口径） */
  mocks?: Record<string, Abs>;
};

/**
 * 契约参数面：`eff.params` → entry Abs（无 eff / 无参数契约 = 空表）。
 *
 * 与 {@link unifiedParamFace} 的差别：这里**只**取契约面（不回落域证据）——
 * dts 面要的是「契约声明了什么」，不是「证据能推出什么」。
 */
export function contractParamFace(eff: EffectiveContract | undefined): ParamFace[] {
  if (!eff) return [];
  // ABS-01：跨槽 binder 表（ref 可跨形参 / 返回槽引用 bind）
  const binders = eff.binders ? new Map(Object.entries(eff.binders)) : undefined;
  return eff.params.map((p) => ({
    name: p.param,
    abs: constraintToEntryAbs(p.constraint, p.param, undefined, binders),
    optional: p.constraint.isOptional === true,
    display: p.display ?? formatConstraint(p.constraint),
  }));
}

/**
 * 契约返回面：`eff.returns` → entry Abs（无契约返回 = undefined）。
 *
 * 与 {@link unifiedReturnFace} 的差别：这里**只**取契约面（不回落观测证据），
 * 且**不做**违约复核与 promise 保形——复核后的口径见
 * {@link effectiveContractReturnFace}。
 */
export function contractReturnFace(eff: EffectiveContract | undefined): Abs | undefined {
  if (!eff?.returns) return undefined;
  const binders = eff.binders ? new Map(Object.entries(eff.binders)) : undefined;
  return constraintToEntryAbs(eff.returns.constraint, "return", undefined, binders);
}

/** 无约束 entry Abs（any）—— 无契约、无观测证据的槽位占位。 */
function anyEntryAbs(): Abs {
  return makeAbs({ k: "any" }, undefined, undefined, "path");
}

/** 声明形参表（`fn.formals` 缺省时按 `fn.paramNames` 退化）。 */
function formalList(fn: FunctionAnalysis): FormalParam[] {
  if (fn.formals && fn.formals.length > 0) return fn.formals;
  return fn.paramNames.map((n, index) =>
    n.startsWith("...")
      ? { kind: "rest", name: n.slice(3), display: n, index }
      : { kind: "id", name: n, index },
  );
}

/** 观测面同槽证据：域证据 case 的 argAbs join（无证据 = undefined）。 */
function observedSlotAbs(cases: readonly CaseResult[], index: number): Abs | undefined {
  const parts = cases
    .map((c) => {
      const a = c.argAbs[index];
      if (!a) return undefined;
      return isObservationCase(c) ? widenObservedLiterals(a) : a;
    })
    .filter((a): a is Abs => !!a);
  if (parts.length === 0) return undefined;
  return parts.reduce((a, b) => joinAbs(a, b));
}

/**
 * 该 case 是**观测**（call@ / entry@ / 无断言指令见证）还是**域声明**
 * （带 `=> expected` 的 `@nudo:case`）。
 *
 * 观测是「一次采样的快照」，发布成输入 / 输出域必须拓宽到基类型（否则
 * 单点观测让校验器拒收函数自己的合法输入与输出）；带断言指令是用户申报
 * 的域，保持精确（BUG-213 / BUG-511）。
 */
function isObservationCase(c: CaseResult): boolean {
  return !(c.source === "directive" && c.expected !== undefined);
}

/** 全部 case 都是观测（没有断言指令）⇒ 观测返回 Abs 可按域拓宽。 */
function observationOnlyCases(cases: readonly CaseResult[]): boolean {
  return cases.length > 0 && cases.every(isObservationCase);
}

/**
 * 入口见证（`entry@`）？—— 它是引擎的**兜底求值**，剩余参数位编码成
 * **一个数组实参**（`restEntryArgAbs`），不是「每个实参一个槽」。
 */
function isEntryWitness(c: CaseResult): boolean {
  return c.name.startsWith("entry@");
}

/**
 * 剩余参数位的观测证据：rest 实参合成**数组** Abs（元素 join）。
 *
 * 剩余参数在调用面是**一个数组**（不是一个标量实参）⇒ 槽值是数组 Abs，
 * 不是「rest 位之后每个实参一个槽」（Bug 604）。
 *
 * 两种见证的 `argAbs` 编码**不同**（BUG-026 / BUG-279）：
 * - **入口见证**（`entry@`）：剩余参数是**一个数组实参**（`entry@L1 (any[])`）
 *   ⇒ 它的**元素**才是 rest 实参，直接取该数组，**不得**再包一层（否则
 *   产物槽成 `array(array(unknown))` ⇒ 导出的入参 schema 拒绝该函数自己的
 *   合法调用）；
 * - **调用点 / 指令见证**（`call@` / `@nudo:case`）：每个剩余实参**各占一槽**
 *   ⇒ 逐槽取实参再合成数组。
 */
function observedRestAbs(cases: readonly CaseResult[], restIndex: number): Abs | undefined {
  const elements: Abs[] = [];
  /** 入口见证数组自身的 conf（只有兜底见证时保留它的确信度） */
  let restConf: Abs["conf"] | undefined;
  for (const c of cases) {
    const first = c.argAbs[restIndex];
    if (!first) continue;
    const observed = isObservationCase(c);
    if (isEntryWitness(c) && first.shape.k === "arr") {
      const el = first.shape.element;
      elements.push(observed ? widenObservedLiterals(el) : el);
      restConf ??= first.conf;
      continue;
    }
    for (let i = restIndex; i < c.argAbs.length; i++) {
      const a = c.argAbs[i];
      if (a) elements.push(observed ? widenObservedLiterals(a) : a);
    }
  }
  if (elements.length === 0) return undefined;
  const element = elements.reduce((a, b) => joinAbs(a, b));
  return makeAbs({ k: "arr", element }, undefined, undefined, restConf ?? element.conf);
}

/** 观测面最短调用元数（可选性第三来源；无 case = 0，与 dts 面同口径）。 */
function observedMinArity(cases: readonly CaseResult[]): number {
  return cases.length > 0 ? Math.min(...cases.map((c) => c.argAbs.length)) : 0;
}

/** 槽位树：点路径契约的叶子按路径挂树，最后一次性物化成嵌套 obj（Bug 620）。 */
type SlotTree = { leaf?: Abs; children: Map<string, SlotTree> };

/** 开放对象：未列出的键读 `unknown`（不是 exact `undefined`）。 */
function openObj(slots: Record<string, { value: Abs }>): Abs {
  return makeAbs({ k: "obj", slots, open: true }, undefined, undefined, "exact");
}

/**
 * 槽位树 → Abs（叶子 = 约束 Abs；子树 = 嵌套 obj）。
 *
 * `open` 只给**契约域种子**用：种子对象只列契约申报的字段，解构形参里
 * **没申报**的绑定（`{ grade, extra }` 的 `extra`）在闭合对象上读成 exact
 * `undefined` ⇒ 返回值 / 产物凭空多出一个 `extra: undefined` 槽（`z.undefined()`
 * / dts `extra: undefined`），而实现允许任意值。开放对象让未列键读 `unknown`
 * ⇒ 不伪造精确值（解构 `{ a, b }` 里契约申报的 `a` 仍精确）。
 */
function treeAbs(tree: SlotTree, open = false): Abs {
  if (tree.children.size === 0) return tree.leaf ?? anyEntryAbs();
  const slots = Object.create(null) as Record<string, { value: Abs }>;
  for (const [key, child] of tree.children) slots[key] = { value: treeAbs(child, open) };
  return open ? openObj(slots) : obj(slots);
}

/** 把叶子 Abs 挂到路径上（路径首段是槽位键，不进树）。 */
function insertPath(tree: SlotTree, path: readonly string[], leaf: Abs): void {
  let node = tree;
  for (let i = 1; i < path.length; i++) {
    const seg = path[i]!;
    let next = node.children.get(seg);
    if (!next) {
      next = { children: new Map() };
      node.children.set(seg, next);
    }
    node = next;
  }
  node.leaf = leaf;
}

/**
 * 统一参数面：契约面与观测面**按形参合流**。
 *
 * 槽位表以**声明形参表**为骨架：
 * - 契约覆盖的位 ⇒ 契约 Abs（+ 契约级可选性）；
 * - 契约未覆盖的位 ⇒ 观测证据（无证据 = `any`）——**不丢位**（Bug 605）；
 * - 剩余参数位 ⇒ 槽名取裸名、槽值是**数组**、槽数取声明形参表（Bug 604）；
 * - 解构形参的点路径契约 ⇒ 槽位键取路径首段、槽值是**嵌套 obj**（Bug 620）。
 *
 * 可选性三来源与 dts 面逐位同（契约级 → 声明级默认值 → 观测级最短元数）。
 */
export function unifiedParamFace(
  fn: FunctionAnalysis,
  eff: EffectiveContract | undefined,
  caseResults: readonly CaseResult[],
): ParamFace[] {
  const contractParams = contractParamFace(eff);
  const domainCases = domainEvidenceCases(caseResults);
  const formals = formalList(fn);
  const minArity = observedMinArity(caseResults);
  /** 契约参数 → 形参定位（index / 字段 / 点路径） */
  const located = contractParams.map((p) => ({ p, loc: locateContractParam(formals, p.name) }));
  const used = new Set<number>();
  const out: ParamFace[] = [];

  for (const formal of formals) {
    // 解构形参：契约可能按整个实参（占位 / `_`）或按字段（顶层绑定名 / 点路径）声明
    if (formal.kind === "pattern") {
      const wholeIdx = located.findIndex(
        (l, i) => !used.has(i) && l.loc?.index === formal.index && l.loc.field === undefined,
      );
      const fieldHits = located
        .map((l, i) => ({ l, i }))
        .filter(({ l, i }) => !used.has(i) && l.loc?.index === formal.index && l.loc.field !== undefined);
      if (wholeIdx >= 0) {
        used.add(wholeIdx);
        const { p, loc } = located[wholeIdx]!;
        out.push({
          name: p.name,
          abs: p.abs,
          optional: p.optional === true,
          ...(loc?.fieldPath ? { fieldPath: loc.fieldPath } : {}),
        });
      }
      if (fieldHits.length > 0) {
        // 同一首段的多个点路径契约合并成一个嵌套槽
        const trees = new Map<string, SlotTree>();
        const optionals = new Map<string, boolean>();
        const paths = new Map<string, string[]>();
        for (const { l, i } of fieldHits) {
          used.add(i);
          const path = l.loc?.fieldPath ?? [l.p.name];
          const key = path[0]!;
          const tree = trees.get(key) ?? { children: new Map() };
          insertPath(tree, path, l.p.abs);
          trees.set(key, tree);
          optionals.set(key, (optionals.get(key) ?? false) || l.p.optional === true);
          paths.set(key, path);
        }
        if (formal.patternKind === "array") {
          // 数组解构：绑定名是**下标**（不是属性键）⇒ 逐键槽交给产物面合成
          // **元组槽**（export.ts 的 `arrayPatternTupleFace`，Bug 394）。
          for (const [key, tree] of trees) {
            out.push({
              name: key,
              abs: treeAbs(tree),
              optional: optionals.get(key) === true,
              ...(paths.get(key) ? { fieldPath: paths.get(key) } : {}),
            });
          }
        } else {
          // 对象解构（BUG-030）：顶层键取**解构出来的字段名**，与 `.d.ts` 明文
          // 声明的调用形态同形（`f({ card })` ⇒ `{ card: … }`）。
          //
          // BUG-120 曾把整段收进一个键、槽名取 `FormalParam.placeholder`，理由
          // 是「顶层键 ≡ 形参名」；但解构形参**没有**公共名，`_p0` / `_p0_1` 是
          // 求值占位（tmp-names.ts）⇒ 发布的校验器对唯一合法调用报
          // `required@_p0`，对一个永不出现的 `{_p0: …}` 放行（BUG-030）。
          // 公共面不得出现占位名（`PublicName` 的构造子会直接 throw）。
          for (const [key, tree] of trees) {
            out.push({
              name: key,
              abs: treeAbs(tree),
              optional: optionals.get(key) === true,
              ...(paths.get(key) ? { fieldPath: paths.get(key) } : {}),
            });
          }
        }
      }
      if (wholeIdx < 0 && fieldHits.length === 0) {
        // 无契约覆盖 ⇒ 观测面（整个实参对象）
        out.push({
          name: formal.placeholder,
          abs: observedSlotAbs(domainCases, formal.index) ?? anyEntryAbs(),
          optional: false,
        });
      }
      continue;
    }
    // 标识 / 默认 / 剩余参数位
    const hitIdx = located.findIndex(
      (l, i) => !used.has(i) && l.loc?.index === formal.index && l.loc.field === undefined,
    );
    if (hitIdx >= 0) {
      used.add(hitIdx);
      const { p } = located[hitIdx]!;
      if (formal.kind === "rest") {
        // 契约描述的是**元素**类型（dts 面同口径：`...rest: T[]`）——但契约
        // 本身已是数组（`array(number())`）时不得再包一层（BUG-101：否则
        // `{ nums: [[1],[2]] }` 放行、合法 `{ nums: [1,2,3] }` 被拒，与 dts
        // 的 restParamType 口径相反）。
        out.push({
          name: formal.name,
          abs:
            p.abs.shape.k === "arr"
              ? p.abs
              : makeAbs({ k: "arr", element: p.abs }, undefined, undefined, p.abs.conf),
          // BUG-109：对象槽面上「`rest` 键缺省」= 空 rest 数组 = 零实参调用
          // （`g()` 是合法调用）⇒ 该槽可选；渲染成**必填**槽会让函数的每一次
          // 合法调用都被入参 schema 拒绝。
          optional: true,
          isRest: true,
        });
        continue;
      }
      // BUG-108 / BUG-086：契约级 ∪ 声明级（默认形参 / TS `?`）——与
      // standard 面同口径；只取契约级会让 zod 面把带默认值或 TS 可选位的
      // 形参印成必填（发布校验器拒绝源码合法载荷）。
      out.push({
        name: formal.name,
        abs: p.abs,
        optional: p.optional === true || formal.kind === "default" || formal.optional === true,
      });
      continue;
    }
    if (formal.kind === "rest") {
      out.push({
        name: formal.name,
        abs: observedRestAbs(domainCases, formal.index) ?? anyEntryAbs(),
        // BUG-109：同上——rest 槽在对象槽面上恒可选（缺省 = 空数组）。
        optional: true,
        isRest: true,
      });
      continue;
    }
    out.push({
      name: formal.name,
      abs: observedSlotAbs(domainCases, formal.index) ?? anyEntryAbs(),
      // BUG-169：TS 可选形参 `b?: T` 与 JS 默认值同待遇（`FormalParam.optional`
      // 是唯一事实源：dts 的 `?` / standard 的可选槽 / 本处 zod 槽同源）。
      // 未带 `?` 的声明仍按观测到的最少实参元数放宽。
      optional: formal.optional === true || formal.kind === "default" || formal.index >= minArity,
    });
  }
  // 契约名与声明形参表**对不上**的契约参数位：按契约原样保留（不静默丢位；
  // 不匹配本身由 export 的诊断面上屏 —— Bug 607）。
  located.forEach((l, i) => {
    if (used.has(i)) return;
    out.push({ name: l.p.name, abs: l.p.abs, optional: l.p.optional === true });
  });
  return out;
}

/**
 * 统一返回面：契约返回面优先；缺契约返回时回落**契约域种子重算**，再退观测面。
 *
 * - Bug 612：有参数契约、无返回契约时，回退**不能**直接取 `fn.combinedAbs`
 *   （那是**无约束**入口观测 ⇒ 返回位毫无信息）⇒ 先用契约参数做种子重算
 *   （与 dts 面 / check 面同一条路径），重算失败才回落观测面。
 * - Bug 618：观测返回是 `promise<…>` 时，契约返回描述的是 **await 后**的值 ⇒
 *   返回面保留 `promise<…>` 包装。
 * - Bug 619：观测面兜底**join 全部见证**（与参数面同口径），不是只取第 0 条。
 * - Bug 626：契约返回**投影前复核实现**——实现不满足契约时不投影契约，
 *   回落实现实际的返回形态（契约不是已证成的事实）。
 */
export function unifiedReturnFace(
  fn: FunctionAnalysis,
  eff: EffectiveContract | undefined,
  caseResults: readonly CaseResult[],
  ctx?: FaceContext,
): Abs | undefined {
  const observed = observedReturnFace(fn, caseResults);
  // BUG-261：声明返回里的字面量成员是声明面事实。优先用声明文本直接映射，
  // 避免观测侧早已拓宽成 string 后再也拿不回 `"a" | "b"`。
  if (declaredLiteralReturn(fn)) {
    const declared = absTypeForTsTypeText(fn.declaredReturnType);
    if (declared) {
      const marked = withProvenance(declared, "declared");
      return isPromiseAbs(observed) ? wrapPromise(marked) : marked;
    }
  }
  // BUG-213：纯观测返回面（call@/entry@ 采样）不是函数域 ⇒ 发布前拓宽到
  // 基类型。带断言的 @nudo:case 是域声明，保持精确。
  //
  // BUG-261：**声明注解**里的字面量类型也是声明面事实（`function f(): "abc"`），
  // 不是一次观测采样 ⇒ 不得随观测路径拓宽（否则 zod / standard 把返回域发布成
  // `string`，消费方 `const x: "abc" = f()` 反而被放行成任意字符串）。
  const observedDomain =
    observed !== undefined &&
    observationOnlyCases(caseResults) &&
    !declaredLiteralReturn(fn)
      ? widenObservedLiterals(observed)
      : observed;
  const contractReturn = contractReturnFace(eff);
  // 证据路径选择：契约返回面存在 ⇒ 走契约面（否则走观测面）
  if (evidencePathOf(contractReturn !== undefined) === "contract" && contractReturn !== undefined) {
    // 违约复核：实现不满足契约 ⇒ 不投影契约（回落实现实际返回）
    if (contractViolated(fn, eff, observed, ctx)) return observedDomain;
    // promise 保形：契约描述的是 await 后的值
    if (isPromiseAbs(observed)) return wrapPromise(contractReturn);
    return contractReturn;
  }
  // 无返回契约：优先契约域种子重算（否则返回位落无约束入口观测，Bug 612）
  if (eff && eff.params.length > 0) {
    const seeded = seedDomainReturn(fn, eff, ctx);
    if (seeded !== undefined) return seeded;
  }
  return observedDomain;
}

/**
 * BUG-261：声明返回注解里是否含**字面量类型**成员。
 *
 * 只认字符串 / 数字 / bigint / 布尔字面量（与 `ts-type-shape` 的
 * `literalAbsOf` 同集合）；`"abc" | string` 也算声明面含字面量。
 */
function declaredLiteralReturn(fn: FunctionAnalysis): boolean {
  const text = fn.declaredReturnType?.trim();
  if (!text) return false;
  return text.split("|").some((raw) => {
    const m = raw.trim();
    return (
      /^(["'`])[\s\S]*\1$/.test(m) ||
      /^-?(?:\d[\d_]*(?:\.\d+)?)(?:n)?$/.test(m) ||
      m === "true" ||
      m === "false"
    );
  });
}

/**
 * 契约返回面（**已复核**）：dts / standard 面消费。
 *
 * - 有返回契约且实现满足它 ⇒ 契约返回 Abs（async 时保留 `promise<…>` 包装）；
 * - 实现违约 ⇒ undefined（**不投影**契约；调用方回落观测面，Bug 626）；
 * - 无返回契约 ⇒ undefined。
 */
export function effectiveContractReturnFace(
  fn: FunctionAnalysis,
  eff: EffectiveContract | undefined,
  ctx?: FaceContext,
): Abs | undefined {
  const contractReturn = contractReturnFace(eff);
  if (contractReturn === undefined) return undefined;
  const observed = observedReturnFace(fn, fn.cases);
  if (contractViolated(fn, eff, observed, ctx)) return undefined;
  if (isPromiseAbs(observed)) return wrapPromise(contractReturn);
  return contractReturn;
}

/**
 * 观测返回面（**不含契约**）：`fn.combinedAbs` 优先，缺省回落**域证据 join**。
 *
 * 兜底 join 全部见证（与参数面同口径）——不是只取第 0 条断言见证（Bug 619）。
 */
export function observedReturnFace(
  fn: FunctionAnalysis,
  caseResults: readonly CaseResult[],
): Abs | undefined {
  const joined = joinWitnesses(caseResults);
  return fn.combinedAbs ?? joined;
}

/** 域证据 case 的返回 Abs join（无证据 = undefined）。 */
function joinWitnesses(caseResults: readonly CaseResult[]): Abs | undefined {
  const parts = domainEvidenceCases(caseResults)
    .map((c) => c.abs)
    .filter((a): a is Abs => !!a);
  if (parts.length === 0) return undefined;
  return parts.reduce((a, b) => joinAbs(a, b));
}

/** promise 观测（`eff/promise`）？ */
function isPromiseAbs(a: Abs | undefined): boolean {
  return !!a && a.shape.k === "eff" && a.shape.eff === "promise";
}

/** await 后的值（promise 取 inner，其余原样）。 */
function awaitedAbs(a: Abs): Abs {
  if (a.shape.k === "eff" && a.shape.eff === "promise") return a.shape.inner;
  return a;
}

/**
 * 契约域种子的**实参表**（按形参位装配）——契约种子求值的唯一口径。
 *
 * BUG-082：种子必须按**形参位**装配，不能按名字查表。
 *
 * 旧实现用「契约参数名 → Abs」表 + `fn.paramNames`（求值占位名）去查：解构
 * 形参的占位名是 `_p0`、契约键是 `a` / `_` / `card.grade` ⇒ **永不命中** ⇒
 * 播种全 `any` ⇒ 重算出的返回 Abs 是 any ⇒ zod / standard / guard / dts 四个
 * 发布面把返回投影成空域（`z.unknown()` / `{"k":"unknown"}` / `return true` /
 * `unknown`），而 `nudo check` 用 `FormalParam.pattern` 展开另走一套种子
 * （`unifiedParamFace`）⇒ 精确。同一知识在两面分叉。
 *
 * 现在用**同一个定位器**（`locateContractParam`，与参数面同源）把契约参数映射
 * 到形参位：字段契约合成一个对象 Abs（键取属性键，点路径合成嵌套槽），整对象
 * 契约直接作实参。数组解构的种子不做（需按元素下标造元组 ⇒ 该位给 `any`，
 * fail-closed 不伪造精度）。
 */
export function contractSeedArgs(fn: FunctionAnalysis, eff: EffectiveContract | undefined): Abs[] {
  const binders = eff?.binders ? new Map(Object.entries(eff.binders)) : undefined;
  const entryOf = (p: { param: string; constraint: NudoConstraint }): Abs =>
    constraintToEntryAbs(p.constraint, p.param, undefined, binders);
  const formals = formalList(fn);
  const located = (eff?.params ?? []).map((p) => ({ p, loc: locateContractParam(formals, p.param) }));
  const seedArgs: Abs[] = [];
  for (const formal of formals) {
    const own = located.filter((l) => l.loc?.index === formal.index);
    // ① 整参契约（标识形参 / 解构形参的整对象契约，含 `_`）
    const whole = own.find((l) => l.loc?.field === undefined && l.loc?.rest !== true);
    if (whole) {
      seedArgs.push(entryOf(whole.p));
      continue;
    }
    // ② 解构形参的字段契约 ⇒ 合成一个对象 Abs 作实参
    if (formal.kind === "pattern") {
      if (formal.patternKind === "array" || own.length === 0) {
        seedArgs.push(anyEntryAbs());
        continue;
      }
      const trees = new Map<string, SlotTree>();
      for (const { p, loc } of own) {
        const path = loc?.fieldPath ?? (loc?.field !== undefined ? [loc.field] : undefined);
        if (!path) continue;
        const key = path[0]!;
        const tree = trees.get(key) ?? { children: new Map() };
        insertPath(tree, path, entryOf(p));
        trees.set(key, tree);
      }
      const slots = Object.create(null) as Record<string, { value: Abs }>;
      // BUG-620 续修：种子对象（及嵌套树）必须**开放**——解构形参里契约
      // 没申报的绑定在闭合对象上读成 exact `undefined` ⇒ 返回面 / 产物凭空
      // 多出一个 `undefined` 槽（`{ grade, extra }` 只申报 `grade` 时
      // `extra` 被折成 undefined 并发布）。开放后未申报绑定读 `unknown`
      // ⇒ 不伪造精确值；契约申报的键仍精确（`g({a,b}){return a}` 不受影响）。
      for (const [key, tree] of trees) slots[key] = { value: treeAbs(tree, true) };
      seedArgs.push(openObj(slots));
      continue;
    }
    // ③ 剩余参数：契约描述的是**元素**类型（参数面同口径包一层数组）
    const rest = own.find((l) => l.loc?.rest === true);
    if (rest) {
      const el = entryOf(rest.p);
      seedArgs.push(makeAbs({ k: "arr", element: el }, undefined, undefined, el.conf));
      continue;
    }
    seedArgs.push(anyEntryAbs());
  }
  return seedArgs;
}

/**
 * 契约域**种子重算**：用契约参数 Abs 作种子重跑一次函数，取返回位。
 *
 * 与 dts 面的种子口径同向（契约参数 = 种子，缺省位 = `any`）；求值失败 ⇒
 * undefined（fail-closed，调用方回落观测面）。
 */
function seedDomainReturn(
  fn: FunctionAnalysis,
  eff: EffectiveContract | undefined,
  ctx: FaceContext | undefined,
): Abs | undefined {
  if (!eff || eff.params.length === 0 || !ctx) return undefined;
  // BUG-102：rest 形参的绑定是**实参收集**（长度由实参个数决定），而种子
  // 只能传固定个 Abs —— 把契约数组当**一个**实参传 ⇒ `[contractArray]`
  // 单元素见证 ⇒ `xs.length` 折 lit(1)、`xs[0]` 折契约本身；发布出的返回
  // 校验器拒绝实现自己的真实返回值。rest 位不可用固定实参播种 ⇒ fail-closed
  // 回落观测面（combinedAbs），与 check / dts 同源。
  if (formalList(fn).some((f) => f.kind === "rest")) return undefined;
  const seedArgs = contractSeedArgs(fn, eff);
  try {
    return (
      tryEvalCall(ctx.source, ctx.filePath, fn.name, seedArgs, ctx.mocks ? { mocks: ctx.mocks } : {}) ??
      undefined
    );
  } catch {
    return undefined;
  }
}

/**
 * 违约复核：实现返回**不满足**契约返回约束？
 *
 * 口径：契约域种子重算（若有参数契约 + 上下文）优先，否则用观测返回；promise
 * 观测比较 **await 后**的值（契约描述的是 await 后的值）。
 */
function contractViolated(
  fn: FunctionAnalysis,
  eff: EffectiveContract | undefined,
  observed: Abs | undefined,
  ctx: FaceContext | undefined,
): boolean {
  const constraint = eff?.returns?.constraint;
  if (!constraint) return false;
  const actual = seededActual(fn, eff, observed, ctx);
  if (!actual) return false;
  return constraintDisproved(awaitedAbs(actual), constraint);
}

/** 违约复核用的「实现实际返回」：契约域种子重算优先，否则观测返回。 */
function seededActual(
  fn: FunctionAnalysis,
  eff: EffectiveContract | undefined,
  observed: Abs | undefined,
  ctx: FaceContext | undefined,
): Abs | undefined {
  const seeded = seedDomainReturn(fn, eff, ctx);
  return seeded ?? observed;
}

/** 约束是否被实际值**证否**（决定性比较；不可判定 = 未证否）。 */
function constraintDisproved(actual: Abs, constraint: NudoConstraint): boolean {
  const shape = actual.shape;
  // 不可判定的实际值（无约束 / 未知）⇒ 不算违约
  if (shape.k === "any" || shape.k === "unknown" || shape.k === "never") {
    return false;
  }
  if (constraint.prim) {
    if (shape.k === "prim") return shape.type !== constraint.prim;
    if (shape.k === "sum") {
      // 成员里混有非 prim ⇒ 不可判定
      if (shape.members.some((m) => m.shape.k !== "prim")) return false;
      return !shape.members.some((m) => m.shape.k === "prim" && m.shape.type === constraint.prim);
    }
    // obj / arr / fn / eff 对标量契约 ⇒ 证否
    return true;
  }
  if (constraint.members && constraint.members.length > 0) {
    // union 契约：任一成员不被证否即不违约
    return !constraint.members.some((m) => !constraintDisproved(actual, m));
  }
  if (constraint.fields) {
    // shape 契约：非对象即证否；对象的字段细节不判。
    //
    // union 实际值（BUG-121）：与上面 `prim` 分支的 sum 处理**对称** —— 任一
    // 成员可能是对象 ⇒ 不可判定（不证否）。缺这道判定时 identity 函数把
    // 「shape 的 union」原样返回 ⇒ 逐个成员下探时一律「已证否」⇒ 契约返回 Abs
    // 被丢弃 ⇒ zod / standard / guard 三面塌缩成「接受一切」（假绿、零台账），
    // 而 dts / check 仍保留 union ⇒ 四面互斥。
    if (shape.k === "sum") return !shape.members.some((m) => m.shape.k === "obj");
    return shape.k !== "obj";
  }
  // fn / element / 空约束 ⇒ 不可判定
  return false;
}
