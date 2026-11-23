/**
 * 函数 dts 发射：主签名 → 声明行 / 重载 / JSDoc。
 *
 * 从 dts-generator 抽出。签名定型由 dts-signature 负责，这里只做声明胶水。
 */
import type { Abs } from "@nudojs/core";
import type { FunctionAnalysis } from "../analyzer.ts";
import {
  absToTSTypeIr,
  dropLedgerLines,
  pushDrop,
  withDtsContext,
} from "./dts-context.ts";
import type { DtsDrop } from "./dts-type.ts";
import { brandScopeOf } from "./dts-brand-scope.ts";
import { contractJSDocLines, generateJSDoc } from "./dts-jsdoc.ts";
import {
  computeHofSignature,
  computeMainSignature,
  contractOnlySignature,
  contractReturnTSType,
  returnAnnotationMismatch,
  thisReceiverClause,
  typeParamDecls,
  type DtsContractFace,
  type DtsFunctionProjection,
  type DtsProjectionCtx,
} from "./dts-signature.ts";
import {
  dtsExportDeclaration,
  dtsExportForm,
  dtsFormExportName,
  overloadExportGlue,
  type DtsExportForm,
} from "./dts-module-emit.ts";
import { annotationTypeRefs } from "./dts-annotation-text.ts";
import {
  dtsIdentifier,
  typeParamNamesInClause,
} from "./dts-text.ts";
import {
  dtsReturnWidenOf,
  renderDtsSignature,
  type DtsParam,
} from "./dts-ir.ts";
import type { DtsModuleSurface } from "./dts-ir.ts";

function mergeTypeParamClauses(srcClause: string, derived: readonly string[]): string {
  if (derived.length === 0) return srcClause;
  const declared = typeParamNamesInClause(srcClause);
  const extra = derived.filter((n) => !declared.includes(n));
  if (extra.length === 0) return srcClause;
  if (srcClause === "") return `<${extra.join(", ")}>`;
  // 子句是**一个**尖括号组（`<U>`），推导变元必须并进同一条，不能并列成
  // `<U><B_f>`（那是两个类型形参子句，整份产物解析失败）。
  const close = srcClause.lastIndexOf(">");
  if (!/^</.test(srcClause) || close < 0) return srcClause;
  return `${srcClause.slice(0, close)}, ${extra.join(", ")}>`;
}

export function projectFunctionDts(
  fn: FunctionAnalysis,
  contract?: DtsContractFace,
  surface?: DtsModuleSurface,
): DtsFunctionProjection {
  // Bug 233：brand 类名只在**产物里可解析**时才保留（本地声明 / 已 import /
  // TS 全局类型名）——作用域覆盖整条投影链（JSDoc / 签名 / 返回位）。
  // BUG-168：注解原文的可解析性需要同一份模块面；引用到的名字回传到投影上
  // （模块面据此补 `declare class` / `import type`），被丢弃的注解落台账。
  const ctx: DtsProjectionCtx = {
    ...(surface ? { surface } : {}),
    typeRefs: new Set(),
    dropped: [],
    mismatches: [],
    // Bug 57：类型形参子句按普查名查（类成员 `C.m`，模块函数 `gen`）。
    typeParamKey: fn.name,
  };
  const drops: DtsDrop[] = [];
  const proj = withDtsContext(
    {
      brandScope: brandScopeOf(surface),
      onDrop: (drop) => pushDrop(drops, drop),
    },
    () => projectFunctionDtsInner(fn, contract, ctx),
  );
  // 「第三种」：声明 vs 观测，**只落台账、绝不覆盖产物**。手写契约覆盖返回位
  // 时跳过（那是第三来源，不参与「实现 vs 声明」的比较）；无 combinedAbs
  // 时没有观测可判。
  if (!contract?.return && fn.declaredReturnType && fn.combinedAbs) {
    const mismatch = returnAnnotationMismatch(
      fn.declaredReturnType,
      absToTSTypeIr(fn.combinedAbs),
    );
    if (mismatch) ctx.mismatches?.push({ name: fn.name, ...mismatch });
  }
  const typeRefs = [...(ctx.typeRefs ?? [])];
  const ledger = [
    ...dropLedgerLines(drops),
    ...(ctx.dropped ?? []).map(
      (n) =>
        `// nudo:dropped-type-annotation ${n} — type not declared in this module (falls back to the observed type)`,
    ),
    ...(ctx.mismatches ?? []).map(
      (m) =>
        `// nudo:return-annotation-mismatch ${m.name} — declared element "${m.declared}", observed "${m.observed}"; kept the observed type`,
    ),
  ];
  if (typeRefs.length === 0 && ledger.length === 0) return proj;
  const withMeta: DtsFunctionProjection = {
    ...proj,
    ...(typeRefs.length > 0 ? { typeRefs } : {}),
  };
  if (ledger.length === 0) return withMeta;
  return proj.classMember
    ? {
        ...withMeta,
        classMember: {
          ...proj.classMember,
          lines: [...ledger, ...proj.classMember.lines],
        },
      }
    : { ...withMeta, lines: [...ledger, ...proj.lines] };
}

export function projectFunctionDtsInner(
  fn: FunctionAnalysis,
  contract: DtsContractFace | undefined,
  ctx: DtsProjectionCtx,
): DtsFunctionProjection {
  const surface = ctx.surface;
  // Bug 518/550：类成员（`C.m`）**不是模块级导出**——模块级没有 `C_m` 这个
  // 名字（那是凭空造导出；#494 的清洗只让它可解析，不让它正确）。
  // 成员声明进类体，类声明由模块面合成（一次一类）。
  //
  // **无模块面时保持历史口径**（`C_m` 模块级投影，#494 回归钉）：类声明必须
  // 一次一类（同一类多个方法 ⇒ 多份 `declare class C` ⇒ TS2300），只有模块面
  // 合成能保证。导出面感知的投影需要模块面（导出名 / 类 / 再导出）。
  const memberMatch = /^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/.exec(fn.name);
  if (fn.noDeclaration && memberMatch && surface) {
    const className = memberMatch[1]!;
    const member = memberMatch[2]!;
    const memberFn: FunctionAnalysis = { ...fn, name: member, noDeclaration: false };
    const decl = dtsFunctionDeclaration(memberFn, contract, {
      kind: "member",
      memberName: member,
    }, ctx);
    return {
      lines: [],
      params: decl.params,
      classMember: { className, member, lines: decl.lines },
    };
  }
  let emitFn = fn;
  if (fn.noDeclaration) {
    // 无模块面：类方法沿用历史 `Class_method` 投影（#494）；其余绑定形态
    // （default / CJS 槽 / export list）按导出名声明（Bug 514）。
    if (!memberMatch) {
      const form = dtsExportForm(fn.name, surface);
      if (form.kind === "none") return { lines: [], params: [] };
      const decl = dtsFunctionDeclaration(fn, contract, form, ctx);
      return {
        lines: decl.lines,
        params: decl.params,
        exportName: dtsFormExportName(form),
      };
    }
    emitFn = { ...fn, name: `${memberMatch[1]}_${memberMatch[2]}`, noDeclaration: false };
  }

  // 导出形态（模块面优先；无模块面 ⇒ 普查名即导出名）
  const form = dtsExportForm(emitFn.name, surface);
  if (form.kind === "none") return { lines: [], params: [] };

  // 双保险：任何非法标识符名都必须清洗——上游分类（noDeclaration）漏标时
  // 也不能产出不可解析的 .d.ts（#494）。
  const safeName = dtsIdentifier(emitFn.name);
  const named = safeName !== emitFn.name ? { ...emitFn, name: safeName } : emitFn;

  const decl = dtsFunctionDeclaration(named, contract, form, ctx);
  return {
    lines: decl.lines,
    params: decl.params,
    exportName: dtsFormExportName(form),
  };
}

/**
 * 单函数声明面（签名 + 声明行）：声明**写法**由导出形态决定
 * （具名 / default / 别名 / 类成员），签名口径不变。
 */
export function dtsFunctionDeclaration(
  fn: FunctionAnalysis,
  contract: DtsContractFace | undefined,
  form: DtsExportForm,
  ctx?: DtsProjectionCtx,
): { lines: string[]; params: Array<{ name: string; type: string }> } {
  // BUG-175：源码已有重载声明（原文镜像 + `functionOverloads` 登记）⇒ 不发
  // 实现签名（实现形参是 `any`，作为额外重载就是 catch-all），只补导出胶水。
  const overloadDecl = ctx?.surface?.functionOverloads?.get(fn.name);
  if (overloadDecl !== undefined && form.kind !== "member" && form.kind !== "none") {
    return { lines: overloadExportGlue(form, overloadDecl.exported), params: [] };
  }
  // Bug 57：源码声明的**函数 / 方法级类型形参槽**（`<T>` / `<A, B>`）。
  // 类级形参早在 BUG-168 修过，函数 / 方法级漏了 ⇒ 消费端
  // `gen<string>(…)` 报 TS2558。HOF 快照自带 `<…>` ⇒ 那条分支不叠加。
  const srcTypeParams =
    ctx?.typeParamKey !== undefined
      ? (ctx.surface?.typeParamClauses?.get(ctx.typeParamKey) ?? "")
      : "";
  // BUG-132：compat 行（不带 `<T>` 的重复声明）只有在签名**不引用**类型形参
  // 时才合法——`id<T>(v: T): T` 的 compat 体会写成 `function id(v: T): T`，
  // `T` 不在作用域里 ⇒ TS2304（比缺声明更糟）。
  const srcTypeParamNames = new Set(typeParamNamesInClause(srcTypeParams));
  const compatAllowed = (signature: string): boolean =>
    srcTypeParams !== "" &&
    !annotationTypeRefs(signature).some((n) => srcTypeParamNames.has(n));
  // 手写契约参数面优先于 HOF 泛型快照：契约是用户申报的调用面；混合投影
  // （部分契约位 + 部分泛型位）会让泛型变元失去与 promoted 形参的定义关系
  const hasContractParams = (contract?.params.length ?? 0) > 0;
  const hofSig = hasContractParams ? undefined : computeHofSignature(fn, ctx);
  if (hofSig) {
    const returnType = contract?.return
      ? contractReturnTSType(contract.return)
      : hofSig.returnType;
    const lines: string[] = [];
    const hofSlots: DtsParam[] = hofSig.paramNames.map((name, i) => ({
      name,
      type: hofSig.paramTypes[i] ?? "unknown",
      optional: false,
      ...(name.startsWith("...") ? { isRest: true } : {}),
    }));
    if (fn.cases.length > 0) {
      const jsdoc = generateJSDoc(fn, {
        params: hofSig.params,
        paramSlots: hofSlots,
        paramNames: hofSig.paramNames,
        paramTypes: hofSig.paramTypes,
        returnType,
      });
      if (jsdoc) lines.push(jsdoc);
    }
    // BUG-195：源码声明的类型形参必须先于 HOF 推导变元（`<U>` 有 Abs 证据时
    // 仍要出现在形参注解引用的作用域里）。
    const tparams = mergeTypeParamClauses(srcTypeParams, hofSig.typeParams);
    // BUG-133：`this: T` 接收者子句在 HOF 泛型分支同样要发射（旧实现只走
    // 观测签名分支 ⇒ `g<T>(this: Box<T>) { return (x) => … }` 的接收者契约
    // 整条消失）。子句可解析性判据与降级台账同 `thisReceiverClause`。
    const hofThis = thisReceiverClause(fn, ctx);
    lines.push(
      ...dtsExportDeclaration(
        form,
        renderDtsSignature({
          typeParams: tparams,
          ...(hofThis === "" ? {} : { thisParam: hofThis }),
          params: hofSlots,
          returnType: { type: returnType, widen: dtsReturnWidenOf(fn.cases) },
        }),
      ),
    );
    return {
      lines,
      params: hofSig.paramNames.map((name, i) => ({
        name,
        type: hofSig.paramTypes[i] ?? "unknown",
      })),
    };
  }

  if (fn.skipped || fn.cases.length === 0) {
    // skipped / entryOnly / 无 case 函数：只有声明或 combined 返回类型已知，
    // 保持历史行为——rest-args 形式，combined（含 Promise<T>）原样输出。
    // #176：skip 即使带 @nudo:case（运行时见证已照常求值）也走声明面——
    // combinedAbs 来自 @nudo:skip => 声明，case 不参与 dts 面合成。
    // 例外：手写契约参数位是申报面的一部分，具名投影。
    if (hasContractParams) {
      const sig = contractOnlySignature(fn, contract!, ctx);
      const plain = `(${sig.params.join(", ")}): ${sig.returnType}`;
      // ABS-03：契约面类型形参（只含被签名引用的变元）——与源码声明形参
      // 并存时源码在前、契约推导在后
      const contractTParams =
        sig.typeParams && sig.typeParams.length > 0
          ? `<${typeParamDecls(sig.typeParams, sig.constraints)}>`
          : "";
      const paramsText = renderDtsSignature({
        typeParams: `${srcTypeParams}${contractTParams}`,
        ...(sig.thisParam === undefined ? {} : { thisParam: sig.thisParam }),
        params: sig.paramSlots,
        returnType: { type: sig.returnType, widen: "none" },
      });
      return {
        lines: [
          ...contractJSDocLines(contract),
          ...dtsExportDeclaration(
            form,
            paramsText,
            // compat 行只有源码声明形参可承载（契约变元不在 compat 体里声明）
            srcTypeParams && !contractTParams && compatAllowed(plain) ? plain : undefined,
          ),
        ],
        params: sig.paramNames.map((name, i) => ({ name, type: sig.paramTypes[i]! })),
      };
    }
    const retAbs = fn.combinedAbs;
    if (retAbs) {
      return {
        lines: dtsExportDeclaration(form, `(...args: unknown[]): ${absToTSTypeIr(retAbs)}`),
        // rest-args 声明面无具名参数位可提示（skip = 开发者主动退出推断）
        params: [],
      };
    }
    // BUG-079：`@nudo:skip` 且**未声明返回类型**（combinedAbs 为 null）时，
    // 旧实现 `return { lines: [] }` ⇒ 该导出被**整条从产物里删掉**（不是降级
    // 成 any），而 `nudo check`（core checkSource）为同一函数合成 `any`
    // ⇒ 两面结论相反、消费端 `import { boom }` 直接 TS2305。
    // ⇒ 与 check 同源；TS 投影面按 2026-11-06 归一：无约束 any → TS unknown。
    return {
      lines: dtsExportDeclaration(form, `(...args: unknown[]): unknown`),
      params: [],
    };
  }

  const sig = computeMainSignature(fn, contract, ctx);
  const jsdoc = generateJSDoc(fn, sig);
  const lines: string[] = [...contractJSDocLines(contract)];
  if (jsdoc) lines.push(jsdoc);
  const plain = `(${sig.params.join(", ")}): ${sig.returnType}`;
  const sigTParams =
    sig.typeParams && sig.typeParams.length > 0
      ? `<${typeParamDecls(sig.typeParams, sig.constraints)}>`
      : "";
  lines.push(
    ...dtsExportDeclaration(
      form,
      renderDtsSignature({
        typeParams: `${srcTypeParams}${sigTParams}`,
        ...(sig.thisParam === undefined ? {} : { thisParam: sig.thisParam }),
        params: sig.paramSlots,
        returnType: { type: sig.returnType, widen: sig.returnWiden ?? "none" },
      }),
      srcTypeParams && !sigTParams && compatAllowed(plain) ? plain : undefined,
    ),
  );
  return {
    lines,
    params: sig.paramNames.map((name, i) => ({ name, type: sig.paramTypes[i]! })),
  };
}

export function generateFunctionDtsLines(
  fn: FunctionAnalysis,
  contract?: DtsContractFace,
): string[] {
  return projectFunctionDts(fn, contract).lines;
}
