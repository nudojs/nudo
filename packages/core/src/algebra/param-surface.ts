/**
 * C4.1：函数形参表面（contract surface）——
 * 侧车 `fn({…})` / `@nudo:refine` 参数名与求值形参的对齐基线。
 *
 * - Identifier / 默认参（AssignmentPattern left）→ 绑定名
 * - RestElement → 契约名用裸名（`args`），展示名 `...args`
 * - ObjectPattern / ArrayPattern → 求值占位 `_p{i}`；契约面 = 顶层绑定名
 *   （对象属性 / 数组元素 Identifier）。嵌套 pattern 的绑定名标 `nested`，
 *   消费方可显式降级（C4.5 param-mismatch / 不执法）。
 */

export type FormalParam =
  | { kind: "id"; name: string; index: number }
  | { kind: "default"; name: string; index: number }
  | { kind: "rest"; name: string; display: string; index: number }
  | {
      kind: "pattern";
      /** 求值/签名占位名（generalize 与 dts 用） */
      placeholder: string;
      /** 顶层可表达绑定名（侧车契约面） */
      bound: string[];
      /** 仅嵌套内出现、顶层不可单独表达的名（降级用） */
      nested: string[];
      index: number;
    };

type AstParam = {
  type: string;
  name?: string;
  left?: AstParam;
  right?: unknown;
  argument?: AstParam;
  properties?: Array<{ key?: AstParam; value?: AstParam; type?: string }>;
  elements?: Array<AstParam | null | undefined>;
};

function collectPatternNames(
  p: AstParam,
  top: string[],
  nested: string[],
  depth: number,
): void {
  if (!p) return;
  if (p.type === "Identifier" && p.name) {
    if (depth === 0) top.push(p.name);
    else nested.push(p.name);
    return;
  }
  if (p.type === "AssignmentPattern") {
    collectPatternNames(p.left as AstParam, top, nested, depth);
    return;
  }
  if (p.type === "RestElement") {
    collectPatternNames(p.argument as AstParam, top, nested, depth);
    return;
  }
  if (p.type === "ObjectPattern") {
    for (const prop of p.properties ?? []) {
      const v = (prop.value ?? prop.key) as AstParam | undefined;
      if (!v) continue;
      // 属性值是 Identifier → 本层绑定名；嵌套 pattern → depth+1
      if (v.type === "Identifier" && v.name) {
        if (depth === 0) top.push(v.name);
        else nested.push(v.name);
      } else {
        collectPatternNames(v, top, nested, depth + 1);
      }
    }
    return;
  }
  if (p.type === "ArrayPattern") {
    for (const el of p.elements ?? []) {
      if (!el) continue;
      if (el.type === "Identifier" && el.name) {
        if (depth === 0) top.push(el.name);
        else nested.push(el.name);
      } else {
        collectPatternNames(el, top, nested, depth + 1);
      }
    }
  }
}

export function formalParamsFromNodes(params: AstParam[] | undefined | null): FormalParam[] {
  const list = params ?? [];
  return list.map((p, index): FormalParam => {
    if (p?.type === "Identifier" && p.name) {
      return { kind: "id", name: p.name, index };
    }
    if (p?.type === "AssignmentPattern") {
      const left = p.left as AstParam | undefined;
      if (left?.type === "Identifier" && left.name) {
        return { kind: "default", name: left.name, index };
      }
      // 默认 + pattern：按 pattern 处理，占位 `_p{i}`
      const top: string[] = [];
      const nested: string[] = [];
      if (left) collectPatternNames(left, top, nested, 0);
      return { kind: "pattern", placeholder: `_p${index}`, bound: top, nested, index };
    }
    if (p?.type === "RestElement") {
      const arg = p.argument as AstParam | undefined;
      const name =
        arg?.type === "Identifier" && arg.name ? arg.name : `arg${index}`;
      return { kind: "rest", name, display: `...${name}`, index };
    }
    const top: string[] = [];
    const nested: string[] = [];
    if (p) collectPatternNames(p, top, nested, 0);
    return { kind: "pattern", placeholder: `_p${index}`, bound: top, nested, index };
  });
}

/** 求值/签名用形参名（与 analyzer extractParamNames / dts 对齐） */
export function formalParamDisplayNames(formals: FormalParam[]): string[] {
  return formals.map((f) => {
    switch (f.kind) {
      case "id":
      case "default":
        return f.name;
      case "rest":
        return f.display;
      case "pattern":
        return f.placeholder;
    }
  });
}

/** 侧车契约可绑定的参数名全集 */
export function contractParamNameSet(formals: FormalParam[]): Set<string> {
  const out = new Set<string>();
  for (const f of formals) {
    if (f.kind === "id" || f.kind === "default") out.add(f.name);
    else if (f.kind === "rest") {
      out.add(f.name);
      out.add(f.display);
    } else if (f.kind === "pattern") {
      out.add(f.placeholder);
      out.add("_");
      for (const b of f.bound) out.add(b);
    }
  }
  return out;
}

/**
 * 契约参数名 → 形参定位。
 * - 命中 id/default/rest → 该 index（执法按整参）
 * - 命中 pattern 顶层 bound 名 → 该 pattern index + field
 * - 命中 placeholder / `_` → pattern index（整对象）
 * - 未命中 → undefined（C4.5 param-mismatch）
 */
export function locateContractParam(
  formals: FormalParam[],
  contractName: string,
):
  | { index: number; field?: string; rest?: boolean }
  | undefined {
  for (const f of formals) {
    if (f.kind === "id" || f.kind === "default") {
      if (f.name === contractName) return { index: f.index };
    } else if (f.kind === "rest") {
      if (f.name === contractName || f.display === contractName) {
        return { index: f.index, rest: true };
      }
    } else if (f.kind === "pattern") {
      if (f.placeholder === contractName || contractName === "_") {
        return { index: f.index };
      }
      if (f.bound.includes(contractName)) {
        return { index: f.index, field: contractName };
      }
    }
  }
  return undefined;
}

/** 从源码抽顶层函数的 formal 表（errorRecovery parse） */
export function formalParamsFromSource(
  source: string,
  fnName: string,
): FormalParam[] | undefined {
  // 轻量 regex 不可靠；由调用方从 AST 传入更稳。此函数供测试/CLI 回退。
  void source;
  void fnName;
  return undefined;
}
