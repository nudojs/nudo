/**
 * 类声明面的纯源码工具：类型形参 / 超类实参 / index signature / 重载合并。
 *
 * `scanClassSurface` 仍留在 generator（依赖较多分析面证据）；这里先收口不依赖
 * Abs 的声明片段读取与规范化。
 */
import type { DtsClassMethodSurface } from "./dts-ir.ts";
import { tsAnnotationTypeText } from "../ts-annotation.ts";
import { surfaceSlice, type SurfaceNode } from "./dts-surface-utils.ts";

/** 类型形参声明节点 → 子句原文（`<T, U = string>`）；无 source / 节点 ⇒ undefined。 */
export function typeParamClauseText(
  node: SurfaceNode | undefined,
  source: string | undefined,
): string | undefined {
  if (!source || !node) return undefined;
  const text = surfaceSlice(source, node);
  return text && /^</.test(text) ? text : undefined;
}

/** 超类类型实参实例化节点 → 各实参的源码原文（`extends Base<string>` ⇒ `["string"]`）。 */
export function superTypeArgsText(
  node: SurfaceNode | undefined,
  source: string | undefined,
): string[] {
  if (!source || !node) return [];
  const params = node.params as SurfaceNode[] | undefined;
  if (!Array.isArray(params)) return [];
  return params
    .map((p) => surfaceSlice(source, p))
    .filter((t): t is string => t !== undefined && t.length > 0);
}

/** Bug 88：类体 `TSIndexSignature` → ambient 声明文本（`[key: string]: …;`）。 */
export function indexSignatureText(
  mem: SurfaceNode,
  source: string | undefined,
): string | undefined {
  if (!source) return undefined;
  const raw = surfaceSlice(source, mem);
  if (!raw) return undefined;
  const cleaned = tsAnnotationTypeText(raw.replace(/;\s*$/, ""));
  return cleaned ? `${cleaned};` : undefined;
}

/**
 * BUG-175：把同名**无体声明**合并到实现条目上（`overloads`），无实现时
 * 合并到首条声明上（抽象 / ambient 重载集）——保持源码顺序、去掉重复条目。
 *
 * 合并后发射侧只发 `overloads`（= 源码声明集），**不发实现签名**：实现的
 * 形参注解通常是 `any`，混进重载集就是额外 catch-all 重载（消费方传入 tsc
 * 会拒绝的实参也编译通过）。
 */
export function coalesceClassMethodOverloads(list: DtsClassMethodSurface[]): void {
  const groups = new Map<string, DtsClassMethodSurface[]>();
  for (const e of list) {
    const g = groups.get(e.name);
    if (g) g.push(e);
    else groups.set(e.name, [e]);
  }
  const drop = new Set<DtsClassMethodSurface>();
  for (const [, group] of groups) {
    const decls = group.filter((e) => e.declarationOnly === true);
    if (decls.length === 0) continue;
    const impl = group.find((e) => e.declarationOnly !== true);
    const keep = impl ?? decls[0]!;
    const signatures = impl === undefined && decls.length === 1 ? [] : decls;
    if (signatures.length > 0) {
      keep.overloads = signatures.map((e) => ({
        name: e.name,
        params: e.params,
        ...(e.paramTypes !== undefined ? { paramTypes: e.paramTypes } : {}),
        ...(e.accessibility !== undefined ? { accessibility: e.accessibility } : {}),
        ...(e.isAbstract === true ? { isAbstract: true } : {}),
        ...(e.returnType !== undefined ? { returnType: e.returnType } : {}),
        ...(e.typeParams !== undefined ? { typeParams: e.typeParams } : {}),
        ...(e.optional === true ? { optional: true } : {}),
        ...(e.symbolKey === true ? { symbolKey: true } : {}),
      }));
    }
    for (const e of group) if (e !== keep) drop.add(e);
  }
  if (drop.size === 0) return;
  let w = 0;
  for (let r = 0; r < list.length; r++) {
    const e = list[r]!;
    if (!drop.has(e)) list[w++] = e;
  }
  list.length = w;
}
