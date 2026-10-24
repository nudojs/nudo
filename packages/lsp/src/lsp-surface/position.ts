/**
 * LSP 表面 — 光标定位域（position↔offset 映射 + AST 走查）。
 *
 * owns：位置比较/包含（posCmp/containsPos）、行列↔偏移换算
 * （computeLineStarts/lineColToOffset）、AST 节点判别（isNode）、
 * 光标处标识符/函数名/包围函数定位走访（findIdentNameAtPosition /
 * findFunctionNameAtPosition / findEnclosingFunction / findIdentParent）。
 * 不 owns：类型解析（resolve.ts）、流窄化事实（facts.ts）、Abs 求值
 * 与重放（replay.ts）、渲染（hover.ts / completions.ts）。
 * 叶子模块——不依赖兄弟模块。
 */
import type { Identifier, Node } from "@babel/types";
import { traverseEsm } from "../traverse-esm.ts";
import { listFnDirectiveScopes } from "@nudojs/core";
import { parse } from "@nudojs/parser";
/** 光标处任意标识符（绑定 hover） */
export function findIdentNameAtPosition(
  source: string,
  line: number,
  column: number,
  fileAst?: ReturnType<typeof parse>,
): string | undefined {
  try {
    const ast = fileAst ?? parse(source);
    let found: string | undefined;
    traverseEsm()(ast, {
      Identifier(path) {
        const loc = path.node.loc;
        if (!loc) return;
        if (loc.start.line !== line) return;
        if (column < loc.start.column || column > loc.end.column) return;
        found = path.node.name;
      },
    });
    return found;
  } catch {
    return undefined;
  }
}

/**
 * 光标处标识符是否是函数名位置。
 * 与 listFnDirectiveScopes 绑定名同口径：裸名（f / inner / helper）、
 * `C.m` / `owner.key`（ClassMethod / ObjectMethod key）。
 */
export function findFunctionNameAtPosition(
  source: string,
  line: number,
  column: number,
  fileAst?: ReturnType<typeof parse>,
): { name: string; isDecl: boolean } | undefined {
  try {
    const ast = fileAst ?? parse(source);
    let found: string | undefined;
    // 声明 id（FunctionDeclaration/VariableDeclarator/method key/property key）
    // vs 调用 callee——签名面（check 同口径）只属于前者，callee 走调用点面
    let foundDecl = false;
    // G2 绑定名（C.m / owner.key）——与 listFnDirectiveScopes 同口径
    let scopes: ReturnType<typeof listFnDirectiveScopes> | undefined;
    const scopeNameOf = (node: unknown): string | undefined => {
      scopes ??= listFnDirectiveScopes(ast as never);
      const hit = scopes.find((s) => s.node === node);
      return hit && hit.name !== "<anonymous>" ? hit.name : undefined;
    };
    traverseEsm()(ast, {
      Identifier(path) {
        const loc = path.node.loc;
        if (!loc) return;
        if (loc.start.line !== line) return;
        if (column < loc.start.column || column > loc.end.column) return;
        const parent = path.parent;
        // 函数声明 id
        if (parent.type === "FunctionDeclaration" && parent.id === path.node) {
          found = path.node.name;
          foundDecl = true;
          return;
        }
        // 调用 callee
        if (parent.type === "CallExpression" && parent.callee === path.node) {
          found = path.node.name;
          foundDecl = false;
          return;
        }
        // ClassMethod / ObjectMethod key → G2 绑定名（C.m / owner.key）
        if (
          (parent.type === "ClassMethod" ||
            parent.type === "ClassPrivateMethod" ||
            parent.type === "ObjectMethod") &&
          (parent as { key?: unknown }).key === path.node
        ) {
          found = scopeNameOf(parent) ?? path.node.name;
          foundDecl = true;
          return;
        }
        // 变量声明的函数初始化：const helper = (n) => … / const f = function () {}
        if (parent.type === "VariableDeclarator" && parent.id === path.node) {
          const init = (parent as { init?: { type?: string } | null }).init;
          if (
            init &&
            (init.type === "ArrowFunctionExpression" ||
              init.type === "FunctionExpression")
          ) {
            found = path.node.name;
            foundDecl = true;
            return;
          }
        }
        // CJS 成员导出（族 25 · Bug 998）：`exports.f = fn` / `module.exports.f = fn`
        // —— 标识符 `f` 是 MemberExpression 的 property，左侧必须是 `exports` /
        // `module.exports`，且整条是「赋值给函数值」。
        // （此前无此分支 ⇒ CJS 导出的函数名解析不出来 ⇒ hover 回退成无名
        //   `(x) => ?`，而诊断面 / 符号面却认得它 ⇒ IDE 内部自相矛盾。）
        if (
          parent.type === "MemberExpression" &&
          parent.property === path.node &&
          !(parent as { computed?: boolean }).computed
        ) {
          const obj = (parent as { object?: { type?: string; name?: string } }).object;
          const isExportsTarget =
            (obj?.type === "Identifier" && obj.name === "exports") ||
            (obj?.type === "MemberExpression" &&
              !(obj as { computed?: boolean }).computed &&
              (obj as { property?: { type?: string; name?: string } }).property?.type ===
                "Identifier" &&
              (obj as { property?: { name?: string } }).property?.name === "exports" &&
              (obj as { object?: { type?: string; name?: string } }).object?.type ===
                "Identifier" &&
              (obj as { object?: { name?: string } }).object?.name === "module");
          if (isExportsTarget) {
            // 祖父节点 = AssignmentExpression（Babel 的 `node.parent` 不存在，
            // 必须走 `path.parentPath.parent`）
            const assign = path.parentPath?.parent as
              | { type?: string; left?: unknown; right?: { type?: string } }
              | undefined;
            const right = assign?.right;
            if (
              assign?.type === "AssignmentExpression" &&
              assign.left === parent &&
              right &&
              (right.type === "ArrowFunctionExpression" ||
                right.type === "FunctionExpression")
            ) {
              found = path.node.name;
              foundDecl = true;
              return;
            }
          }
        }
        // 对象/类属性键上的函数值：{ get: function () {} } / { get: () => {} }
        if (
          (parent.type === "ObjectProperty" ||
            parent.type === "ClassProperty" ||
            parent.type === "ClassPrivateProperty") &&
          (parent as { key?: unknown }).key === path.node
        ) {
          const val = (parent as { value?: { type?: string } | null; init?: { type?: string } | null }).value ??
            (parent as { init?: { type?: string } | null }).init;
          if (
            val &&
            (val.type === "ArrowFunctionExpression" ||
              val.type === "FunctionExpression")
          ) {
            found = scopeNameOf(parent) ?? path.node.name;
            foundDecl = true;
            return;
          }
        }
      },
    });
    return found !== undefined ? { name: found, isDecl: foundDecl } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 光标最内层 enclosing 函数（traverse 直查，不依赖指令存在——
 * extractDirectivesQuiet 只返回带指令的函数）。
 * 覆盖：函数声明 / const fn = arrow|function / 对象方法 / 类方法。
 * 返回 node（函数体节点，含 loc）供体内局部声明扫描与记录过滤。
 */
export type EnclosingFn = { name: string; node: Node };

export function findEnclosingFunction(
  ast: Node,
  line: number,
  column: number,
): EnclosingFn | undefined {
  let best: { name: string; startLine: number; node: Node } | undefined;
  const traverseFn = traverseEsm();
  try {
    traverseFn(ast, {
      FunctionDeclaration(p) {
        const loc = p.node.loc;
        const name = p.node.id?.name;
        if (!loc || !name) return;
        if (loc.start.line <= line && loc.end.line >= line) {
          if (!best || loc.start.line > best.startLine) best = { name, startLine: loc.start.line, node: p.node };
        }
      },
      VariableDeclarator(p) {
        const init = p.node.init;
        if (!init || (init.type !== "ArrowFunctionExpression" && init.type !== "FunctionExpression")) return;
        const loc = init.loc;
        const name = (p.node.id as { name?: string } | null)?.name;
        if (!loc || !name) return;
        if (loc.start.line <= line && loc.end.line >= line) {
          if (!best || loc.start.line > best.startLine) best = { name, startLine: loc.start.line, node: init };
        }
      },
      "ObjectMethod|ClassMethod"(p) {
        const node = p.node as unknown as {
          loc?: { start: { line: number }; end: { line: number } };
          key?: { name?: string };
        };
        const name = node.key?.name;
        if (!node.loc || !name) return;
        if (node.loc.start.line <= line && node.loc.end.line >= line) {
          if (!best || node.loc.start.line > best.startLine) best = { name, startLine: node.loc.start.line, node: p.node };
        }
      },
    });
  } catch {
    // ignore
  }
  return best ? { name: best.name, node: best.node } : undefined;
}

type Pos = { line: number; column: number };

export function posCmp(a: Pos, b: Pos): number {
  return a.line !== b.line ? a.line - b.line : a.column - b.column;
}

export function containsPos(n: Node, line: number, column: number): boolean {
  const loc = n.loc;
  if (!loc) return false;
  return (
    posCmp(loc.start, { line, column }) <= 0 &&
    posCmp({ line, column }, loc.end) <= 0
  );
}

/** 找到光标处标识符及其父节点（父指针需自走查，Babel 无 parent） */
export function findIdentParent(
  node: Node,
  line: number,
  column: number,
): { name: string; ident: Node; parent: Node } | null {
  for (const key of Object.keys(node)) {
    if (
      key === "loc" ||
      key === "extra" ||
      key === "leadingComments" ||
      key === "trailingComments" ||
      key === "innerComments" ||
      key === "tokens" ||
      key === "comments"
    ) {
      continue;
    }
    const v = (node as unknown as Record<string, unknown>)[key];
    if (Array.isArray(v)) {
      for (const el of v) {
        if (isNode(el)) {
          if (el.type === "Identifier" && containsPos(el, line, column)) {
            return {
              name: (el as Identifier).name,
              ident: el,
              parent: node,
            };
          }
          const r = findIdentParent(el, line, column);
          if (r) return r;
        }
      }
    } else if (isNode(v)) {
      if (v.type === "Identifier" && containsPos(v, line, column)) {
        return {
          name: (v as Identifier).name,
          ident: v,
          parent: node,
        };
      }
      const r = findIdentParent(v, line, column);
      if (r) return r;
    }
  }
  return null;
}

export function isNode(v: unknown): v is Node {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as Node).type === "string"
  );
}

/** 每行起始偏移（1-based 行号 → 文本内偏移） */
export function computeLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

export function lineColToOffset(
  lineStarts: number[],
  p: { line: number; column: number },
): number {
  const base = lineStarts[p.line - 1];
  return base === undefined ? -1 : base + p.column;
}
