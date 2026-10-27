/**
 * C4.1：函数形参表面（contract surface）——
 * 侧车 `fn({…})` / `@nudo:contract` 参数名与求值形参的对齐基线。
 *
 * - Identifier / 默认参（AssignmentPattern left）→ 绑定名
 * - RestElement → 契约名用裸名（`args`），展示名 `...args`
 * - ObjectPattern / ArrayPattern → 求值占位 `_p{i}`；契约面 = 顶层绑定名
 *   （对象属性 / 数组元素 Identifier）。嵌套 pattern 的绑定名标 `nested`，
 *   消费方可显式降级（C4.5 param-mismatch / 不执法）。
 *
 * Bug 479：`tsType` 携带**源码里的 TS 声明类型文本**（剥除 pass 留下的旁路
 * `nudoTypeText`）——`.ts` 源的形参据此不是「无约束 any」。
 *
 * Bug 388：`kind: "pattern"` 同时覆盖 `ObjectPattern` 与 `ArrayPattern`
 * ⇒ 模型层**记录模式种类**（`patternKind`），渲染层（签名面）与执法层
 * （契约寻址）才能区分「按属性键寻址」与「按下标寻址」。
 *
 * Bug 397：TS 的 `this: T` 是**接收者标注**，不是运行时形参（Babel AST 里
 * 就是 `Identifier("this")`）⇒ 不进形参表、不占实参位。
 *
 * Bug 399：默认形参**可省略** ⇒ 形参表带 `optional` 标记（消费侧据此算
 * 必选元数，不再靠名字后缀猜）。
 */

export type FormalParam =
  | {
      kind: "id";
      name: string;
      index: number;
      tsType?: string;
      /** 该形参位可省略（Bug 399）：true = 不计入必选元数 */
      optional?: boolean;
    }
  | {
      kind: "default";
      name: string;
      index: number;
      tsType?: string;
      /** 默认形参恒可省略（Bug 399） */
      optional?: boolean;
    }
  | {
      kind: "rest";
      name: string;
      display: string;
      index: number;
      tsType?: string;
      /** rest 形参恒可省略（Bug 399） */
      optional?: boolean;
      /**
       * S6-1008：rest 形参的**元数信息**（本函数接受的实参个数域）。
       *
       * - `min`：**必选元数**——rest 之前**必选**形参的个数（默认形参 /
       *   带默认值的解构形参可省略 ⇒ 不计；TS 的 `this` 接收者标注不是形参
       *   ⇒ 不计）。
       * - `variadic`：**变长**——rest 吸收 0..n 个实参 ⇒ 元数**无上界**
       *   （「真正变长」由 core 建模 ⇒ 消费方不再各自按名字后缀猜）。
       *
       * 缺省 = undefined（未建模 ⇒ 消费方按既有「定长」口径处理）。
       */
      arity?: { min: number; variadic: true };
    }
  | {
      kind: "pattern";
      /** 求值/签名占位名（generalize 与 dts 用） */
      placeholder: string;
      /**
       * 模式种类（Bug 388）：
       * - `"object"` = 对象解构（契约面按**属性键**寻址）
       * - `"array"` = 数组解构（契约面按**元素下标**寻址）
       * 缺省 = `"object"`（历史口径）。
       */
      patternKind?: "object" | "array";
      /** 顶层可表达绑定名（侧车契约面） */
      bound: string[];
      /**
       * 契约名 → 对象属性键。rename `{a: b}` 时契约可写 a 或 b，
       * 投影必须用属性键 a（Abs 对象只有 slot a）。
       */
      propKey: Record<string, string>;
      /**
       * 数组解构：绑定名 → **元素下标**（`[a, b]` ⇒ a→0、b→1）。
       * 对象解构不用这张表（对象解构按属性键寻址，见 `propKey`）。
       */
      boundIndex?: Record<string, number>;
      /** 仅嵌套内出现、顶层不可单独表达的名（降级用） */
      nested: string[];
      /**
       * #137：嵌套解构点路径契约面（'card.grade'，源属性键点连接）。
       * 中间键（card）同时在 bound 里平铺可绑（整对象 shape 契约）。
       */
      nestedPaths: string[];
      index: number;
      /** TS 声明类型文本（.ts 源；缺省 = 无注解） */
      tsType?: string;
      /** 带默认值的解构形参（`{ a } = {}`）可省略（Bug 399） */
      optional?: boolean;
    };

type AstParam = {
  type: string;
  name?: string;
  left?: AstParam;
  right?: unknown;
  argument?: AstParam;
  /** Bug 479：剥除 pass 留下的类型注解文本旁路 */
  nudoTypeText?: string;
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
  /**
   * Bug 388：数组解构的**元素下标**表（绑定名 → 下标）。
   * 只在**顶层**数组模式（depth === 0）填——嵌套数组的元素不是顶层契约面。
   */
  boundIndex: Record<string, number>,
): void {
  if (!p) return;
  if (p.type === "Identifier" && p.name) {
    if (depth === 0) top.push(p.name);
    else nested.push(p.name);
    return;
  }
  if (p.type === "AssignmentPattern") {
    // #137：默认值包装层不是路径段——.left 同 prefix 直通
    collectPatternNames(p.left as AstParam, top, nested, depth, propKey, prefix, nestedPaths, boundIndex);
    return;
  }
  if (p.type === "RestElement") {
    collectPatternNames(p.argument as AstParam, top, nested, depth, propKey, prefix, nestedPaths, boundIndex);
    return;
  }
  if (p.type === "ObjectPattern") {
    for (const prop of p.properties ?? []) {
      // RestElement（Babel：{a, ...rest}）字段是 argument，不是 value/key
      if (prop.type === "RestElement" || prop.argument) {
        collectPatternNames(prop.argument as AstParam, top, nested, depth, propKey, prefix, nestedPaths, boundIndex);
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
            boundIndex,
          );
        } else {
          collectPatternNames(v, top, nested, depth, propKey, prefix, nestedPaths, boundIndex);
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
          boundIndex,
        );
      } else {
        collectPatternNames(v, top, nested, depth + 1, propKey, prefix, nestedPaths, boundIndex);
      }
    }
    return;
  }
  if (p.type === "ArrayPattern") {
    // Bug 388：数组解构的元素是**下标**寻址，不是属性键 ⇒ 记下标表
    const elems = p.elements ?? [];
    for (let i = 0; i < elems.length; i++) {
      const el = elems[i];
      if (!el) continue;
      // #137：数组元素无数字段、不做路径寻址——元素子树重置 prefix（fail-closed）
      if (el.type === "Identifier" && el.name) {
        if (depth === 0) {
          top.push(el.name);
          boundIndex[el.name] = i;
        } else nested.push(el.name);
      } else if (el.type === "AssignmentPattern") {
        // `[a = 1]` 的 a 仍是本层绑定名
        const left = el.left as AstParam | undefined;
        if (depth === 0 && left?.type === "Identifier" && left.name) {
          boundIndex[left.name] = i;
        }
        collectPatternNames(el, top, nested, depth, propKey, [], nestedPaths, boundIndex);
      } else {
        collectPatternNames(el, top, nested, depth + 1, propKey, [], nestedPaths, boundIndex);
      }
    }
  }
}

/**
 * Bug 479：形参的 TS 声明类型文本（剥除 pass 的旁路 `nudoTypeText`）。
 * 无注解（.js 源 / 未标注）⇒ undefined ⇒ 形参仍是「无约束 any」。
 */
function tsTypeOf(p: AstParam | undefined): { tsType?: string } {
  const t = p?.nudoTypeText;
  return t ? { tsType: t } : {};
}

export function formalParamsFromNodes(
  params: AstParam[] | undefined | null,
  source?: string,
): FormalParam[] {
  const list = params ?? [];
  const out: FormalParam[] = [];
  for (const p of list) {
    // index = **形参表内**的位置（与 formalParamDisplayNames / generalize 的
    // params 数组同序）——`this` 标注被跳过后，后续形参的位置要跟着前移。
    const index = out.length;
    if (p?.type === "Identifier" && p.name) {
      /**
       * Bug 397：TS 的 `this: T` 是**接收者标注**，不是运行时形参——
       * Babel 的 TS 插件把它解析成普通 `Identifier("this")`（不是
       * TSParameterProperty），与真形参在 AST 层无法区分。
       *
       * 判据用标识符文本即可：`this` 是 JS 保留字，不可能有同名真形参
       * （`function f(this) {}` 是语法错误）⇒ 名字是 `this` ⇒ 接收者标注。
       * 与 harvester 路径（Bug 794，TypeScript 编译器 API）同口径。
       *
       * 跳过 ⇒ 不进形参表、不占实参位（形参表少一槽 ⇒ dts / zod /
       * standard / case 四个产物面同时对齐）。
       */
      if (p.name === "this") continue;
      out.push({ kind: "id", name: p.name, index, optional: false, ...tsTypeOf(p) });
      continue;
    }
    if (p?.type === "AssignmentPattern") {
      const left = p.left as AstParam | undefined;
      if (left?.type === "Identifier" && left.name) {
        // 默认值的类型注解挂在 left（`b: number = 1`）
        // Bug 399：默认形参可省略 ⇒ optional 标记
        out.push({ kind: "default", name: left.name, index, optional: true, ...tsTypeOf(left) });
        continue;
      }
      // 默认 + pattern：按 pattern 处理，占位 `_p{i}`
      const top: string[] = [];
      const nested: string[] = [];
      const propKey: Record<string, string> = {};
      const nestedPaths: string[] = [];
      const boundIndex: Record<string, number> = {};
      if (left) collectPatternNames(left, top, nested, 0, propKey, [], nestedPaths, boundIndex);
      out.push({
        kind: "pattern",
        placeholder: `_p${index}`,
        // Bug 388：默认 + pattern 时模式种类看 left（`[a] = []` ⇒ array）
        patternKind: left?.type === "ArrayPattern" ? "array" : "object",
        bound: top,
        propKey,
        boundIndex,
        nested,
        nestedPaths,
        index,
        // Bug 399：带默认值的解构形参可省略
        optional: true,
        ...tsTypeOf(p),
      });
      continue;
    }
    if (p?.type === "RestElement") {
      const arg = p.argument as AstParam | undefined;
      const name =
        arg?.type === "Identifier" && arg.name ? arg.name : `arg${index}`;
      // rest 的注解挂在 **RestElement 节点**上（`...rest: string[]`）——
      // Babel 8 不像 Identifier 那样把 typeAnnotation 挂到内层标识符。
      // 旧实现只读内层 ⇒ rest 形参恒丢声明类型（Bug 479 的 rest 缺口）。
      // 两处都读：先节点（当前 Babel 口径），再内层（老口径兜底）。
      const tsType = tsTypeOf(p);
      // S6-1008：rest 形参的**元数信息**——必选元数 = rest 之前**必选**形参
      // 的个数（`optional !== true` 的位；默认形参 / 带默认值的解构形参可省
      // ⇒ 不计；`this` 标注已被跳过 ⇒ 不计）；rest 吸收 0..n 个实参 ⇒
      // **变长**（元数无上界）。core 侧建模 ⇒ 消费方不必再按名字后缀猜。
      const minArity = out.reduce(
        (n, f) => (f.optional === true ? n : n + 1),
        0,
      );
      out.push({
        kind: "rest",
        name,
        display: `...${name}`,
        index,
        // Bug 399：rest 形参恒可省略
        optional: true,
        arity: { min: minArity, variadic: true },
        ...(tsType.tsType ? tsType : tsTypeOf(arg)),
      });
      continue;
    }
    const top: string[] = [];
    const nested: string[] = [];
    const propKey: Record<string, string> = {};
    const nestedPaths: string[] = [];
    const boundIndex: Record<string, number> = {};
    if (p) collectPatternNames(p, top, nested, 0, propKey, [], nestedPaths, boundIndex);
    out.push({
      kind: "pattern",
      placeholder: `_p${index}`,
      // Bug 388：模式种类（对象解构按属性键寻址 / 数组解构按下标寻址）
      patternKind: p?.type === "ArrayPattern" ? "array" : "object",
      bound: top,
      propKey,
      boundIndex,
      nested,
      nestedPaths,
      index,
      // 无默认值的解构形参必填
      optional: false,
      ...tsTypeOf(p),
    });
  }
  // BUG-169：TS 可选形参 `b?: T` 的 `?` 标记在 strip-types 阶段就被删掉
  // （它不进 JS 产物）⇒ 只能从**源码文本**判定（与字面量实参扫描共用
  // `tsOptionalParams` 同一判据）。接到 `optional` 之后，产物三面（dts 的
  // `?` / standard 的可选槽 / zod 的 `.optional()`）与 core 的必选元数同源，
  // 不再把源码合法的少实参调用判成必填（TS2554 + 运行时 required 假红）。
  return withOptionalParams(out, tsOptionalParams(params as unknown[] | undefined, source)) ?? out;
}

/**
 * JSDoc `@param {T} [name]` / `@param {T} [name=default]` ⇒ **可选形参**名集合。
 *
 * Bug 1108：JSDoc 约定「方括号包住的名字 = 可省略」⇒
 * `/** @param {number} [x] *\/ function h(x){}` 的 `x` 可省 ⇒ 元数检查不该报
 * 「h expects 1 argument(s), got 0」（假红）。
 *
 * 只认**方括号**形态（`[x]` / `[x=1]`）；`@param {T} x` 是**必填**。
 */
export function jsDocOptionalParams(nodes: Array<unknown>): Set<string> {
  const out = new Set<string>();
  for (const node of nodes) {
    const comments = (node as { leadingComments?: Array<{ value?: string }> } | undefined)
      ?.leadingComments;
    for (const c of comments ?? []) {
      const text = c.value ?? "";
      const re = /@param\s*(?:\{[^}]*\}\s*)?\[([^\]=]+)(?:=[^\]]*)?\]/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const name = (m[1] ?? "").trim();
        if (name) out.add(name);
      }
    }
  }
  return out;
}

/**
 * TS 可选形参 `x?: T` 的名字集合（**从源码文本**判定）。
 *
 * 为什么不用 AST 的 `optional` 标志：parse 阶段的类型擦除（`strip-types.ts`）
 * 会把 TS-only 的 `optional` 字段**删掉**（它不进 JS 产物）⇒ 到这里已经看不到。
 * ⇒ 退到**源码文本**：形参节点的源码片段里，绑定名 / 模式**之后**的 `?` 标记。
 *
 * 判定细则（避免把类型注解里的 `?` 误当可选标记）：
 * - 标识符形参：`<名字>` 之后紧跟 `?`；
 * - 模式形参（`{…}` / `[…]`）：**配对括号之后**紧跟 `?`；
 * - 默认值里的 `?`（`x = c ? 1 : 2`）与类型里的 `?`（`x: (a?: T) => V`）
 *   都不在绑定名之后 ⇒ 不误判。
 */
export function tsOptionalParams(
  params: Array<unknown> | undefined,
  source: string | undefined,
): Set<string> {
  const out = new Set<string>();
  if (!source) return out;
  for (const p of (params ?? []) as Array<Record<string, unknown>>) {
    if (!p) continue;
    const node = p;
    if (node.type === "AssignmentPattern") {
      const left = node.left as Record<string, unknown> | undefined;
      if (left && markIsOptional(source, left)) {
        const name = left.name;
        if (typeof name === "string") out.add(name);
      }
      continue;
    }
    if (!markIsOptional(source, node)) continue;
    if (node.type === "Identifier" && typeof node.name === "string") out.add(node.name);
  }
  return out;
}

/** 形参节点的源码片段里，绑定名 / 模式之后是否有 TS 的 `?` 标记 */
function markIsOptional(
  source: string,
  node: { start?: number; end?: number },
): boolean {
  if (typeof node.start !== "number" || typeof node.end !== "number") return false;
  const text = source.slice(node.start, node.end);
  const trimmed = text.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const open = trimmed[0]!;
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    for (let i = 0; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) return /^\s*\?/.test(trimmed.slice(i + 1));
      }
    }
    return false;
  }
  return /^[A-Za-z_$][\w$]*\s*\?/.test(trimmed);
}

/**
 * 把「可省略」标记合并进形参表（Bug 1108）。
 *
 * 形参表里的 `optional` 位决定**必选元数**（消费侧 `arityFace` 据此算
 * `required`）⇒ TS `x?: T` 与 JSDoc `[x]` 的形参必须标上，否则
 * `h()`（少传实参）被判「expects 1 argument(s), got 0」（假红）。
 *
 * 只改 `kind: "id"` 的位（标识符形参）；默认形参 / rest 形参恒可省略，
 * 解构形参的「可选」语义由模式自身决定（不猜）。
 */
export function withOptionalParams(
  formals: FormalParam[] | undefined,
  optionalNames: ReadonlySet<string>,
): FormalParam[] | undefined {
  if (!formals || formals.length === 0) return formals;
  if (optionalNames.size === 0) return formals;
  let changed = false;
  const out = formals.map((f) => {
    if (f.kind !== "id") return f;
    if (!optionalNames.has(f.name)) return f;
    if (f.optional === true) return f;
    changed = true;
    return { ...f, optional: true };
  });
  return changed ? out : formals;
}

/** 求值/签名用形参名（与 analyzer extractParamNames / dts 对齐） */
export function formalParamDisplayNames(formals: FormalParam[]): string[] {  return formals.map((f) => {
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
 *
 * Bug 388：数组解构渲染为 `[ x, y ]`（与源码的解构形态一致）——
 * 此前对象/数组解构一律渲染 `{ … }`，数组解构的签名面**看得出是对象**。
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
        if (f.bound.length === 0) return f.placeholder;
        // Bug 388：数组解构按下标寻址 ⇒ 渲染成数组形态
        return f.patternKind === "array"
          ? `[ ${f.bound.join(", ")} ]`
          : `{ ${f.bound.join(", ")} }`;
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
 *
 * Bug 388 / 392：命中**数组解构**的顶层 bound 名时，契约面按**元素下标**
 * 寻址（`[a, b]` 的 `a` 是下标 0 的元素），**不是**属性键 ⇒ 返回
 * `fieldIndex`（下标）且**不给** `fieldPath`（fieldPath 是对象 slot 投影路径，
 * 对数组无意义）。执法侧按 `fieldIndex` 投影实参的元素。
 */
export function locateContractParam(
  formals: FormalParam[],
  contractName: string,
):
  | {
      index: number;
      field?: string;
      fieldPath?: string[];
      rest?: boolean;
      /** 数组解构：契约命中的**元素下标**（对象解构无此字段） */
      fieldIndex?: number;
    }
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
        if (f.patternKind === "array") {
          // 数组解构：按下标寻址（不是属性键）——field 只作展示名
          const fieldIndex = f.boundIndex?.[contractName];
          return fieldIndex === undefined
            ? { index: f.index, field: contractName }
            : { index: f.index, field: contractName, fieldIndex };
        }
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
