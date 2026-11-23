/**
 * 模块级值声明发射器：`export const/let/var` / `enum` / 注解 / `as const`。
 *
 * 从 `dts-generator.ts` 抽出。Abs 投影、注解解析、上下文作用域由调用方注入
 * ——本模块不读 dts 投影全局，也不依赖 generator 的内部函数。
 */
import type { Abs } from "@nudojs/core";
import { isJsBindingIdent } from "@nudojs/core/internal";
import type { DtsModuleSurface, DtsObjectFnAnnotation } from "./dts-ir.ts";
import { exportNameRepr } from "./export-binding.ts";
import { dtsExportNamesOf } from "./dts-module-emit.ts";

export type DtsValueEmitDeps = {
  /** Abs → TS 类型文本（已带当前投影上下文） */
  absToType: (a: Abs) => string;
  /** 可变容器递归拓宽 */
  widen: (a: Abs) => Abs;
  /** 对象字面量成员函数的源码注解叠加 */
  overlayAnnotations: (
    a: Abs,
    annotations: readonly DtsObjectFnAnnotation[] | undefined,
    surface: DtsModuleSurface,
    refs?: Set<string>,
    analyzedReturns?: ReadonlyMap<string, Abs>,
  ) => Abs;
  /** 值声明注解的放行判据 */
  safeAnnotation: (
    text: string,
    surface: DtsModuleSurface | undefined,
    refs?: Set<string>,
  ) => { text?: string; unresolved?: string };
  /** 在 append-only 投影上下文里渲染 */
  withContext: <T>(
    patch: {
      readonlyValues?: boolean;
      userSymbolKeys?: readonly string[];
      objectFnReturnOverrides?: ReadonlyMap<string, string>;
      symbolReturnOverrides?: ReadonlyMap<string, string>;
    },
    fn: () => T,
  ) => T;
};

export function dtsValueDeclarations(
  surface: DtsModuleSurface | undefined,
  values: ReadonlyMap<string, Abs> | undefined,
  declaredLocals: ReadonlySet<string>,
  annotationRefs: Set<string> | undefined,
  annotatedFunctionLocals: ReadonlySet<string>,
  analyzedMemberReturns: ReadonlyMap<string, Abs>,
  deps: DtsValueEmitDeps,
): string[] {
  if (!surface) return [];
  const out: string[] = [];
  for (const [local, value] of surface.values) {
    const names = dtsExportNamesOf(surface, local);
    const primary = names[0];
    if (primary === undefined) continue; // 未导出 ⇒ 不在公开面
    // 已被模块级函数声明占用（`export const f = () => …` 被分析成函数）⇒
    // 再发一条值声明会产出 TS2300（Duplicate identifier）。BUG-231 的例外：
    // 声明器注解可解析 ⇒ 函数声明已被抑制，值声明才是正确形态。
    if (
      declaredLocals.has(local) &&
      !annotatedFunctionLocals.has(local) &&
      value.nonFunctionValue !== true
    ) {
      continue;
    }
    if (surface.classes.has(local)) continue;
    const abs = values?.get(local);
    let decl: string;
    if (value.kind === "enum") {
      // 成员带上**字面量**初始化器（字符串 enum 的成员类型是字面量类型：
      // 丢掉 `= "a"` 会把它变成数值 enum ⇒ 消费端的 `Mode.A` 类型语义反转）。
      const body = (value.enumMembers ?? [])
        .map(
          (m) =>
            `  ${isJsBindingIdent(m.name) ? m.name : JSON.stringify(m.name)}${
              m.init !== undefined ? ` = ${m.init}` : ""
            },`,
        )
        .join("\n");
      // Bug 25：`export const enum` ⇒ `declare const enum`（与 tsc
      // `--declaration` 同形；否则消费端生成运行时 import、运行时 SyntaxError）。
      const constKw = value.constEnum ? "const " : "";
      decl = `declare ${constKw}enum ${local} {${body ? `\n${body}\n` : ""}}`;
    } else {
      // BUG-130：源码注解优先于观测（`export let l: number` 没有初始化器，
      // 注解是唯一类型来源）；引用不可解析名 ⇒ 不采用并落台账。
      const ann = value.annotation
        ? deps.safeAnnotation(value.annotation, surface, annotationRefs)
        : undefined;
      if (ann?.unresolved !== undefined) {
        out.push(
          `// nudo:dropped-type-annotation ${local}: ${ann.unresolved} — type not declared in this module (falls back to the observed type)`,
        );
      }
      // BUG-254 / BUG-258：初始化器 AST 里 Abs 表达不了的声明事实优先
      // （`typeof target` / `new Map<string, number>()` 的显式实参）。
      const initText = value.initTypeText;
      const astPreferred =
        initText !== undefined &&
        (initText.includes("typeof ") ||
          /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*<[\s\S]+>$/.test(initText));
      // BUG-264：`const s = Symbol("s")` ⇒ `unique symbol`（显式 `: symbol`
      // 注解已在上面优先）。
      const uniqueSymbolText = value.uniqueSymbol === true ? "unique symbol" : undefined;
      // BUG-140：初始化器内部的 `as const`（外层可变、内层冻结）。
      const declaredText =
        ann?.text ??
        value.nestedConstType ??
        uniqueSymbolText ??
        (astPreferred ? initText : undefined);
      if (abs === undefined && value.typeText === undefined && declaredText === undefined) {
        out.push(
          `// nudo:unresolved-value ${local} — no analysis binding (projected as unknown)`,
        );
      }
      // Bug 72：可变容器递归拓宽（对象槽 / 数组元素到基类型）。
      // Bug 77：`as const` 是**冻结**声明——字面量类型必须保留（否则
      // `{ readonly host: "h" }` 被拓宽成 `readonly host: string`，把 as const
      // 的字面量精度也丢了）⇒ 只走既有的顶层 widen + readonly 渲染。
      //
      // BUG-157：对象字面量成员函数的形参 / 返回注解叠加进 Abs（只补缺）。
      const withMemberAnnotations = (a: Abs): Abs =>
        deps.overlayAnnotations(
          a,
          value.fnMemberAnnotations,
          surface,
          annotationRefs,
          analyzedMemberReturns,
        );
      // BUG-236：symbol 方法的返回注解走上下文旁路
      const symbolReturns = new Map<string, string>();
      // BUG-271：普通对象方法的返回注解（`Promise<number>` / 具名别名 /
      // `string | null`）不能经 Shape 闸门——源码注解直接覆盖返回位文本。
      const objectReturns = new Map<string, string>();
      for (const ann of value.fnMemberAnnotations ?? []) {
        if (ann.returnType === undefined) continue;
        const safe = deps.safeAnnotation(ann.returnType, surface, annotationRefs);
        if (safe.text === undefined) continue;
        if (ann.key.startsWith("@@")) symbolReturns.set(ann.key, safe.text);
        else objectReturns.set(ann.key, safe.text);
      }
      // BUG-260：`const` 不参与顶层字面量拓宽（tsc 对 `const c = "abc"` 保留
      // `"abc"`）；`let` / `var` 仍拓宽。`as const` 完全不拓宽（冻结声明）。
      const renderAbs = (): string => {
        if (!abs) return value.typeText ?? "unknown";
        const annotated = withMemberAnnotations(abs);
        if (value.asConst) return deps.absToType(annotated);
        if (
          value.literalConst === true &&
          annotated.shape.k === "prim" &&
          annotated.term?.op === "lit"
        ) {
          return deps.absToType(annotated);
        }
        return deps.absToType(deps.widen(annotated));
      };
      const render = (): string =>
        deps.withContext(
          {
            ...(value.userSymbolKeys
              ? { userSymbolKeys: [...value.userSymbolKeys] }
              : {}),
            ...(objectReturns.size > 0 ? { objectFnReturnOverrides: objectReturns } : {}),
            ...(symbolReturns.size > 0 ? { symbolReturnOverrides: symbolReturns } : {}),
          },
          renderAbs,
        );
      const typeText =
        declaredText ??
        (value.asConst ? deps.withContext({ readonlyValues: true }, render) : render());
      decl = `declare ${value.kind} ${local}: ${typeText};`;
    }
    if (primary === local) {
      out.push(`export ${decl}`);
      out.push(...names.slice(1).map((n) => `export { ${local} as ${exportNameRepr(n)} };`));
      continue;
    }
    out.push(decl);
    out.push(`export { ${local} as ${exportNameRepr(primary)} };`);
    out.push(...names.slice(1).map((n) => `export { ${local} as ${exportNameRepr(n)} };`));
  }
  return out;
}
