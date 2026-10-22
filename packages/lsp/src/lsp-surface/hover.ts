/**
 * LSP 表面 — hover 渲染域。
 *
 * owns：getHoverAtPosition（函数名内涵签名 + 标识符外延 + 引擎重放
 * 求值态三面合成，A7 interface 档同源）、HoverInfo / HoverInterfaceOpts、
 * 参数声明形态折叠（paramDisplayOf——叠加 facts 流窄化与 narrowing
 * 判别窄化）、nullable 包装剥离（stripNullableWrappers）。
 * 不 owns：重放/绑定面/局部投影（replay.ts）、守卫事实（facts.ts）、
 * 臂过滤（narrowing.ts）、定义解析与变量链接（resolve.ts）、
 * 光标定位（position.ts）。
 */
import type { File, Node } from "@babel/types";
import {
  formatAbs,
  formatAbsMultiline,
  formatShape,
  formalParamSignatureNames,
  generalizeFromAst,
  interfaceTierOf,
  type Abs,
  type InterfaceSource,
  type InterfaceTierOpts,
  type PolyFn,
} from "@nudojs/core";
import { extractDirectivesQuiet, parse } from "@nudojs/parser";
import {
  collectAbsBindingsFromGraph,
  mockDirectivesToAbsSeeds,
  type AnalysisResult,
  type LoadModule,
} from "@nudojs/service";
import { formatThrowsAbs } from "@nudojs/core/internal";
import { flowFactsAt } from "./facts.ts";
import { narrowByDiscriminant } from "./narrowing.ts";
import {
  findEnclosingFunction,
  findFunctionNameAtPosition,
  findIdentNameAtPosition,
  type EnclosingFn,
} from "./position.ts";
import {
  absFromCaseReplay,
  absFromEval,
  absNodeAtPosition,
  getAbsAtPosition,
  isUnnarrowedAbs,
  positionInsideCaseFunction,
  projectLocalAbs,
  reuseBinding,
  type SurfaceReuse,
} from "./replay.ts";
import { linkTypeVariables, projectParamAbs } from "./resolve.ts";
export type HoverInfo = {
  /** 外延展示（formatShape / formatAbs） */
  typeText: string;
  /** 内涵签名（代数 generalize） */
  intension?: string;
  /** 无损 Abs 单行展示（shape / term / pred / conf） */
  abs?: string;
  /** 无损 Abs 多行展示 */
  absMultiline?: string;
  /** check 同口径签名（`fn(params) => ret`）；IDE hover 渲染面 */
  signature?: string;
  /** CodeLens `● interface` 同源档位（A7）；仅本地 named export */
  interfaceSource?: InterfaceSource;
  /**
   * interface 档当前是否**激活**（观察选择器状态；724）。
   * 与 CodeLens 的 `lens.active` 同源：该函数正观察某个 case ⇒
   * 契约档转 `○`（`false`）；否则契约档 `●`（`true`）。
   */
  interfaceActive?: boolean;
  /** 有效契约展示（handwritten/generated）；implicit 为 undefined */
  interfaceDisplay?: string;
  /**
   * 类型值变量链接面（参数折叠展示的 markdown 渲染：引用标识符
   * 如 `astNode` 包为 `[astNode](file://<定义路径>#L<行>)`）。
   * 在场时 IDE hover 直接渲染它（plain markdown——代码块内
   * 链接不渲染）；缺席时回落 ```nudo 代码块
   */
  linkedText?: string;
};

/** A7：hover/inlay 与 CodeLens interface 档同源（design-refine-derivation §8） */
export type HoverInterfaceOpts = InterfaceTierOpts;

/**
 * 见证面 throws 证据 → 展示名（911：与 `nudo check` 签名行同口径）。
 *
 * check 面的签名尾缀 `throws X` 来自入口求值的 hard throw ∪ soft
 * may-throw 效果（core `formatThrowsAbs`）；IDE 侧同一份证据在 service
 * 的 `CaseResult.throwsAbs`（未抛 = never）⇒ 展示名同源。
 *
 * - entry@ 见证优先（check 的入口求值口径）；无 entry@ 时回落该函数
 *   全部见证的并集（指令 case / 调用点见证里的显式 throw）。
 * - 无证据 ⇒ undefined（**不写 `throws never`**）。
 */
function throwsDisplayOf(
  result: AnalysisResult | undefined,
  fnName: string,
): string | undefined {
  if (!result) return undefined;
  const fn = result.functions.find((f) => f.name === fnName);
  if (!fn) return undefined;
  const entry = fn.cases.find((c) => c.name.startsWith("entry@"));
  const pool = entry ? [entry] : fn.cases;
  const names = new Set<string>();
  for (const c of pool) {
    const n = formatThrowsAbs(c.throwsAbs);
    if (n !== undefined && n !== "") names.add(n);
  }
  if (names.size === 0) return undefined;
  return [...names].sort().join(" | ");
}

/**
 * LSP hover：优先无损 Abs（类型即计算本体）。
 * 节点表也是 Abs（collectAbsNodeTypes），不经 bridge。
 *
 * 函数名/调用 callee 位置（design-hof-relations §7）：
 * intension 一律走 generalize/formatPoly（HOF fnRels 在这里）；
 * typeText 仍落 evaluator Abs（调用点显示结果类型，不是函数签名）。
 * 禁止用 evaluator 的 arity-only fn Abs 冒充权威关系源。
 *
 * A7 default 档：函数名 hover 附带 interfaceTierOf 来源 + 契约展示，
 * 与 CodeLens `● interface / <source>` 同源；选 case 时 body 仍走
 * activeCases 重放，interface 档标注不变。
 */
export function getHoverAtPosition(
  filePath: string,
  source: string,
  line: number,
  column: number,
  activeCases?: Map<string, number>,
  opts?: HoverInterfaceOpts,
  reuse?: SurfaceReuse,
): HoverInfo | null {
  // parse 一次（reuse.ast 优先）；失败 → AST 相关路径全部短路，
  // 不再 `file ?? parse(source)` 兜底重 parse（确定性失败，纯浪费）
  let file: ReturnType<typeof parse> | undefined;
  if (reuse?.ast !== undefined) {
    file = reuse.ast;
  } else {
    try {
      file = parse(source);
    } catch {
      file = undefined;
    }
  }
  const fnHit = findFunctionNameAtPosition(source, line, column, file);
  const fnName = fnHit?.name;
  /** 声明名位置（非调用 callee）才有 check 同口径签名面 */
  const fnDeclPos = fnHit?.isDecl ?? false;

  // interface 档（A7）：与 CodeLens 同源；仅导出函数标注
  const tier =
    fnName !== undefined
      ? interfaceTierOf(source, fnName, filePath, opts ?? {})
      : undefined;

  // 观察选择器状态（724）：与 CodeLens `lens.active` 同源——该函数当前
  // 正观察某个 case ⇒ 契约档 ○（否则 ●）。与 computeInterfaceLenses 的
  // `contractActive = !(activeCases?.has(fn.name) ?? false)` 同一公式。
  const interfaceActive = fnName !== undefined ? !(activeCases?.has(fnName) ?? false) : true;

  // throws 证据（911）：只在**导出**函数上取（tier 在场 ⇔ 本地 named
  // export，与 check 的 isEntry 同口径——CLI 的 L2 throws 只对 entry 生效）。
  const throwsDisplay =
    tier !== undefined && fnName !== undefined
      ? throwsDisplayOf(reuse?.result, fnName)
      : undefined;

  // intension 候选：先算、不早退，最后合并进 evaluator/TypeValue 结果
  let gDisplay: string | undefined;
  let gAbs: string | undefined;
  let gMulti: string | undefined;
  let gSig: string | undefined;
  if (fnName) {
    try {
      // refine（fromFile/侧车 ambient）与 modules（跨模块图）一并传入：
      // 缺 refine → 参数无契约种子（A1）；缺 modules → 跨模块调用 unknown
      const g = generalizeFromAst(fnName, source, {
        ...(file ? { file } : {}),
        refine: {
          fromFile: filePath,
          ...(opts?.loadModule ? { loadModule: opts.loadModule } : {}),
          ...(opts?.autoBind !== undefined ? { autoBind: opts.autoBind } : {}),
        },
        ...(reuse?.modules ? { modules: reuse.modules } : {}),
      });
      if (g) {
        gDisplay = g.display;
        gAbs = formatAbs(g.symbolic);
        gMulti = formatAbsMultiline(g.symbolic, fnName);
        // check 同口径签名（check-signatures formatEntrySigLine
        // 同公式：formalParamSignatureNames + formatShape）。契约参数
        // 优先展示声明形态（entryReqs.display——判别联合的
        // formatShape 展开可达数万字符）；无契约参数保持推断 shape
        const reqByParam = new Map(
          (g.entryReqs ?? []).map((r) => [r.param, r.display]),
        );
        const names =
          g.formals && g.formals.length > 0 ? formalParamSignatureNames(g.formals) : g.params;
        const ps = names
          .map((p, i) => {
            const display = reqByParam.get(p);
            if (display !== undefined) return `${p}: ${display}`;
            const t = g.typeParams[i]?.value;
            // design §2：无约束 any；真 unknown 不得伪装
            const shown = !t ? "any" : t.shape.k === "unknown" ? "unknown" : formatShape(t);
            return `${p}: ${shown}`;
          })
          .join(", ");
        // 返回类型与 check 同预算（951）：`formatShape(g.symbolic)` 走共享
        // 投影预算 PROJECTION_MAX_DEPTH（check-signatures formatEntrySigLine
        // 同款）——hover 单方面 maxDepth 4 会让同一 Abs 在产品内渲染成
        // 三种形态（check 签名行 / inlayHint / hover 签名块）。
        // throws 尾缀同 check 签名行（911）：见证面 throws 证据（导出函数
        // 才有——CLI 的 L2 throws 只对 entry 生效）；无证据则省略。
        const throwsSuffix = throwsDisplay ? `  throws ${throwsDisplay}` : "";
        gSig = `${fnName}(${ps}) => ${formatShape(g.symbolic)}${throwsSuffix}`;
      }
    } catch {
      // ignore
    }
  }
  const withTier = <T extends HoverInfo | null>(info: T): T => {
    if (!info || !tier) return info;
    return {
      ...info,
      interfaceSource: tier.source,
      // 观察选择器状态（724）：与 CodeLens `lens.active` 同源——该函数
      // 正观察某个 case ⇒ 契约档 ○；否则契约档 ●。
      interfaceActive,
      ...(tier.display !== undefined ? { interfaceDisplay: tier.display } : {}),
    };
  };
  const attachIntension = (info: HoverInfo | null): HoverInfo | null => {
    if (!gDisplay) return withTier(info);
    const sigField = fnDeclPos && gSig ? { signature: gSig } : {};
    if (!info) {
      // 函数名 hover：signature（check 同口径）是 IDE 渲染面；
      // abs/absMultiline/intension 保留给 nudo.hover payload（无损面）
      return withTier({
        typeText: gDisplay,
        intension: gDisplay,
        abs: gAbs,
        absMultiline: gMulti,
        ...sigField,
      });
    }
    return withTier({
      ...info,
      intension: gDisplay,
      // 外延侧已有更准 Abs 时保留；否则用 symbolic 兜底
      abs: info.abs ?? gAbs,
      absMultiline: info.absMultiline ?? gMulti,
      ...sigField,
    });
  };

  // 求值引擎：优先 Abs 节点表 / 标识符绑定，不经 TypeValue evaluateProgram。
  // 用例函数体内：Abs 重放 selected case（activeCases），再 TypeValue 兜底。
  const insideCaseFn = positionInsideCaseFunction(source, file, line, column);

  // arity-only fn Abs（shape.k=fn 且 returnType 槽空——未被调用观测过）：
  // 携带信息少于 generalize 的内涵签名（gDisplay / gSig），不作为展示面。
  // 函数名 / callee 位 hover 由此回落下方 intension 面（引擎 generalize 语义，
  // 非源码文本近似）；fn Abs 已带 returnType（被调用观测过）时仍直读 Abs。
  const deferIfArityOnlyFn = (a: Abs | null): Abs | null => {
    if (!a || !gDisplay) return a;
    return a.shape.k === "fn" && a.shape.returnType === undefined ? null : a;
  };

  if (!insideCaseFn) {
    const fromB = deferIfArityOnlyFn(absFromEval(filePath, source, line, column, file, reuse));
    if (fromB) {
      const absLine = formatAbs(fromB);
      const absMulti = formatAbsMultiline(fromB, undefined);
      return attachIntension({ typeText: absLine, abs: absLine, absMultiline: absMulti });
    }
  } else {
    const fromCase = absFromCaseReplay(filePath, source, line, column, file, activeCases);
    if (fromCase) {
      const absLine = formatAbs(fromCase);
      const absMulti = formatAbsMultiline(fromCase, undefined);
      return attachIntension({ typeText: absLine, abs: absLine, absMultiline: absMulti });
    }
  }

  // Abs 兜底（同源 reuse：不再内部重复 parse + 全量求值）
  const absFallback = deferIfArityOnlyFn(
    getAbsAtPosition(filePath, source, line, column, activeCases, {
      ...(reuse?.result !== undefined ? { result: reuse.result } : {}),
      ...(file !== undefined ? { ast: file } : {}),
    }),
  );
  if (absFallback) {
    const absLine = formatAbs(absFallback);
    const absMulti = formatAbsMultiline(absFallback, undefined);
    return attachIntension({ typeText: absLine, abs: absLine, absMultiline: absMulti });
  }

  // 标识符面（顺序即优先级）：
  // A 参数投影 → B 模块级绑定面 → C 体内局部（entry 实参调用 + 记录投影）。
  // 用例函数体内不再整体短路：case 重放面已删（恒 null），绑定面只覆盖
  // 模块级名（import/顶层声明），参数已在 A 先返回——不会被调用点绑定污染。
  // fnName 命中且本地 generalize 有内涵（函数名/本地 callee）时走上方
  // intension 面不进这里；fnName 命中但 gDisplay 缺失（导入函数的 callee
  // ——本文件无声明）时放行，绑定面给 fn Abs。
  const ident = findIdentNameAtPosition(source, line, column, file);
  const fnFaceMissing = fnName !== undefined && gDisplay === undefined;
  if (ident && (!fnName || fnFaceMissing)) {
    /** 标识符 hover 外延：`grade: string`——内涵（term/pred/conf）
     *  留给函数名 hover 的契约面，标识符面不重复展开。
     *  展开层级受限（maxDepth 4——lazy 自引用在深预算下指数
     *  展开，可达数万字符；超深以 `…` 截断标记）；pretty 多行
     *  缩进（obj 每槽一行 + 尾逗号、复合臂 union 按臂断行），
     *  纯 prim 联合保持单行 */
    const identHover = (value: Abs): HoverInfo => {
      const text = `${ident}: ${formatShape(value, { maxDepth: 4, pretty: true })}`;
      return { typeText: text, abs: text };
    };
    // —— A. 参数面：光标在参数声明（含解构属性）或参数引用上时，从
    // enclosing 函数的 generalized Abs 投影参数槽位。绑定面只覆盖模块级
    // import——参数 Abs 的唯一权威源是 generalize（契约种子 + 模块图
    // 在此生效，与函数名 hover 同源）。lexical shadowing 同口径：参数先于绑定。
    let encFn: EnclosingFn | undefined;
    let gEnc: PolyFn | undefined;
    if (file) {
      encFn = findEnclosingFunction(file, line, column);
      if (encFn) {
        try {
          gEnc = generalizeFromAst(encFn.name, source, {
            file,
            refine: {
              fromFile: filePath,
              ...(opts?.loadModule ? { loadModule: opts.loadModule } : {}),
              ...(opts?.autoBind !== undefined ? { autoBind: opts.autoBind } : {}),
            },
            ...(reuse?.modules ? { modules: reuse.modules } : {}),
          });
        } catch {
          // fail-closed：generalize 失败 → 无参数面（不拖垮 hover）
        }
        // 侧车契约档（参数面 + 成员投影共用）：
        // 侧车源码 / AST 预解析（判别窄化的臂
        // 过滤与变量链接的引用解析共用）
        const encTier = interfaceTierOf(source, encFn.name, filePath, opts ?? {});
        const sidecarPath = encTier?.sidecarPath;
        let sidecarProgram: File["program"] | undefined;
        let sidecarSrc: string | undefined;
        if (
          sidecarPath !== undefined &&
          opts?.loadModule !== undefined
        ) {
          sidecarSrc = opts.loadModule(sidecarPath, sidecarPath);
          if (sidecarSrc !== undefined) {
            try {
              sidecarProgram = parse(sidecarSrc).program;
            } catch {
              sidecarProgram = undefined;
            }
          }
        }
        // —— A0. 引擎节点级 Abs 重放（求值态面——
        // 优先）：导出函数 + 契约参数 Abs 齐备
        // 时符号执行，位置直读求值态 Abs（流
        // 敏感窄化为引擎求值语义——早退守卫 /
        // 判别等值 / !== 对偶 / typeof 守卫 /
        // && / || 链，$fork 臂内 withExecPhi +
        // $narrowMemberEq 剪影）。显示口径：
        // ident 是形参且求值态与入口 Abs 等价
        // （未窄化 / 仅剥 nullish——声明位 /
        // 检查点 / 成员访问对象位 / 落回位）
        // → 下方声明形态折叠面（用户口径——
        // nullable(astNode) / astNode + 链接）；
        // 窄化位（守卫 then 分支 / 槽位读 /
        // 局部量）→ 求值态（formatShape
        // maxDepth 4）。重放未覆盖 / 失败 →
        // 回落声明形态面
        let engineAbs: Abs | undefined;
        if (gEnc) {
          const nodeAbs = absNodeAtPosition(
            filePath,
            source,
            encFn,
            gEnc,
            reuse,
            line,
            column,
            file,
          );
          if (nodeAbs !== undefined) {
            const entryAbs = gEnc.entryShapes?.get(ident)?.abs;
            if (entryAbs === undefined || !isUnnarrowedAbs(nodeAbs, entryAbs)) {
              engineAbs = nodeAbs;
            }
          }
        }
        if (engineAbs !== undefined) {
          const typeText = `${ident}: ${formatShape(engineAbs, {
            maxDepth: 4,
            showLits: true,
            pretty: true,
          })}`;
          return {
            typeText,
            abs: typeText,
          };
        }
        // 参数声明位 / 引用位：声明形态折叠（体内
        // 引用叠加流窄化——早退守卫 / 成员访问对象
        // 之后剥离 nullable 包装；等值守卫 then
        // 分支判别窄化为匹配臂——重放未覆盖时的
        // 近似面）。投影面（projectParamAbs）展示
        // 的 generalized 参数类型与声明形态同信息
        // ——一为判别联合无损展开（lazy 自引用
        // 指数展开可达数万字符单行）、一为声明
        // 原文；evaluator 流敏感面（absFromEval
        // 模块级绑定面在上方）不受影响。名称
        // 匹配（ident = 形参名）；lexical
        // shadowing 同口径：参数先于绑定
        const display = gEnc
          ? paramDisplayOf(
              gEnc,
              ident,
              encFn.node,
              file,
              line,
              column,
              sidecarPath,
              sidecarProgram,
              sidecarSrc,
              opts?.loadModule,
            )
          : undefined;
        if (display !== undefined) {
          // 类型值变量链接（侧车表达式中的引用
          // 标识符 → 定义位置）：在场时 IDE hover
          // 渲染 plain markdown（代码块内链接不
          // 渲染），契约原文行不再重复
          const linked =
            sidecarPath !== undefined &&
            sidecarProgram !== undefined &&
            sidecarSrc !== undefined
              ? linkTypeVariables(
                  ident,
                  display,
                  sidecarPath,
                  sidecarProgram,
                  sidecarSrc,
                  opts?.loadModule,
                )
              : undefined;
          const typeText = `${ident}: ${display}`;
          return {
            typeText,
            abs: typeText,
            ...(linked !== undefined ? { linkedText: linked } : {}),
          };
        }
        const paramHit = gEnc ? projectParamAbs(gEnc, ident) : undefined;
        if (paramHit) return attachIntension(identHover(paramHit));
      }
    }
    // —— B. 绑定面（模块级名：import / 顶层声明）。同源绑定优先；
    // 缺失时经模块图（相对 + 裸包）现求——case 函数体内的 import 引用
    // （vetoFindings 等）由此返回。
    const absBound = reuse?.result ? reuseBinding(reuse, ident) : undefined;
    if (absBound) return attachIntension(identHover(absBound));
    if (file) {
      try {
        const seeds = mockDirectivesToAbsSeeds(extractDirectivesQuiet(file), {
          fromFile: filePath,
        });
        const absBinds = collectAbsBindingsFromGraph(source, filePath, {
          seedVars: seeds.seedVars,
          seedFns: seeds.seedFns as never,
        });
        const fromGraph = absBinds.get(ident);
        if (fromGraph) return attachIntension(identHover(fromGraph));
      } catch {
        // fail-closed：绑定面求值失败 → 不产出 Abs（不拖垮 hover）
      }
    }
    // —— C. 体内局部：enclosing 以 entry 形参（契约种子）实参调用一次，
    // 从赋值记录（let/var 再赋值）与调用记录（调用初始化 const）投影。
    // 非调用初始化 / 非赋值局部保持 fail-closed（诚实无信息）。
    if (encFn && gEnc) {
      const local = projectLocalAbs(filePath, source, encFn, gEnc, ident, reuse?.modules);
      if (local) return attachIntension(identHover(local));
    }
  }

  // —— 无 ident 位（return 关键字 / 表达式内非标识符位）：引擎重放
  // 位置表直读（ReturnStatement 记录键 = return 关键字起始位；子
  // 表达式位经最小 span 候选命中）。无 ident 前缀；不进
  // withTier/attachIntension（fnName 为空时它们本就无效）
  if (!ident && !fnName && !insideCaseFn && file) {
    const encFn = findEnclosingFunction(file, line, column);
    if (encFn) {
      let gEnc: PolyFn | undefined;
      try {
        gEnc = generalizeFromAst(encFn.name, source, {
          file,
          refine: {
            fromFile: filePath,
            ...(opts?.loadModule ? { loadModule: opts.loadModule } : {}),
            ...(opts?.autoBind !== undefined ? { autoBind: opts.autoBind } : {}),
          },
          ...(reuse?.modules ? { modules: reuse.modules } : {}),
        });
      } catch {
        // fail-closed：generalize 失败 → 无重放（不拖垮 hover）
      }
      if (gEnc) {
        const abs = absNodeAtPosition(
          filePath,
          source,
          encFn,
          gEnc,
          reuse,
          line,
          column,
          file,
        );
        if (abs !== undefined) {
          const typeText = formatShape(abs, {
            maxDepth: 4,
            showLits: true,
            pretty: true,
          });
          return { typeText, abs: typeText };
        }
      }
    }
  }

  // fail-closed：其余任意表达式光标 Abs 由标识符绑定面（absFromEval）
  // 与 interface 档覆盖（return / 子表达式位已在上方重放面处理）

  // 无类型结果时仍返回 intension（函数名 hover 的同源保证）；
  // tier 可缺（nested / 非导出），gDisplay 有就给出
  if (gDisplay) {
    return withTier({
      typeText: gDisplay,
      intension: gDisplay,
      abs: gAbs,
      absMultiline: gMulti,
      ...(fnDeclPos && gSig ? { signature: gSig } : {}),
    });
  }
  return null;
}

/**
 * 参数声明形态折叠（名称匹配 + 流窄化）：ident 是形参名且
 * entryReqs 有声明形态（display——侧车表达式原文 / 指令
 * 约束名）时返回 display，替代投影面的判别联合无损展开
 * （可达数万字符单行——lazy 自引用指数展开）。无 display
 * （派生形参 / 无契约 / 解构子属性点路径不匹配）→
 * undefined，回落投影面（诚实降级）。
 *
 * 体内引用位叠加流窄化事实（有界规则集）：
 * - 成员访问对象（`node.x`，非可选链）：访问成立即排除
 *   nullish；
 * - 早退守卫之后（`if (!node) return …;`——守卫蕴含
 *   nullish 且 then 以 return/throw 结束）：后续语句排除
 *   nullish；
 * - `p.type === 'lit'` 等值守卫的 then 分支：判别窄化——
 *   联合类型值引用（`astNode`）过滤为匹配臂的 shape 文本。
 * 窄化成立时剥离 display 的 `nullable(…)` 包装（链式表达式
 * 才剥——union 字面量 / 合并形态不剥）；检查点（`!node`
 * 自身）与声明位不窄化，保持声明形态。
 */
function paramDisplayOf(
  g: PolyFn,
  ident: string,
  fnNode: Node,
  file: Node,
  line: number,
  column: number,
  sidecarPath: string | undefined,
  sidecarProgram: File["program"] | undefined,
  sidecarSrc: string | undefined,
  loadModule: LoadModule | undefined,
): string | undefined {
  const req = g.entryReqs?.find((r) => r.param === ident);
  if (req?.display === undefined) return undefined;
  const facts = flowFactsAt(fnNode, file, ident, line, column);
  let display = req.display;
  if (facts.nonNullish) display = stripNullableWrappers(display);
  // 判别窄化（等值守卫 then 分支——联合类型值
  // 引用过滤为匹配臂）
  if (
    facts.typeFilters.length > 0 &&
    sidecarPath !== undefined &&
    sidecarProgram !== undefined &&
    sidecarSrc !== undefined
  ) {
    display =
      narrowByDiscriminant(
        display,
        facts.typeFilters,
        sidecarPath,
        sidecarProgram,
        sidecarSrc,
        loadModule,
      ) ?? display;
  }
  return display;
}

/** 链式表达式（标识符 / 调用 / 属性链）——`nullable(X)` 剥离 X 的合法性 */
const CHAIN_EXPR =
  /^[A-Za-z_$][A-Za-z0-9_$]*(?:\(.*\))?(?:\.[A-Za-z_$][A-Za-z0-9_$]*(?:\(.*\))?)*$/;

/**
 * 剥离 `nullable(…)` 包装（可重复——`nullable(nullable(x))`）；
 * 仅当内层是链式表达式（构建器调用 / 引用——其类型本就不含
 * null）；union 字面量 / 合并形态（` ∧ `）不剥。` ∧ name` 合并
 * 形态只处理表达式前缀。
 */
function stripNullableWrappers(display: string): string {
  const idx = display.indexOf(" ∧ ");
  const expr = idx === -1 ? display : display.slice(0, idx);
  const rest = idx === -1 ? "" : display.slice(idx);
  let out = expr;
  while (
    out.length > 10 &&
    out.startsWith("nullable(") &&
    out.endsWith(")") &&
    CHAIN_EXPR.test(out.slice(9, -1))
  ) {
    out = out.slice(9, -1);
  }
  return out + rest;
}
