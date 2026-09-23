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
      /**
       * 契约名 → 对象属性键。rename `{a: b}` 时契约可写 a 或 b，
       * 投影必须用属性键 a（Abs 对象只有 slot a）。
       */
      propKey: Record<string, string>;
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
  properties?: Array<{
    key?: AstParam;
    value?: AstParam;
    type?: string;
    argument?: AstParam;
  }>;
  elements?: Array<AstParam | null | undefined>;
};

function collectPatternNames(
  p: AstParam,
  top: string[],
  nested: string[],
  depth: number,
  propKey?: Record<string, string>,
): void {
  if (!p) return;
  if (p.type === "Identifier" && p.name) {
    if (depth === 0) top.push(p.name);
    else nested.push(p.name);
    return;
  }
  if (p.type === "AssignmentPattern") {
    collectPatternNames(p.left as AstParam, top, nested, depth, propKey);
    return;
  }
  if (p.type === "RestElement") {
    collectPatternNames(p.argument as AstParam, top, nested, depth, propKey);
    return;
  }
  if (p.type === "ObjectPattern") {
    for (const prop of p.properties ?? []) {
      // RestElement（Babel：{a, ...rest}）字段是 argument，不是 value/key
      if (prop.type === "RestElement" || prop.argument) {
        collectPatternNames(prop.argument as AstParam, top, nested, depth, propKey);
        continue;
      }
      const keyName =
        prop.key?.type === "Identifier" && prop.key.name
          ? prop.key.name
          : prop.key && "value" in prop.key
            ? String((prop.key as { value?: unknown }).value ?? "")
            : undefined;
      const v = (prop.value ?? prop.key) as AstParam | undefined;
      if (!v) continue;
      // rename（{a: b}）：契约面同时接受属性键 a 与绑定名 b
      if (keyName && v.type === "Identifier" && v.name && keyName !== v.name) {
        if (depth === 0) top.push(keyName);
        else nested.push(keyName);
        if (propKey && depth === 0) propKey[keyName] = keyName;
      }
      // 属性值是 Identifier → 本层绑定名；默认值（AssignmentPattern）不升层
      // （`{ port = 3000 }` 的 port 仍是顶层契约面）；嵌套 pattern → depth+1
      if (v.type === "Identifier" && v.name) {
        if (depth === 0) {
          top.push(v.name);
          if (propKey && keyName) propKey[v.name] = keyName;
        } else nested.push(v.name);
      } else if (v.type === "AssignmentPattern") {
        collectPatternNames(v, top, nested, depth, propKey);
      } else {
        collectPatternNames(v, top, nested, depth + 1, propKey);
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
      } else if (el.type === "AssignmentPattern") {
        // `[a = 1]` 的 a 仍是本层绑定名
        collectPatternNames(el, top, nested, depth, propKey);
      } else {
        collectPatternNames(el, top, nested, depth + 1, propKey);
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
      const propKey: Record<string, string> = {};
      if (left) collectPatternNames(left, top, nested, 0, propKey);
      return {
        kind: "pattern",
        placeholder: `_p${index}`,
        bound: top,
        propKey,
        nested,
        index,
      };
    }
    if (p?.type === "RestElement") {
      const arg = p.argument as AstParam | undefined;
      const name =
        arg?.type === "Identifier" && arg.name ? arg.name : `arg${index}`;
      return { kind: "rest", name, display: `...${name}`, index };
    }
    const top: string[] = [];
    const nested: string[] = [];
    const propKey: Record<string, string> = {};
    if (p) collectPatternNames(p, top, nested, 0, propKey);
    return {
      kind: "pattern",
      placeholder: `_p${index}`,
      bound: top,
      propKey,
      nested,
      index,
    };
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
        // rename `{a: b}`：投影必须用属性键 a，不是绑定名 b
        return { index: f.index, field: f.propKey?.[contractName] ?? contractName };
      }
    }
  }
  return undefined;
}
