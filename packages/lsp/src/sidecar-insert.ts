/**
 * A6 missing-field quickfix：在侧车里定位「目标形参的契约 shape 对象」内部。
 *
 * 纯函数（便于测试）：定位不到 ⇒ 返回 null，**绝不猜**（避免误改用户的契约）。
 *
 * 结构定位全部走 **AST**（`@nudojs/parser` 的 `parse` + 本包的 `traverseEsm`）：
 * 字符串 / 注释里的同形文本不会骗过结构（Bug 731 的根因就是「行内文本启发式」
 * 把「往某个 shape 里补字段」执行成了「往 `fn(...)` 的**形参表**里加一个形参」）。
 */

import { parse } from "@nudojs/parser";
import type {
  CallExpression,
  File,
  ObjectExpression,
  ObjectProperty,
} from "@babel/types";
import { traverseEsm } from "./traverse-esm.ts";

export type SidecarInsertPos = { line: number; character: number };

/**
 * 目标定位信息（缺字段路径拆出来的两段）。
 *
 * - `param`：缺字段路径的**首段** = 形参名（`u.name` → `u`）。
 * - `path`：缺字段路径的**其余段** = 形参 shape 内的嵌套字段路径
 *   （`u.name` → `["name"]`；`u.addr.city` → `["addr", "city"]`）。
 */
export type FnContractTarget = {
  param: string;
  path: string[];
};

/**
 * 在侧车源码中定位「`export const <fnName> … fn( … )` 的目标形参 ⇒ 其内联
 * `shape({ … })` 的字段表 `{` 之后」的位置。
 *
 * 语义（契约）：
 * - 目标形参的**契约类型**必须是**内联** `shape({ … })`；共享标识符
 *   （`u: userShape`）/ 标量（`u: number()`）⇒ 无法定位 ⇒ `null`
 *   （旧实现会退化成「`fn(` 括号内第一层的 `{`」= 形参表顶层 ⇒ 写坏契约）。
 * - `path` 的中间段必须逐级命中**内联** `shape({ … })`；否则 `null`。
 * - 末段字段**已在**目标 shape 的字段表里 ⇒ `null`（不写重复键）。
 * - 定位不到任何一环 ⇒ `null`（调用方据此**不提供**该 quickfix）。
 *
 * @param sidecarLines 侧车源码行
 * @param fnName       目标绑定名（`export const <fnName> = …`）
 * @param target       目标形参 + 字段路径
 * @returns 插入点（0 基 `{ line, character }`，列 = 目标字段表 `{` 之后一列）；
 *          定位失败 ⇒ `null`
 */
export function findFnContractInsertPos(
  sidecarLines: string[],
  fnName: string,
  target: FnContractTarget,
): SidecarInsertPos | null {
  if (!target.param || target.path.length === 0) return null;

  let ast: File;
  try {
    ast = parse(sidecarLines.join("\n"));
  } catch {
    return null;
  }

  // 目标绑定的 `fn( … )` 调用的**第一个实参** = 形参表对象
  let found: ObjectExpression | null = null;
  try {
    traverseEsm()(ast, {
      ExportNamedDeclaration(path) {
        const decl = path.node.declaration;
        if (!decl || decl.type !== "VariableDeclaration") return;
        for (const d of decl.declarations) {
          if (d.id.type !== "Identifier" || d.id.name !== fnName) continue;
          const init = d.init;
          if (!init || init.type !== "CallExpression") continue;
          if (!isCalleeNamed(init, "fn")) continue;
          const first = init.arguments[0];
          if (!first || first.type !== "ObjectExpression") continue;
          found = first;
          path.stop();
          return;
        }
      },
    });
  } catch {
    return null;
  }
  // 回调里的赋值 TS 不跟踪 ⇒ 显式 cast 把窄化收回声明类型
  const paramTable = found as ObjectExpression | null;
  if (!paramTable) return null;

  // 形参表里找目标形参 ⇒ 它的契约类型必须是内联 `shape({ … })`
  const entry = findProperty(paramTable, target.param);
  if (!entry) return null;
  let table = shapeFieldsOf(entry.value);
  if (!table) return null;

  // 嵌套路径：逐级下降（中间段也必须命中内联 shape）
  for (let i = 0; i < target.path.length - 1; i++) {
    const nested = findProperty(table, target.path[i]!);
    if (!nested) return null;
    const nestedTable = shapeFieldsOf(nested.value);
    if (!nestedTable) return null;
    table = nestedTable;
  }

  // 末段字段已在契约里 ⇒ 不写重复键（契约里已有 ⇒ 补字段是无意义的动作）
  const field = target.path[target.path.length - 1]!;
  if (findProperty(table, field)) return null;

  const loc = table.loc;
  if (!loc) return null;
  return { line: loc.start.line - 1, character: loc.start.column + 1 };
}

/** 形参表 / shape 字段表里的属性（键是标识符或字符串字面量；计算键不算） */
function findProperty(
  obj: ObjectExpression,
  key: string,
): ObjectProperty | null {
  for (const p of obj.properties) {
    if (p.type !== "ObjectProperty" || p.computed) continue;
    const k = p.key;
    if (k.type === "Identifier" && k.name === key) return p;
    if (k.type === "StringLiteral" && k.value === key) return p;
  }
  return null;
}

/** 内联 `shape({ … })` 的字段表；不是内联 shape ⇒ null */
function shapeFieldsOf(value: ObjectProperty["value"]): ObjectExpression | null {
  if (!value || value.type !== "CallExpression") return null;
  if (!isCalleeNamed(value, "shape")) return null;
  const first = value.arguments[0];
  if (!first || first.type !== "ObjectExpression") return null;
  return first;
}

/** 调用者名（`fn` / `shape`） */
function isCalleeNamed(call: CallExpression, name: string): boolean {
  return call.callee.type === "Identifier" && call.callee.name === name;
}
