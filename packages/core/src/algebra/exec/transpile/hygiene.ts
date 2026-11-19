/**
 * BUG-164：转译产物的**模块级算子名卫生**（hygiene / α-重命名）。
 *
 * 失效形态（改前）：生成码一律按**固定名**引用运行时算子（`$add` / `$call`
 * / `$get` / `$copy` / `$toStr` …）。这些名字在宿主单元里是 `new Function`
 * 的**形参**（rt.ts 的 compileRuntimeUnit / compileRuntimeModuleUnit）——
 * 用户代码（或依赖模块）只要在任一作用域里**声明**了同名绑定，就出现两种
 * 假红：
 * - 顶层声明（`function $add(){}` / `const $call = …`）⇒ 与形参**重复
 *   词法声明** ⇒ `new Function` SyntaxError（`Identifier '$x' has already
 *   been declared`）⇒ 整模块 fail-closed；
 * - 形参 / 内层声明（`function f($add){ return 1 + 2 }`）⇒ 生成码的算子
 *   引用被**捕获**到用户绑定 ⇒ 自递归栈溢出或 `$add is not a function`。
 *
 * 修法：**只在本单元确有冲突时**，把冲突算子改名为 gensym（`$call` →
 * `$call$1`，k 从 1 起跳过用户词形），并让宿主侧按同名注入（改名表随代码
 * 以 `//@nudo-op-renames {...}` 注释行传递，见 runtime-import.ts）。**无
 * 冲突时整条通道不发射** ⇒ 产物逐字不变（硬约束：全仓快照 / 差分语料依赖
 * 它）。
 *
 * 为什么需要「占位名」这一跳：生成码里**用户标识符**（`function $add` /
 * 用户自己的 `$add(...)` 调用）与**算子引用**是同形 token，纯文本改写分不开。
 * 故先在**源 AST** 上把冲突名的用户标识符（绑定 + 引用，位置精确——
 * 属性名 / 成员名 / 导出名 / 标签不动）改成占位名 `__nudoHyg{k}`，于是生成
 * 码里剩下的同形 token 必然是算子引用；改完算子后把占位名**文本还原**
 * （用户标识符在产物里仍是原名 ⇒ 导出面 / 宿主 `__nudoSlot(name, () =>
 * name)` 的按名读取全不受影响）。
 *
 * 不变量：
 * - 占位名**新鲜**（避让源词形 ∪ opts.userIdents）⇒ 还原是无歧义的纯文本
 *   替换；源 AST 在发射后**原样还原**（parse-source 的 AST 缓存是进程级
 *   共享的，改完不还会污染同源二次转译）；
 * - 改名只碰**声明名**（collectDeclaredBindingNames）：注释 / 字符串 / 属性
 *   名里提到 `$add` 不算冲突 ⇒ 不触发任何发射改动；
 * - 命名确定性：冲突名按字典序、gensym 后缀从 1 递增 ⇒ 同源同产物；
 * - 生成码里的算子引用恒为**调用位**（`$op(`）——发射器的单一日径；属性
 *   访问（`o.$op(`）与字符串 / 注释里的同形文本一律不动。
 */
import type { Node } from "@babel/types";
import type { TranspileOptions } from "./types.ts";
import { isRuntimeOpName, opRenameMarkerOf } from "./runtime-import.ts";
import { collectPatternNames, userIdentInfoOf } from "./helpers.ts";

/** 一次转译单元的算子卫生结论。 */
export interface OpHygiene {
  /** canonical 算子名 → 生成名（空 = 无冲突，产物逐字不变）。 */
  readonly renames: ReadonlyMap<string, string>;
  /** 源 AST 占位名 → 原用户标识符（发射后文本还原用；空 = 无占位）。 */
  readonly placeholders: ReadonlyArray<readonly [placeholder: string, original: string]>;
  /** 把源 AST 的占位名改回原名（发射完成 / 异常路径都必须调用）。 */
  readonly restoreAst: () => void;
}

const EMPTY_HYGIENE: OpHygiene = {
  renames: new Map(),
  placeholders: [],
  restoreAst: () => {},
};

/**
 * 计算本单元的算子冲突集：**源 AST 里被声明过的**运行时算子名。
 *
 * 只看声明（不是「文本里出现过」）：算子引用被捕获的前提是存在同名绑定；
 * 注释 / 字符串 / 属性名里的 `$add` 不构成捕获 ⇒ 不得触发改名（否则产物
 * 无谓漂移）。
 *
 * 快路径：源词形（含 opts.userIdents）里没有任何运行时算子名 ⇒ 直接空集，
 * 不做 AST 声明扫描（大多数模块走这条路径，零额外开销）。
 */
export function opCollisionNames(
  root: Node | null,
  opts: TranspileOptions,
  scope: "module" | "body",
): string[] {
  const words = userIdentInfoOf(opts).names;
  let hit = false;
  for (const w of words) {
    if (isRuntimeOpName(w)) {
      hit = true;
      break;
    }
  }
  if (!hit) return [];
  // module 面：只认**源 AST 的声明名**（算子引用被捕获的前提是有同名绑定；
  // 只是读过 / 只是属性名里出现过 ⇒ 不算冲突 ⇒ 不触发改名）。body 面：编译
  // 单元的形参（闭包补给名）不在 body AST 里（由调用方塞进 userIdents），
  // 无法区分「形参」与「引用」⇒ 按词形保守取（引用侧同样是危险面：用户
  // 自己对 `$add(...)` 的调用会被算子改名波及，占位名通道保证它还原）。
  const declared = scope === "module" && root !== null ? collectBindingNames(root) : null;
  const out: string[] = [];
  for (const w of words) {
    // 运行时**形参面**全集（含只进绑定表的 MODULE_FACE_ONLY_OPS）：它们都是
    // `new Function` 的形参 ⇒ 与用户声明同名即重复词法声明。
    if (!isRuntimeOpName(w)) continue;
    if (declared !== null && !declared.has(w)) continue;
    out.push(w);
  }
  // 字典序 ⇒ gensym 分配与 opts.userIdents 的插入序无关（同源同产物）
  out.sort();
  return out;
}

/**
 * 全树**绑定名**（任意深度：形参 / 变量声明 / 函数与类名 / catch 形参 /
 * import 本地名 / enum 与 namespace 名）。
 *
 * 只收声明，不收引用：算子引用被捕获的前提是存在同名绑定；注释 / 字符串 /
 * 属性名里的 `$add` 不构成捕获。任意深度的**形参**必须收（
 * `function f($add, x) { return x + 1 }` 的算子引用被形参捕获 ⇒
 * `$add is not a function`），故不复用只看本层的声明扫描。
 */
function collectBindingNames(root: unknown, acc: Set<string> = new Set()): Set<string> {
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (node === null || typeof node !== "object") return;
    const rec = node as Record<string, unknown> & { type?: string };
    const t = rec.type;
    if (t !== undefined) {
      if (
        t === "FunctionDeclaration" ||
        t === "FunctionExpression" ||
        t === "ArrowFunctionExpression" ||
        t === "ObjectMethod" ||
        t === "ClassMethod" ||
        t === "ClassPrivateMethod"
      ) {
        collectPatternNames(rec.id, acc);
        for (const p of (rec.params as unknown[] | undefined) ?? []) collectPatternNames(p, acc);
      } else if (t === "ClassDeclaration" || t === "ClassExpression") {
        collectPatternNames(rec.id, acc);
      } else if (t === "VariableDeclarator") {
        collectPatternNames(rec.id, acc);
      } else if (t === "CatchClause") {
        collectPatternNames(rec.param, acc);
      } else if (
        t === "ImportSpecifier" ||
        t === "ImportDefaultSpecifier" ||
        t === "ImportNamespaceSpecifier"
      ) {
        collectPatternNames(rec.local, acc);
      } else if (t === "TSEnumDeclaration" || t === "TSModuleDeclaration") {
        collectPatternNames(rec.id, acc);
      } else if (t === "TSParameterProperty") {
        collectPatternNames(rec.parameter, acc);
      }
    }
    for (const key of Object.keys(rec)) {
      if (SKIP_WALK_KEYS.has(key)) continue;
      const child = rec[key];
      if (child === null || typeof child !== "object") continue;
      visit(child);
    }
  };
  visit(root);
  return acc;
}

/**
 * 冲突算子的 gensym：`$call` → `$call$1`（k 从 1 起，跳过已占用词形与已
 * 分配名）。`$` 是合法标识符字符 ⇒ 生成名仍是普通标识符。
 */
function gensymOp(base: string, taken: ReadonlySet<string>): string {
  let k = 1;
  while (taken.has(`${base}$${k}`)) k++;
  return `${base}$${k}`;
}

/**
 * 准备（必要时**就地**改写源 AST）本单元的算子卫生。
 *
 * 无冲突时返回空结论且不碰 AST（产物逐字不变）。有冲突时：
 * 1. 给每个冲突算子分配 gensym（`renames`）；
 * 2. 把源 AST 里这些名字的**用户标识符**改成占位名 `__nudoHyg{k}`；
 * 3. 返回 restoreAst（调用方在发射后（含异常）还原）。
 */
export function prepareOpHygiene(
  root: Node | null,
  opts: TranspileOptions,
  scope: "module" | "body" = "module",
): OpHygiene {
  const collisions = opCollisionNames(root, opts, scope);
  if (collisions.length === 0) return EMPTY_HYGIENE;
  const words = userIdentInfoOf(opts).names;
  const renames = new Map<string, string>();
  const taken = new Set<string>(words);
  for (const name of collisions) {
    const gen = gensymOp(name, taken);
    taken.add(gen);
    renames.set(name, gen);
  }
  const placeholders: Array<[string, string]> = [];
  const toPlaceholder = new Map<string, string>();
  if (root !== null) {
    let seq = 0;
    for (const name of collisions) {
      let ph = `__nudoHyg${seq}`;
      while (taken.has(ph)) {
        seq++;
        ph = `__nudoHyg${seq}`;
      }
      seq++;
      taken.add(ph);
      toPlaceholder.set(name, ph);
      placeholders.push([ph, name]);
    }
    renameIdentsInPlace(root, toPlaceholder);
  }
  const restoreAst = (): void => {
    if (root === null || placeholders.length === 0) return;
    const back = new Map<string, string>();
    for (const [ph, orig] of placeholders) back.set(ph, orig);
    renameIdentsInPlace(root, back);
  };
  return { renames, placeholders, restoreAst };
}

/**
 * 收尾：算子引用改成生成名 → 占位名文本还原 → 打上改名表标记行。
 * 无冲突时**原样返回**（逐字不变）。
 */
export function finalizeOpHygiene(code: string, hygiene: OpHygiene): string {
  if (hygiene.renames.size === 0 && hygiene.placeholders.length === 0) return code;
  let out = hygiene.renames.size > 0 ? renameOpRefs(code, hygiene.renames) : code;
  for (const [ph, orig] of hygiene.placeholders) {
    // 占位名新鲜 ⇒ split/join 无歧义；还原同时覆盖标识符位与由它派生的
    // 字符串（导出名 / 绑定表键都是源名的 JSON 文本）。
    out = out.split(ph).join(orig);
  }
  if (hygiene.renames.size > 0) out = `${opRenameMarkerOf(hygiene.renames)}\n${out}`;
  return out;
}

// ---------------------------------------------------------------------------
// 生成码：算子引用改名（词法级）
// ---------------------------------------------------------------------------

/** 空白判定（词法扫描用；不用正则 ⇒ 热路径零分配）。 */
function isSpace(c: number): boolean {
  return c === 32 || c === 9 || c === 10 || c === 13;
}

/**
 * 生成码里的算子引用改名。
 *
 * 口径：只认**调用位**标识符（`$op(` 且前一个有效字符不是 `.`——属性 / 可选
 * 链属性名不动），并跳过注释 / 字符串 / 模板（含 `${}` 内的代码递归）。发
 * 射器的算子引用恒为调用位（`$op(...)`），故本口径完整覆盖发射面。
 */
function renameOpRefs(code: string, renames: ReadonlyMap<string, string>): string {
  const out: string[] = [];
  const n = code.length;
  let i = 0;
  /** 上一个有效（非空白、非注释）字符，用于区分 `o.$op` 属性位 */
  let prev = "";
  /** 模板字面量 / `${}` 嵌套栈：true = 模板原文，false = 代码 */
  const stack: boolean[] = [false];
  /** 当前代码帧的花括号深度（`}` 归零时若在模板内 ⇒ 回到模板帧） */
  const depths: number[] = [0];
  const isIdentStart = (c: string): boolean =>
    (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_" || c === "$";
  const isIdentPart = (c: string): boolean =>
    isIdentStart(c) || (c >= "0" && c <= "9");
  while (i < n) {
    const ch = code[i];
    // 模板原文帧：只认 ` 与 ${
    if (stack[stack.length - 1] === true) {
      if (ch === "\\") {
        out.push(code.slice(i, i + 2));
        i += 2;
        continue;
      }
      if (ch === "`") {
        out.push(ch);
        stack.pop();
        depths.pop();
        i++;
        prev = "`";
        continue;
      }
      if (ch === "$" && code[i + 1] === "{") {
        out.push("${");
        stack.push(false);
        depths.push(0);
        i += 2;
        prev = "{";
        continue;
      }
      out.push(ch);
      i++;
      continue;
    }
    // 代码帧
    if (ch === "/" && code[i + 1] === "/") {
      const nl = code.indexOf("\n", i);
      const end = nl === -1 ? n : nl;
      out.push(code.slice(i, end));
      i = end;
      continue;
    }
    if (ch === "/" && code[i + 1] === "*") {
      const close = code.indexOf("*/", i + 2);
      const end = close === -1 ? n : close + 2;
      out.push(code.slice(i, end));
      i = end;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < n) {
        if (code[j] === "\\") {
          j += 2;
          continue;
        }
        if (code[j] === ch) {
          j++;
          break;
        }
        j++;
      }
      out.push(code.slice(i, j));
      i = j;
      prev = ch;
      continue;
    }
    if (ch === "`") {
      out.push(ch);
      stack.push(true);
      depths.push(0);
      i++;
      prev = "`";
      continue;
    }
    if (ch === "{") {
      depths[depths.length - 1]++;
      out.push(ch);
      i++;
      prev = "{";
      continue;
    }
    if (ch === "}") {
      if (depths[depths.length - 1] === 0 && stack.length > 1) {
        // `${ … }` 结束 ⇒ 回模板原文帧
        stack.pop();
        depths.pop();
        out.push(ch);
        i++;
        prev = "}";
        continue;
      }
      depths[depths.length - 1]--;
      out.push(ch);
      i++;
      prev = "}";
      continue;
    }
    if (isIdentStart(ch)) {
      let j = i + 1;
      while (j < n && isIdentPart(code[j])) j++;
      const tok = code.slice(i, j);
      const to = prev === "." ? undefined : renames.get(tok);
      if (to !== undefined) {
        let k = j;
        while (k < n && isSpace(code.charCodeAt(k))) k++;
        if (code[k] === "(") {
          out.push(to);
          i = j;
          prev = "i";
          continue;
        }
      }
      out.push(tok);
      i = j;
      prev = "i";
      continue;
    }
    if (!isSpace(ch.charCodeAt(0))) prev = ch;
    out.push(ch);
    i++;
  }
  return out.join("");
}

// ---------------------------------------------------------------------------
// 源 AST：用户标识符 ⇄ 占位名
// ---------------------------------------------------------------------------

/**
 * 非「值位置」的子键（属性名 / 成员名 / 导出名 / 标签 / 枚举成员键）——
 * 这些位置上的同名 Identifier **不是引用也不是绑定**，改名会改语义
 * （`o.$call` 的属性名、`export { x as $call }` 的公开名）。`computed` 为
 * 真时（`o[expr]` / `{ [expr]: v }`）该键是表达式 ⇒ 必须改名。
 */
const NON_VALUE_CHILD_KEYS: Readonly<Record<string, ReadonlySet<string>>> = {
  MemberExpression: new Set(["property"]),
  OptionalMemberExpression: new Set(["property"]),
  ObjectProperty: new Set(["key"]),
  ObjectMethod: new Set(["key"]),
  ClassMethod: new Set(["key"]),
  ClassProperty: new Set(["key"]),
  ClassPrivateProperty: new Set(["key"]),
  ClassAccessorProperty: new Set(["key"]),
  ClassPrivateMethod: new Set(["key"]),
  ExportSpecifier: new Set(["exported"]),
  ImportSpecifier: new Set(["imported"]),
  LabeledStatement: new Set(["label"]),
  BreakStatement: new Set(["label"]),
  ContinueStatement: new Set(["label"]),
  TSEnumMember: new Set(["id"]),
  MetaProperty: new Set(["meta", "property"]),
  PrivateName: new Set(["id"]),
};

/** 遍历键里不需要下钻的非节点字段。 */
const SKIP_WALK_KEYS: ReadonlySet<string> = new Set([
  "loc",
  "start",
  "end",
  "range",
  "extra",
  "type",
]);

/**
 * 就地改源 AST 里匹配 `map` 的 Identifier 名（绑定与引用一起改 ⇒ 名字替换
 * 是双射，作用域结构不变）。简写属性 / 简写模式（`{ x }` / `{ x = 1 }`）在
 * 键值分叉时置 `shorthand = false`，保证属性名（键）不被改名拖走。
 */
function renameIdentsInPlace(root: unknown, map: ReadonlyMap<string, string>): void {
  if (map.size === 0) return;
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (node === null || typeof node !== "object") return;
    const rec = node as Record<string, unknown> & { type?: string };
    if (rec.type === "Identifier") {
      const to = map.get(rec.name as string);
      if (to !== undefined) rec.name = to;
      return;
    }
    const skip = rec.type === undefined ? undefined : NON_VALUE_CHILD_KEYS[rec.type];
    const computed = rec.computed === true;
    for (const key of Object.keys(rec)) {
      if (SKIP_WALK_KEYS.has(key)) continue;
      const child = rec[key];
      if (child === null || typeof child !== "object") continue;
      if (skip !== undefined && skip.has(key) && !computed) continue;
      visit(child);
    }
    if (rec.type === "ObjectProperty" && rec.shorthand === true) {
      const keyName = (rec.key as { name?: unknown } | undefined)?.name;
      const valueName = (rec.value as { name?: unknown } | undefined)?.name;
      if (typeof keyName === "string" && typeof valueName === "string" && keyName !== valueName) {
        rec.shorthand = false;
      }
    }
  };
  visit(root);
}
