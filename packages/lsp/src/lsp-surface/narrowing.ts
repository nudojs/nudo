/**
 * LSP 表面 — 判别窄化域（union 臂过滤）。
 *
 * owns：`p.type === 'lit'` 等值守卫之后纯标识符引用的窄化展示
 * （narrowByDiscriminant：解析引用定义 → union(…) shape 臂 →
 * 按 filter 过滤 → 匹配臂文本拼接）；臂解析（unionShapeArms /
 * objectTypeValue——判别键字面量提取）。
 * 不 owns：守卫事实收集（facts.ts——供给 filters）、引用定义解析
 * （resolve.ts 的 resolveTypeValueDef）、位置映射（position.ts）。
 */
import type { File, Node } from "@babel/types";
import type { LoadModule } from "@nudojs/service";
import { literalStringValue } from "./facts.ts";
import { computeLineStarts, lineColToOffset } from "./position.ts";
import { resolveTypeValueDef } from "./resolve.ts";
/**
 * 判别窄化：`p.type === 'lit'` 等值守卫之后，
 * 纯标识符引用（联合类型值——`astNode`）窄化
 * 为匹配臂的 shape 文本（then 分支的推导
 * 类型）。解析引用定义 → union(…) 的 shape
 * 臂 → 过滤（臂的 `type` 字面量匹配所有
 * filter）→ 匹配臂文本（` | ` 拼接）。
 * 无匹配 / 非联合定义 / 非 shape 臂 / 非
 * 纯标识符 → undefined（回退声明形态）。
 */
export function narrowByDiscriminant(
  refName: string,
  filters: Array<Set<string>>,
  sidecarPath: string,
  sidecarProgram: File["program"],
  sidecarSrc: string,
  loadModule: LoadModule | undefined,
): string | undefined {
  if (loadModule === undefined) return undefined;
  // 仅纯标识符引用（调用 / 属性链不窄化）
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(refName)) return undefined;
  const def = resolveTypeValueDef(
    refName,
    sidecarPath,
    sidecarProgram,
    sidecarSrc,
    loadModule,
    0,
  );
  if (def === null || def.node === undefined) return undefined;
  const arms = unionShapeArms(def.node, def.src);
  if (arms === null) return undefined;
  const matched = arms.filter((arm) => {
    const tv = arm.typeValue;
    return tv !== undefined && filters.every((f) => f.has(tv));
  });
  if (matched.length === 0) return undefined;
  return matched.map((arm) => arm.text).join(" | ");
}

/**
 * union(…) 调用的 shape 臂。臂 = shape({ … })
 * 调用的对象字面量（或直接对象字面量）——
 * 文本为源码切片（保留构建器原文）；非
 * shape 臂（如 lit(…) 字面量臂）→ null
 * （不过滤，回退）。
 */
function unionShapeArms(
  def: Node,
  src: string,
): Array<{ typeValue: string | undefined; text: string }> | null {
  if (def.type !== "CallExpression") return null;
  const c = def as unknown as { callee: Node; arguments: Node[] };
  if (c.callee.type !== "Identifier" || c.callee.name !== "union") {
    return null;
  }
  const lineStarts = computeLineStarts(src);
  const arms: Array<{ typeValue: string | undefined; text: string }> = [];
  for (const arg of c.arguments) {
    let obj: Node | undefined;
    if (arg.type === "CallExpression") {
      const a = arg as unknown as { callee: Node; arguments: Node[] };
      if (
        a.callee.type === "Identifier" &&
        a.callee.name === "shape" &&
        a.arguments.length === 1 &&
        a.arguments[0].type === "ObjectExpression"
      ) {
        obj = a.arguments[0];
      }
    } else if (arg.type === "ObjectExpression") {
      obj = arg;
    }
    if (obj === undefined || obj.loc == null) return null;
    const start = lineColToOffset(lineStarts, obj.loc.start);
    const end = lineColToOffset(lineStarts, obj.loc.end);
    if (start === -1 || end === -1 || end <= start) return null;
    arms.push({
      typeValue: objectTypeValue(obj),
      text: src.slice(start, end),
    });
  }
  return arms.length > 0 ? arms : null;
}

/** 对象字面量的 `type` 槽字面量值（判别键） */
function objectTypeValue(obj: Node): string | undefined {
  for (const prop of (obj as unknown as { properties: Node[] }).properties) {
    if (prop.type !== "ObjectProperty") continue;
    const p = prop as unknown as {
      key: Node;
      value: Node;
      computed?: boolean;
    };
    if (p.computed === true || p.key.type !== "Identifier" || p.key.name !== "type") {
      continue;
    }
    return literalStringValue(p.value);
  }
  return undefined;
}
