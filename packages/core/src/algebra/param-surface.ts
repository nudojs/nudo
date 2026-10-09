/**
 * C4.1：函数形参表面（contract surface）——
 * 侧车 `fn({…})` / `@nudo:contract` 参数名与求值形参的对齐基线。
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
      /**
       * #137：嵌套解构点路径契约面（'card.grade'，源属性键点连接）。
       * 中间键（card）同时在 bound 里平铺可绑（整对象 shape 契约）。
       */
      nestedPaths: string[];
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

/** #137：记录嵌套源属性路径 P+K；任一段含 '.' 整体丢弃（歧义 fail-closed） */
function pushNestedPath(prefix: string[], key: string, nestedPaths: string[]): void {
  if (prefix.length === 0 || !key) return;
  if (key.includes(".") || prefix.some((seg) => seg.includes("."))) return;
  nestedPaths.push([...prefix, key].join("."));
}

function collectPatternNames(
  p: AstParam,
  top: string[],
  nested: string[],
  depth: number,
  propKey: Record<string, string>,
  /** #137：已走过的源属性路径段（对象键链；数组元素无路径寻址 → 重置空） */
  prefix: string[],
  /** #137：嵌套点路径契约面（'card.grade'）收集袋 */
  nestedPaths: string[],
): void {
  if (!p) return;
  if (p.type === "Identifier" && p.name) {
    if (depth === 0) top.push(p.name);
    else nested.push(p.name);
    return;
  }
  if (p.type === "AssignmentPattern") {
    // #137：默认值包装层不是路径段——.left 同 prefix 直通
    collectPatternNames(p.left as AstParam, top, nested, depth, propKey, prefix, nestedPaths);
    return;
  }
  if (p.type === "RestElement") {
    collectPatternNames(p.argument as AstParam, top, nested, depth, propKey, prefix, nestedPaths);
    return;
  }
  if (p.type === "ObjectPattern") {
    for (const prop of p.properties ?? []) {
      // RestElement（Babel：{a, ...rest}）字段是 argument，不是 value/key
      if (prop.type === "RestElement" || prop.argument) {
        collectPatternNames(prop.argument as AstParam, top, nested, depth, propKey, prefix, nestedPaths);
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
      // rename（{a: b} / {a: b = 1}）：契约面同时接受属性键 a 与绑定名 b
      // AssignmentPattern 的 left 是绑定名，同样要建立 propKey[b]=a
      const renameTarget =
        v.type === "Identifier"
          ? v
          : v.type === "AssignmentPattern"
            ? (v.left as AstParam | undefined)
            : undefined;
      if (
        keyName &&
        renameTarget?.type === "Identifier" &&
        renameTarget.name &&
        keyName !== renameTarget.name
      ) {
        if (depth === 0) top.push(keyName);
        else nested.push(keyName);
        if (propKey && depth === 0) propKey[keyName] = keyName;
      }
      // #137 值是嵌套 pattern（可包默认值）时的键规则：顶层（无前缀）→
      // 中间键整对象平铺可绑（`card: shape({...})`）；有前缀 → 记源属性路径
      const patternValueKeyRule = (): void => {
        if (!keyName) return;
        if (depth === 0 && prefix.length === 0) {
          top.push(keyName);
          if (propKey) propKey[keyName] = keyName;
        } else {
          pushNestedPath(prefix, keyName, nestedPaths);
        }
      };
      // 属性值是 Identifier → 本层绑定名；默认值（AssignmentPattern）不升层
      // （`{ port = 3000 }` 的 port 仍是顶层契约面）；嵌套 pattern → depth+1
      if (v.type === "Identifier" && v.name) {
        // #137：有前缀 → 内层字段按源属性路径可绑（'card.grade'）
        pushNestedPath(prefix, keyName ?? "", nestedPaths);
        if (depth === 0) {
          top.push(v.name);
          if (propKey && keyName) propKey[v.name] = keyName;
        } else nested.push(v.name);
      } else if (v.type === "AssignmentPattern") {
        const left = v.left as AstParam | undefined;
        // `{a: b = 1}`：b 是顶层绑定，propKey[b]=a；`{a = 1}` 时 left.name===keyName
        if (left?.type === "Identifier" && left.name) {
          pushNestedPath(prefix, keyName ?? "", nestedPaths);
          if (depth === 0) {
            top.push(left.name);
            if (propKey && keyName) propKey[left.name] = keyName;
          } else nested.push(left.name);
        } else if (left && (left.type === "ObjectPattern" || left.type === "ArrayPattern")) {
          // `{card: {grade} = {}}`：键规则同裸嵌套 pattern；默认值包装层
          // 不升 depth、只延伸 prefix（既有语义：内层名仍按本层平铺收集）
          patternValueKeyRule();
          collectPatternNames(
            v,
            top,
            nested,
            depth,
            propKey,
            prefix.concat(keyName ? [keyName] : []),
            nestedPaths,
          );
        } else {
          collectPatternNames(v, top, nested, depth, propKey, prefix, nestedPaths);
        }
      } else if (v.type === "ObjectPattern" || v.type === "ArrayPattern") {
        // 嵌套 pattern：键规则 + 带 prefix P+[K] 递归（depth+1，内层名 → nested）
        patternValueKeyRule();
        collectPatternNames(
          v,
          top,
          nested,
          depth + 1,
          propKey,
          prefix.concat(keyName ? [keyName] : []),
          nestedPaths,
        );
      } else {
        collectPatternNames(v, top, nested, depth + 1, propKey, prefix, nestedPaths);
      }
    }
    return;
  }
  if (p.type === "ArrayPattern") {
    for (const el of p.elements ?? []) {
      if (!el) continue;
      // #137：数组元素无数字段、不做路径寻址——元素子树重置 prefix（fail-closed）
      if (el.type === "Identifier" && el.name) {
        if (depth === 0) top.push(el.name);
        else nested.push(el.name);
      } else if (el.type === "AssignmentPattern") {
        // `[a = 1]` 的 a 仍是本层绑定名
        collectPatternNames(el, top, nested, depth, propKey, [], nestedPaths);
      } else {
        collectPatternNames(el, top, nested, depth + 1, propKey, [], nestedPaths);
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
      const nestedPaths: string[] = [];
      if (left) collectPatternNames(left, top, nested, 0, propKey, [], nestedPaths);
      return {
        kind: "pattern",
        placeholder: `_p${index}`,
        bound: top,
        propKey,
        nested,
        nestedPaths,
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
    const nestedPaths: string[] = [];
    if (p) collectPatternNames(p, top, nested, 0, propKey, [], nestedPaths);
    return {
      kind: "pattern",
      placeholder: `_p${index}`,
      bound: top,
      propKey,
      nested,
      nestedPaths,
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

/**
 * 签名展示名（C4.1 #64）：解构形参渲染为 `{ grade, findings }`，
 * 不落回求值占位 `_p0`——否则读签名的人以为没有契约。
 * 求值/内部键仍用 formalParamDisplayNames（`_p0`）。
 */
export function formalParamSignatureNames(formals: FormalParam[]): string[] {
  return formals.map((f) => {
    switch (f.kind) {
      case "id":
      case "default":
        return f.name;
      case "rest":
        return f.display;
      case "pattern":
        return f.bound.length > 0 ? `{ ${f.bound.join(", ")} }` : f.placeholder;
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
      // #137：嵌套点路径键（'card.grade'）也是合法契约名
      for (const np of f.nestedPaths) out.add(np);
    }
  }
  return out;
}

/**
 * 契约参数名 → 形参定位。
 * - 命中 id/default/rest → 该 index（执法按整参）
 * - 命中 pattern 顶层 bound 名 → 该 pattern index + field（fieldPath 单段）
 * - 命中 placeholder / `_` → pattern index（整对象）
 * - #137：命中嵌套点路径（'card.grade' ∈ nestedPaths）→ index + fieldPath
 *   多段（field 为展示用点连接串）。平铺精确匹配必须先于任何点路径解析：
 *   源键 'a.b' 与路径 'a.b' 不可歧义——平铺胜。
 * - 未命中 → undefined（C4.5 param-mismatch）
 */
export function locateContractParam(
  formals: FormalParam[],
  contractName: string,
):
  | { index: number; field?: string; fieldPath?: string[]; rest?: boolean }
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
        const field = f.propKey?.[contractName] ?? contractName;
        return { index: f.index, field, fieldPath: [field] };
      }
    }
  }
  // #137：点路径精确匹配（所有平铺面未命中后才解析——平铺胜）
  for (const f of formals) {
    if (f.kind === "pattern" && f.nestedPaths.includes(contractName)) {
      return { index: f.index, field: contractName, fieldPath: contractName.split(".") };
    }
  }
  return undefined;
}
