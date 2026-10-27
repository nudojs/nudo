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
  joinAbs,
  locateContractParam,
  obj,
  type Abs,
  type EffectiveInterface,
  type FormalParam,
  type NudoConstraint,
} from "@nudojs/core";
import { wrapPromise } from "@nudojs/core/internal";
import { domainEvidenceCases } from "@nudojs/service/emit";
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
export function contractParamFace(eff: EffectiveInterface | undefined): ParamFace[] {
  if (!eff) return [];
  return eff.params.map((p) => ({
    name: p.param,
    abs: constraintToEntryAbs(p.constraint, p.param),
    optional: p.constraint.isOptional === true,
  }));
}

/**
 * 契约返回面：`eff.returns` → entry Abs（无契约返回 = undefined）。
 *
 * 与 {@link unifiedReturnFace} 的差别：这里**只**取契约面（不回落观测证据），
 * 且**不做**违约复核与 promise 保形——复核后的口径见
 * {@link effectiveContractReturnFace}。
 */
export function contractReturnFace(eff: EffectiveInterface | undefined): Abs | undefined {
  return eff?.returns ? constraintToEntryAbs(eff.returns.constraint, "return") : undefined;
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
  const parts = cases.map((c) => c.argAbs[index]).filter((a): a is Abs => !!a);
  if (parts.length === 0) return undefined;
  return parts.reduce((a, b) => joinAbs(a, b));
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
    if (isEntryWitness(c) && first.shape.k === "arr") {
      elements.push(first.shape.element);
      restConf ??= first.conf;
      continue;
    }
    for (let i = restIndex; i < c.argAbs.length; i++) {
      const a = c.argAbs[i];
      if (a) elements.push(a);
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

/** 槽位树 → Abs（叶子 = 约束 Abs；子树 = 嵌套 obj）。 */
function treeAbs(tree: SlotTree): Abs {
  if (tree.children.size === 0) return tree.leaf ?? anyEntryAbs();
  const slots = Object.create(null) as Record<string, { value: Abs }>;
  for (const [key, child] of tree.children) slots[key] = { value: treeAbs(child) };
  return obj(slots);
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
  eff: EffectiveInterface | undefined,
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
          // 对象解构（BUG-120）：顶层键取**形参名**（`FormalParam.placeholder`），
          // 值是那个实参对象的形状 —— 与无契约的解构分支、数组解构分支、普通
          // 形参分支**同口径** ⇒ `<fn>Input` 的顶层键集合 ≡ 形参名集合。
          // 旧实现逐绑定名建顶层键（`{a, b}`）⇒ 与普通形参的「实参包」语义相反
          // ⇒ `plainInput` 拒绝 `.d.ts` 明文声明的调用形态。
          const slots = Object.create(null) as Record<string, { value: Abs }>;
          for (const [key, tree] of trees) slots[key] = { value: treeAbs(tree) };
          out.push({ name: formal.placeholder, abs: obj(slots), optional: false });
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
        // 契约描述的是**元素**类型（dts 面同口径：`...rest: T[]`）
        out.push({
          name: formal.name,
          abs: makeAbs({ k: "arr", element: p.abs }, undefined, undefined, p.abs.conf),
          // BUG-109：对象槽面上「`rest` 键缺省」= 空 rest 数组 = 零实参调用
          // （`g()` 是合法调用）⇒ 该槽可选；渲染成**必填**槽会让函数的每一次
          // 合法调用都被入参 schema 拒绝。
          optional: true,
          isRest: true,
        });
        continue;
      }
      // BUG-108：契约级 ∪ 声明级（默认形参）——与 standard 面同口径；
      // 只取契约级会让 zod 面把带默认值的位印成必填（三面互斥）。
      out.push({
        name: formal.name,
        abs: p.abs,
        optional: p.optional === true || formal.kind === "default",
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
  eff: EffectiveInterface | undefined,
  caseResults: readonly CaseResult[],
  ctx?: FaceContext,
): Abs | undefined {
  const observed = observedReturnFace(fn, caseResults);
  const contractReturn = contractReturnFace(eff);
  // 证据路径选择：契约返回面存在 ⇒ 走契约面（否则走观测面）
  if (evidencePathOf(contractReturn !== undefined) === "contract" && contractReturn !== undefined) {
    // 违约复核：实现不满足契约 ⇒ 不投影契约（回落实现实际返回）
    if (contractViolated(fn, eff, observed, ctx)) return observed;
    // promise 保形：契约描述的是 await 后的值
    if (isPromiseAbs(observed)) return wrapPromise(contractReturn);
    return contractReturn;
  }
  // 无返回契约：优先契约域种子重算（否则返回位落无约束入口观测，Bug 612）
  if (eff && eff.params.length > 0) {
    const seeded = seedDomainReturn(fn, eff, ctx);
    if (seeded !== undefined) return seeded;
  }
  return observed;
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
  eff: EffectiveInterface | undefined,
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
 * 契约域**种子重算**：用契约参数 Abs 作种子重跑一次函数，取返回位。
 *
 * 与 dts 面的种子口径同向（契约参数 = 种子，缺省位 = `any`）；求值失败 ⇒
 * undefined（fail-closed，调用方回落观测面）。
 */
function seedDomainReturn(
  fn: FunctionAnalysis,
  eff: EffectiveInterface | undefined,
  ctx: FaceContext | undefined,
): Abs | undefined {
  if (!eff || eff.params.length === 0 || !ctx) return undefined;
  const byName = new Map<string, Abs>();
  for (const p of eff.params) byName.set(p.param, constraintToEntryAbs(p.constraint, p.param));
  const seedArgs = fn.paramNames.map((n) => {
    const bare = n.startsWith("...") ? n.slice(3) : n;
    return byName.get(bare) ?? byName.get(n) ?? anyEntryAbs();
  });
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
  eff: EffectiveInterface | undefined,
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
  eff: EffectiveInterface | undefined,
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
