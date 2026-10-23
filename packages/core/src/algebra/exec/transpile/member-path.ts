/**
 * 成员/下标链 → 可重绑路径（$get/$set/$idx/$idxSet）。
 * computed key 经 transpile-dispatch 调 transpileExpression（避免与 expr.ts 成环）。
 *
 * 不变量（Bug 136 / Bug 190）：
 * - **键与层解耦**：MemberLayer.keySrc 单独携带键的**求值源**，读/写共用同一份
 *   键绑定——计算键**只求值一次**（原生各求值一次）。
 * - **引用求值顺序 = 原生**（对象 → 各层键 → RHS）：RHS 不得提到链外当 IIFE
 *   实参（那会让 RHS 先于引用求值）；链内 RHS 内联在**最内层**时天然排在
 *   引用之后（JS 实参求值序：内层实参先于外层实参）。
 * - **[[Set]] 只落末层**：中间层只取值。原生 `o.a.b = v` 不对 `o.a` 做
 *   [[Set]]（`a` 是 getter 时写的是 getter 返回的对象，绝不写回根——写回会
 *   误触 setter / 只读访问器定抛 TypeError）。
 * - 引擎的**不可变更新**（$set/$del 返回新 Abs）才把新值补写回上层：原生是
 *   就地改，补写只是引擎建模的可见性补偿。
 */
import type { Node, Expression } from "@babel/types";
import type { TranspileOptions } from "./types.ts";
import { emitTranspileExpression } from "./transpile-dispatch.ts";
import { isExpression, symbolKeyOf, constFnNamesOf } from "./helpers.ts";

export type MemberLayer = {
  /**
   * 键的**求值源**（字面量键 → 常量表达式；计算键 → 转译后的表达式源码）。
   * 与 get/set 解耦：读与写共用同一份键绑定（计算键只求值一次）。
   */
  keySrc: string;
  /**
   * 键的 **Abs 形态**（$idx / $del / $delRes 收 Abs 键；$get / $set 收字符串
   * 键）。字面量字符串键 → `$lit("k")`；计算键 → 与 keySrc 同（临时量）。
   */
  keyAbs: string;
  /** 键是否字面量常量（true → 无需绑定临时量） */
  keyConst: boolean;
  /** 读：base[key] */
  get: (base: string, key: string) => string;
  /** 写：base[key] = v */
  set: (base: string, key: string, v: string) => string;
};
/**
 * 可重绑成员路径。
 *
 * - `rootSrc`：根的**读**源（recordPositions 时包 `$nodoPos(name, l, c)`——
 *   位置插桩读）；
 * - `rootTarget`：根的**赋值目标**（裸绑定名 / argsBinding / thisParam）。
 *   写回必须用它——`$nodoPos(o, l, c) = …` 是**非法 JS**（赋值目标不是简单
 *   赋值目标），会让整个模块 new Function 抛 SyntaxError ⇒ fail-closed
 *   （LSP 重放面 recordPositions 常开 ⇒ 带成员写回的模块整体退化为 unknown）。
 */
export type MemberPath = {
  rootSrc: string;
  rootTarget: string;
  layers: MemberLayer[];
  /**
   * 根绑定**是否可重绑**（false = const 绑定，成员写不得重绑根）。
   *
   * 族 59 · W9（台账族 43 遗留 5）：`const F = function(){}; F.prototype = {};`
   * 的写**污染了根绑定**——引擎未建模「const 不可重绑」，成员写走了根绑定
   * 重绑通道。原生：成员写是对**对象**的 [[Set]]，不动绑定 ⇒ 不报错、
   * 根绑定不被污染。收窄口径见 helpers.ts 的 `constFnNamesOf`。
   */
  rootRebindable: boolean;
};

/**
 * 成员/下标链 → 可重绑路径。根必须是标识符（或 transpile this 参数），
 * 其余（调用结果、new 表达式等）不可重绑 → null。
 */
export function memberPathOf(m: { object: Node; property: Node; computed: boolean }, opts: TranspileOptions): MemberPath | null {
  const layers: MemberLayer[] = [];
  let cur: Node = m as unknown as Node;
  let rootSrc: string | null = null;
  let rootTarget: string | null = null;
  // 根绑定可重绑？const 绑定（值是 fn Abs）不可重绑——族 59 · W9
  let rootRebindable = true;
  while (cur.type === "MemberExpression") {
    const mm = cur as unknown as { object: Node; property: Node; computed: boolean };
    const k = mm.property;
    if (mm.computed) {
      if (k.type === "NumericLiteral") {
        layers.unshift({
          keySrc: `$lit(${k.value})`,
          keyAbs: `$lit(${k.value})`,
          keyConst: true,
          get: (b, key) => `$idx(${b}, ${key})`,
          set: (b, key, v) => `$idxSet(${b}, ${key}, ${v})`,
        });
      } else if (k.type === "StringLiteral") {
        layers.unshift({
          keySrc: JSON.stringify(k.value),
          keyAbs: `$lit(${JSON.stringify(k.value)})`,
          keyConst: true,
          get: (b, key) => `$get(${b}, ${key})`,
          set: (b, key, v) => `$set(${b}, ${key}, ${v})`,
        });
      } else if (isExpression(k)) {
        // [Symbol.X] 计算键 → "@@X" 字符串槽（镜像成员读 / 对象字面量计算键
        // 投影——`ai[Symbol.asyncIterator] = fn` 落成可识别槽，Bug 13）；
        // 写入打 Slot.symbolKey 标记（Bug 73——JSON 枚举面不可见）
        const symK = symbolKeyOf(k as unknown as Parameters<typeof symbolKeyOf>[0]);
        if (symK !== null) {
          layers.unshift({
            keySrc: symK,
            // delete 通道的键要**运行时符号值**（$del/$delRes 收 Abs 键；
            // 符号 Abs 经陷阱边界还原成真 symbol——Bug 149）。读/写侧用
            // 投影槽键 "@@X" + symbolKey 标记（$get/$set 收字符串键）。
            keyAbs: `$get(Symbol, ${JSON.stringify((k as unknown as { property: { name: string } }).property.name)})`,
            keyConst: true,
            // Bug 149：读侧同样带 symbolKey 标记——陷阱边界把 "@@X" 还原成
            // 真 symbol（规范 PropertyKey）
            get: (b, key) => `$get(${b}, ${key}, { symbolKey: true })`,
            set: (b, key, v) => `$set(${b}, ${key}, ${v}, { symbolKey: true })`,
          });
        } else {
          layers.unshift({
            // Bug 136：计算键**只求值一次**——键绑到临时量，读/写共用。
            keySrc: emitTranspileExpression(k, opts),
            keyAbs: "",
            keyConst: false,
            get: (b, key) => `$idx(${b}, ${key})`,
            set: (b, key, v) => `$idxSet(${b}, ${key}, ${v})`,
          });
        }
      } else {
        return null;
      }
    } else if (k.type === "Identifier") {
      layers.unshift({
        keySrc: JSON.stringify(k.name),
        keyAbs: `$lit(${JSON.stringify(k.name)})`,
        keyConst: true,
        get: (b, key) => `$get(${b}, ${key})`,
        set: (b, key, v) => `$set(${b}, ${key}, ${v})`,
      });
    } else {
      return null;
    }
    cur = mm.object;
  }
  if (cur.type === "Identifier") {
    // `arguments` 写回根必须是 $arguments 槽（strict 独立映射）；无绑定不可重绑
    if (cur.name === "arguments") {
      if (!opts.argsBinding) return null;
      rootSrc = opts.argsBinding;
      rootTarget = opts.argsBinding;
    } else {
      rootSrc = cur.name;
      rootTarget = cur.name;
      // const 绑定（初始化器是函数表达式）不可重绑——成员写不得重绑根
      // （族 59 · W9：const F = function(){}; F.prototype = {} 污染根绑定）
      if (constFnNamesOf(opts.constNames)?.has(cur.name)) {
        rootRebindable = false;
      }
      // 位置插桩：成员链根 Identifier 记对象位（hover
      // `node` 于 `node.value` → 对象 Abs——臂内 shadow
      // 重绑后解析到窄化值，与槽位插桩同语义）
      // —— 只包**读**源；写回的赋值目标用 rootTarget（裸绑定名）。
      if (opts.recordPositions && cur.loc) {
        rootSrc = `$nodoPos(${cur.name}, ${cur.loc.start.line}, ${cur.loc.start.column})`;
      }
    }
  } else if (cur.type === "ThisExpression" && opts.thisParam) {
    rootSrc = opts.thisParam;
    rootTarget = opts.thisParam;
  } else {
    return null;
  }
  return { rootSrc, rootTarget, layers, rootRebindable };
}

/** 路径读取源：d[i][0] → $idx($idx(d, i), 0) */
export function readPathSrc(p: MemberPath): string {
  return p.layers.reduce((acc, l) => l.get(acc, l.keySrc), p.rootSrc);
}

/**
 * 路径写入源（求值为**新根**）——语句位写回用（defineProperty 目标 /
 * 解构成员目标）。
 *
 * Bug 136 / Bug 190：引用先于值求值；[[Set]] 只落末层（中间层不再写回根
 * ——原生不做中间层 Put，访问器中间层不得被写）。
 */
export function setPathSrc(p: MemberPath, valSrc: string): string {
  return memberWriteRootIfe(p, valSrc);
}

/** 前 j 层的读取源 */
export function readPrefix(p: MemberPath, j: number): string {
  return p.layers.slice(0, j + 1).reduce((acc, l) => l.get(acc, l.keySrc), p.rootSrc);
}

/** 路径「去掉最后一层」的写回源：delete o.a.b ⇒ o = $set(o, "a", $del($get(o,"a"), "b")) */
export function setParentPathSrc(p: MemberPath, valSrc: string): string {
  let acc = valSrc;
  for (let i = p.layers.length - 2; i >= 0; i--) {
    const l = p.layers[i]!;
    const base = i === 0 ? p.rootSrc : readPrefix(p, i - 1);
    acc = l.set(base, l.keySrc, acc);
  }
  return acc;
}

/* ------------------------------------------------------------------ *
 * Bug 136 / Bug 190：路径写入的**发射计划**
 *
 * 形态（自包含 IIFE，语句位）：
 *   (() => {
 *     const __nudoMpRoot = <根引用>;          // 对象（原生第一求值）
 *     const __nudoMpK0 = <键0>;                // 计算键（各一次）
 *     const __nudoMpC0 = $get(__nudoMpRoot, __nudoMpK0);  // 中间层持有者
 *     ...
 *     const __nudoMpK1 = <键1>;
 *     const __nudoMpVal = <RHS>;               // RHS（引用之后 ✓）
 *     const __nudoMpRes = $set(__nudoMpC0, __nudoMpK1, __nudoMpVal);  // 末层 [[Set]]
 *     if (__nudoMpRes !== __nudoMpC0) { …不可变更新补写上层… }
 *     return __nudoMpVal;
 *   })()
 *
 * - 键与持有者按原生顺序交错求值（根 → 键0 → 持有者0 → 键1 → …）；
 * - RHS 落在引用之后（原生顺序）；
 * - 计算键各一次（读/写共用同一绑定）；
 * - [[Set]] 只落末层（中间层只取值）——原生不做中间层 Put。
 * ------------------------------------------------------------------ */

const MP_ROOT = "__nudoMpRoot";
const MP_VAL = "__nudoMpVal";
const MP_OLD = "__nudoMpOld";
const MP_NEW = "__nudoMpNew";
const MP_RES = "__nudoMpRes";
const MP_DELK = "__nudoMpDelK";
const mpKey = (i: number): string => `__nudoMpK${i}`;
const mpHold = (i: number): string => `__nudoMpC${i}`;
const mpProp = (i: number): string => `__nudoMpP${i}`;

/** 路径写入计划（键绑定 + 持有者链 + 末层读写） */
type WritePlan = {
  /** 层数 */
  n: number;
  /** 声明行（根 → 键/持有者交错，原生顺序） */
  decls: string[];
  /** 各层键（临时量名或常量表达式） */
  keys: string[];
  /** 各层键的 Abs 形态（$idx / $del 用） */
  keyAbss: string[];
  /** 中间层持有者变量名（长度 n-1） */
  holders: string[];
  /** 末层持有者表达式 */
  holder: string;
  /** 末层键 */
  lastKey: string;
  /** 末层键（Abs 形态——$del / $delRes 收 Abs 键） */
  lastKeyAbs: string;
  /** 末层读（当前值） */
  read: string;
  /** 末层写：holder[lastKey] = v */
  write: (v: string) => string;
};

/** 计划构建：键绑定 + 持有者链（求值序 = 原生） */
function planOf(p: MemberPath): WritePlan {
  const n = p.layers.length;
  const decls: string[] = [];
  const keys: string[] = [];
  const keyAbss: string[] = [];
  // 根引用（原生第一求值：对象）
  decls.push(`const ${MP_ROOT} = ${p.rootSrc};`);
  let base = MP_ROOT;
  const holders: string[] = [];
  for (let i = 0; i < n; i++) {
    const l = p.layers[i]!;
    let key = l.keySrc;
    let keyAbs = l.keyAbs;
    if (!l.keyConst) {
      // 计算键：绑临时量（只求值一次，读写共用）
      decls.push(`const ${mpKey(i)} = ${l.keySrc};`);
      key = mpKey(i);
      keyAbs = mpKey(i);
    }
    keys.push(key);
    keyAbss.push(keyAbs);
    if (i < n - 1) {
      // 中间层：**只取值**（原生不做中间层 [[Set]]）
      decls.push(`const ${mpHold(i)} = ${l.get(base, key)};`);
      holders.push(mpHold(i));
      base = mpHold(i);
    }
  }
  const holder = n === 1 ? MP_ROOT : base;
  const lastKey = keys[n - 1]!;
  const last = p.layers[n - 1]!;
  return {
    n,
    decls,
    keys,
    keyAbss,
    holders,
    holder,
    lastKey,
    lastKeyAbs: keyAbss[n - 1]!,
    read: last.get(holder, lastKey),
    write: (v: string) => last.set(holder, lastKey, v),
  };
}

/**
 * 不可变更新的**补写链**：新持有者（__nudoMpRes）与旧持有者不同才补写上层
 * ——原生是就地改，补写只是引擎建模的可见性补偿（原生不对中间层做 [[Set]]）。
 */
function propagateLines(p: MemberPath, plan: WritePlan, holderIdx: number, newVal: string, pad: string): string[] {
  const lines: string[] = [];
  const parentBase = holderIdx === 0 ? MP_ROOT : plan.holders[holderIdx - 1]!;
  const parentKey = plan.keys[holderIdx]!;
  const setter = p.layers[holderIdx]!.set;
  if (holderIdx === 0) {
    lines.push(`${pad}${p.rootTarget} = ${setter(parentBase, parentKey, newVal)};`);
    return lines;
  }
  const nextVar = mpProp(holderIdx);
  lines.push(`${pad}const ${nextVar} = ${setter(parentBase, parentKey, newVal)};`);
  lines.push(`${pad}if (${nextVar} !== ${plan.holders[holderIdx - 1]}) {`);
  lines.push(...propagateLines(p, plan, holderIdx - 1, nextVar, `${pad}  `));
  lines.push(`${pad}}`);
  return lines;
}

/** 语句体 IIFE（单行） */
function ife(lines: string[]): string {
  return `(() => { ${lines.join(" ")} })()`;
}

/**
 * 成员路径**写入**的自包含 IIFE（表达式位）。
 *
 * - 引用（根 + 各层键 + 中间层取值）先求值，RHS 后求值（原生顺序，Bug 136）；
 * - 计算键各求值一次（读/写共用绑定）；
 * - [[Set]] 只落末层：中间层**不再写回根**（原生不做中间层 Put——访问器
 *   中间层不得被写：Bug 190）。
 * - 表达式值 = 写入的值（JS 语义）。
 */
export function memberWriteIfe(p: MemberPath, valSrc: string): string {
  const plan = planOf(p);
  const lines = [...plan.decls];
  lines.push(`const ${MP_VAL} = ${valSrc};`);
  if (plan.n === 1) {
    // 单层：原生 [[Set]] 就在根上（写回根 = 新根）
    if (p.rootRebindable) {
      lines.push(`${p.rootTarget} = ${plan.write(MP_VAL)};`);
    } else {
      // const 根：原生成员写**不动绑定**（写是对对象的 [[Set]]）⇒ 不重绑根
      // （族 59 · W9）。单层写就地落（fn Abs 的 $set 就地写）⇒ 写不丢。
      lines.push(`${plan.write(MP_VAL)};`);
    }
  } else {
    lines.push(`const ${MP_RES} = ${plan.write(MP_VAL)};`);
    lines.push(`if (${MP_RES} !== ${plan.holders[plan.n - 2]}) {`);
    lines.push(...propagateLines(p, plan, plan.n - 2, MP_RES, "  "));
    lines.push(`}`);
  }
  lines.push(`return ${MP_VAL};`);
  return ife(lines);
}

/**
 * 成员路径**读-改-写**的自包含 IIFE（复合赋值 / 自增自减）。
 *
 * - 旧值读在引用之后、RHS 之前（原生：GetValue → RHS → PutValue）；
 * - 旧值可先 ToNumeric（自增/自减：原生 oldValue = ToNumeric(GetValue(lref))）；
 * - 表达式值：复合赋值 / 前缀自增 = 新值；后缀自增 = 旧值。
 */
export function memberReadModifyWriteIfe(
  p: MemberPath,
  spec: {
    /** 新值计算（入参 = 旧值变量名） */
    newValueOf: (old: string) => string;
    /** 旧值先 ToNumeric（自增/自减） */
    toNumericOld?: boolean;
    /** 表达式值 = 旧值（后缀自增） */
    valueIsOld?: boolean;
  },
): string {
  const plan = planOf(p);
  const lines = [...plan.decls];
  const oldExpr = spec.toNumericOld ? `$toNumeric(${plan.read})` : plan.read;
  lines.push(`const ${MP_OLD} = ${oldExpr};`);
  lines.push(`const ${MP_NEW} = ${spec.newValueOf(MP_OLD)};`);
  if (plan.n === 1) {
    if (p.rootRebindable) {
      lines.push(`${p.rootTarget} = ${plan.write(MP_NEW)};`);
    } else {
      // const 根：不重绑根（族 59 · W9）——单层写就地落 ⇒ 写不丢
      lines.push(`${plan.write(MP_NEW)};`);
    }
  } else {
    lines.push(`const ${MP_RES} = ${plan.write(MP_NEW)};`);
    lines.push(`if (${MP_RES} !== ${plan.holders[plan.n - 2]}) {`);
    lines.push(...propagateLines(p, plan, plan.n - 2, MP_RES, "  "));
    lines.push(`}`);
  }
  lines.push(`return ${spec.valueIsOld ? MP_OLD : MP_NEW};`);
  return ife(lines);
}

/**
 * 成员路径 **delete** 的自包含 IIFE（表达式位）。
 *
 * - 父对象（末层持有者）与键各只求值一次；
 * - 删除只作用在**持有末层键的那个对象**上：中间层**不再写回根**
 *   （原生不对中间层做 [[Set]]——访问器中间层不得被写，Bug 190）；
 * - 表达式值 = 删除结果（布尔）。
 */
export function memberDeleteIfe(p: MemberPath): string {
  const plan = planOf(p);
  const lines = [...plan.decls];
  // 键只求值一次（$del / $delRes 共用同一绑定——符号键是运行时符号值）
  lines.push(`const ${MP_DELK} = ${plan.lastKeyAbs};`);
  lines.push(`const ${MP_RES} = $del(${plan.holder}, ${MP_DELK});`);
  if (plan.n === 1) {
    if (p.rootRebindable) {
      lines.push(`${p.rootTarget} = ${MP_RES};`);
    } else {
      // const 根：不重绑根（族 59 · W9）
      lines.push(`void ${MP_RES};`);
    }
  } else {
    lines.push(`if (${MP_RES} !== ${plan.holders[plan.n - 2]}) {`);
    lines.push(...propagateLines(p, plan, plan.n - 2, MP_RES, "  "));
    lines.push(`}`);
  }
  lines.push(`return $delRes(${plan.holder}, ${MP_DELK});`);
  return ife(lines);
}

/**
 * 路径写入源（求值为**新根**）——语句位写回用（defineProperty 目标 /
 * 解构成员目标）。引用先于值求值（Bug 136），[[Set]] 只落末层（Bug 190）。
 */
export function memberWriteRootIfe(p: MemberPath, valSrc: string): string {
  const plan = planOf(p);
  const lines = [...plan.decls];
  lines.push(`const ${MP_VAL} = ${valSrc};`);
  if (plan.n === 1) {
    if (p.rootRebindable) {
      lines.push(`${p.rootTarget} = ${plan.write(MP_VAL)};`);
    } else {
      // const 根：不重绑根（族 59 · W9）——单层写就地落 ⇒ 写不丢
      lines.push(`${plan.write(MP_VAL)};`);
    }
  } else {
    lines.push(`const ${MP_RES} = ${plan.write(MP_VAL)};`);
    lines.push(`if (${MP_RES} !== ${plan.holders[plan.n - 2]}) {`);
    lines.push(...propagateLines(p, plan, plan.n - 2, MP_RES, "  "));
    lines.push(`}`);
  }
  lines.push(`return ${p.rootTarget};`);
  return ife(lines);
}
