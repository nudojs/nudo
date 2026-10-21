/**
 * 模式解构 / 形参绑定 / 语句位写回（defineProperty/delete）/ fork 臂 thunk。
 * 数组 mutator 已改为 $invoke 调用点就地变更（Bug 49/51），不再语句位重绑。
 * 发射时经 transpile-dispatch 调 transpileExpression（避免与 expr.ts 成环）。
 *
 * 不变量（解构临时名，@nudo:as / @nudo:replace 指令面无关）：
 * - 发射的解构临时名（`_d{n}` / `_n{n}` / `_p{i}` / `_rest{i}` / `_pd{i}`）
 *   **必须避开用户标识符**（源文本里出现过的词形，保守超集）：撞名会让
 *   生成码出现重复声明（SyntaxError ⇒ 整模块求值失败 ⇒ 导出退化为
 *   unknown）或**遮蔽**用户绑定（错值）——见 Bug 181。
 * - 共享计数器（`opts.destrTmpSeq`）跨语句/跨形参唯一：`_d{n}`（语句位
 *   init 临时）与 `_n{n}`（子模式临时）共用同一序号源，不得各自新建。
 */
import type { Statement, Expression, Node } from "@babel/types";
import type { TranspileOptions } from "./types.ts";
import { emitTranspileExpression } from "./transpile-dispatch.ts";
import { isExpression, foldRequireSpecArg, staticKeyOf, isConstAssignTarget, symbolKeyOf, userIdentInfo, bumpDestrTmpSeq, safeTmpName } from "./helpers.ts";
import { memberPathOf, readPathSrc, setPathSrc, readPrefix, setParentPathSrc } from "./member-path.ts";
import type { MemberPath } from "./member-path.ts";
import { STRING_REGEX_ARG_STATE_NAMES } from "./ops.ts";
import { NudoUnsupportedError } from "../unsupported.ts";

/**
 * 解构目标是成员表达式（`[o.x] = src` / `({ p: o.x } = src)`）：逐项写回成员。
 * 可重绑根（标识符 / this 参数）走不可变更新链（与直接成员赋值同口径）；
 * 根不可重绑（`foo().x`）落 $set/$idxSet 副作用语句——解构表达式的值是 RHS，
 * 语句位无人消费写入值。此前成员目标被静默跳过（emitDestructure 只认
 * Identifier），写丢失后 `o.x` 读折 exact undefined（Bug 10 修复把该
 * imprecision 从 number|string 并集引爆成 exact NaN 后由差分抓到）。
 */
function emitMemberTargetAssign(
  target: Node,
  valueSrc: string,
  pad: string,
  opts: TranspileOptions,
  out: string[],
): void {
  const m = target as unknown as Parameters<typeof memberPathOf>[0] & {
    loc?: { start: { line: number; column: number } };
  };
  const path = memberPathOf(m, opts);
  if (path) {
    out.push(`${pad}${path.rootTarget} = ${setPathSrc(path, valueSrc)};`);
    return;
  }
  const obj = emitTranspileExpression(m.object as Expression, opts);
  if (!m.computed && m.property.type === "PrivateName") {
    const priv =
      (m.property as { id?: { name?: string }; name?: string }).id?.name
      ?? (m.property as { name?: string }).name;
    if (!priv) {
      throw new NudoUnsupportedError("assign-target", m.loc ? { line: m.loc.start.line, column: m.loc.start.column } : undefined);
    }
    out.push(`${pad}$set(${obj}, ${JSON.stringify(`#${priv}`)}, ${valueSrc});`);
    return;
  }
  if (!m.computed && m.property.type === "Identifier") {
    out.push(`${pad}$set(${obj}, ${JSON.stringify((m.property as { name: string }).name)}, ${valueSrc});`);
    return;
  }
  if (m.computed) {
    const k = m.property;
    if (k.type === "NumericLiteral") {
      out.push(`${pad}$idxSet(${obj}, $lit(${(k as { value: number }).value}), ${valueSrc});`);
      return;
    }
    if (k.type === "StringLiteral") {
      out.push(`${pad}$set(${obj}, ${JSON.stringify((k as { value: string }).value)}, ${valueSrc});`);
      return;
    }
    if (isExpression(k)) {
      const symK = symbolKeyOf(k as Parameters<typeof symbolKeyOf>[0]);
      if (symK !== null) {
        // Bug 73：symbol 键投影写打 Slot.symbolKey 标记（JSON 枚举面不可见）
        out.push(`${pad}$set(${obj}, ${symK}, ${valueSrc}, { symbolKey: true });`);
        return;
      }
      out.push(`${pad}$idxSet(${obj}, ${emitTranspileExpression(k, opts)}, ${valueSrc});`);
      return;
    }
  }
  throw new NudoUnsupportedError("assign-target", m.loc ? { line: m.loc.start.line, column: m.loc.start.column } : undefined);
}

/**
 * Bug 140：原生数组解构 = GetIterator + IteratorNext。
 *
 * 接收者是**用户 iterable**（对象带自有 `@@iterator` 槽）时，元素按**迭代序**
 * 取，**不是**按索引读。此前解构 lowering 一律走 `$idx(recv, i)`（按索引属性
 * 读）——对用户 iterable 读到的是索引槽（多半没有）⇒ 折出**确定 undefined**
 * （精确错值：原生是迭代序的第 2 个值）。
 *
 * 引擎侧的用户迭代协议在 `exec/runtime/containers/iterate.ts`：`$iterCheck`
 * 兼做两件事——①可迭代性守卫（非可迭代 → TypeError）；②返回**用户 iterable 的
 * 迭代序元素读取器**（非用户 iterable → null ⇒ 生成码走既有 `$idx` /
 * `$arrRest` 快速路径：tuple / 数组 / 字符串 / Set / Map / 生成器 / `$tpl` /
 * 数组迭代器…逐字不变）。
 *
 * 读取器按需取：模式有 n 个位置就取 n 个元素（原生空位也消耗一个迭代步），
 * 有 rest 则取到 done（运行时步数上界兜底，超界折 unknown）。
 */

/**
 * Bug 111：delete o?.a 链的 OptionalMemberExpression 节点按普通 member 层
 * 处理——object 链递归替换 type（memberPathOf 只读 type/object/property/
 * computed，property/computed 子树浅拷贝原样）；nullish 短路语义由调用方的
 * fork 守卫单独表达，层本身无差别。
 */
function memberChainSansOptional(n: Node): Node {
  if ((n as { type?: string }).type !== "OptionalMemberExpression") return n;
  return {
    ...(n as unknown as Record<string, unknown>),
    type: "MemberExpression",
    object: memberChainSansOptional((n as unknown as { object: Node }).object),
  } as unknown as Node;
}

/**
 * 语句位写回收集（历史名保留）：defineProperty/defineProperties 第一实参
 * 与 delete 成员路径的绑定写回。数组 mutator 的写回已随 Bug 49/51 的
 * $invoke 就地变更移除（此处不再发射 $arrMutContainer 行）。
 */
export function emitArrMutatorRebinds(
  expr: Node | null | undefined,
  opts: TranspileOptions,
  pad: string,
): string[] {
  const lines: string[] = [];
  if (!expr || typeof expr !== "object") return lines;
  const visit = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    const node = n as {
      type?: string;
      callee?: { type?: string; object?: Node; property?: Node; computed?: boolean };
      arguments?: unknown[];
      [k: string]: unknown;
    };
    if (
      node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression" ||
      node.type === "ObjectMethod" ||
      node.type === "ClassMethod"
    ) {
      return; // 函数边界：体内 mutator 不在本语句重绑
    }
    if (node.type === "LogicalExpression" || node.type === "ConditionalExpression") {
      return; // 短路臂：由表达式级 $fork + arm snapshot 负责
    }
    if (
      node.type === "AssignmentExpression" &&
      (node.operator === "||=" || node.operator === "&&=" || node.operator === "??=")
    ) {
      // 逻辑赋值 RHS 由短路 fork 隔离；语句级不得再无条件写回（P0-5）
      visit((node as { left?: unknown }).left);
      return;
    }
    // 数组 mutator（push/pop/…）不再需要语句位写回：$invoke 在调用点经
    // $arrMutContainer 就地变更（Bug 49/51——表达式内连续 mutator 按求值
    // 顺序生效；非可重绑接收者 m.get(k).push(x) 经共享容器别名持久）。
    // 下方仅保留**可选链** delete 的语句位写回。
    // Bug 137/176：Object.defineProperty / defineProperties 的写回**下沉到
    // 求值点**（表达式位自包含 IIFE：实参只求值一次 + 写回同点完成）——
    // 语句位不得再重发整条调用（实参副作用翻倍），也不得把写回推迟到整条
    // 语句之后（同表达式内后续读看到变更前的状态）。
    // delete obj[key] / delete o?.a：语句位置把删键后的容器写回绑定（表达式
    // 值 $delRes 由 transpile 负责）。Bug 111：OptionalMemberExpression 形
    // （delete o?.a）此前不匹配该 pass——表达式值对但从未真删（$delRes 是
    // 非变更值通道）；写回经 nullish 守卫 fork：守卫真（链短路）保根原值，
    // 假（链走通）从去 nullish 的守卫基删键写回。
    if (
      node.type === "UnaryExpression" &&
      (node as { operator?: string }).operator === "delete" &&
      (node as { argument?: unknown }).argument &&
      (((node as { argument?: unknown }).argument as { type?: string }).type === "MemberExpression" ||
        ((node as { argument?: unknown }).argument as { type?: string }).type ===
          "OptionalMemberExpression")
    ) {
      const m = (node as { argument: unknown }).argument as unknown as {
        object: Node;
        property: Node;
        computed: boolean;
        type: string;
      };
      // optional 链按普通 member 层处理（memberPathOf 只读 type/object/
      // property/computed；nullish 短路语义由外层 fork 守卫单独表达）
      const path = memberPathOf(
        (m.type === "OptionalMemberExpression"
          ? memberChainSansOptional(m as unknown as Node)
          : m) as Parameters<
          typeof memberPathOf
        >[0],
        opts,
      );
      if (path) {
        // 求值序首个 optional hop 的层号（链上 `?.` 跳点节点带 optional
        // 标记——其后的外层链接同为 OptionalMemberExpression 类型但无标记；
        // walk 深度 s 的标记节点对应层 N-1-s，其 object 即守卫基）；-1 = 无
        let guardLayer = -1;
        if (m.type === "OptionalMemberExpression") {
          let cur: unknown = m;
          let s = 0;
          while (cur && typeof cur === "object") {
            const c = cur as { type?: string; optional?: boolean; object?: unknown };
            if (c.type === "OptionalMemberExpression" && c.optional === true) {
              guardLayer = path.layers.length - 1 - s;
              break;
            }
            if (c.type !== "MemberExpression" && c.type !== "OptionalMemberExpression") break;
            cur = c.object;
            s++;
          }
        }
        // Bug 176：**非**可选链的 delete 写回已下沉到**求值点**（表达式位
        // 自包含 IIFE：删除与布尔值同点产出）——语句位不得再写（否则写回被
        // 推迟到整条语句之后，同表达式内后续读看到变更前的状态）。
        if (guardLayer >= 0) {
          const parentRead =
            path.layers.length >= 2 ? readPrefix(path, path.layers.length - 2) : path.rootSrc;
          // 注意：computed key 在此二次求值（副作用型 key 表达式会重复；
          // 与数组 mutator 参数的重绑口径一致，罕见形态接受）
          const keySrc = m.computed
            ? emitTranspileExpression(m.property as Expression, opts)
            : `$lit(${JSON.stringify((m.property as { name: string }).name)})`;
          // 守卫基 = 首个 optional hop 的 object 读；删键链从 $removeNullish
          // 收窄后的守卫基重建（守卫抽象时 sum 的 nullish 成员不得进 del 臂，
          // 否则误记 may-throw——原生 delete o?.a 恒不抛）
          const guardSrc = guardLayer === 0 ? path.rootSrc : readPrefix(path, guardLayer - 1);
          // narrow / 前缀路径只作**读**用（$get / $set 的基读）——rootTarget
          // 沿用外层根的裸绑定名（写回目标永远是外层根）。
          const narrow: MemberPath = {
            rootSrc: `$removeNullish(${guardSrc})`,
            rootTarget: path.rootTarget,
            layers: path.layers.slice(guardLayer),
          };
          const narrowParent =
            narrow.layers.length >= 2
              ? readPrefix(narrow, narrow.layers.length - 2)
              : narrow.rootSrc;
          const innerDel = setParentPathSrc(narrow, `$del(${narrowParent}, ${keySrc})`);
          const armSrc =
            guardLayer === 0
              ? innerDel
              : setPathSrc(
                  {
                    rootSrc: path.rootSrc,
                    rootTarget: path.rootTarget,
                    layers: path.layers.slice(0, guardLayer),
                  } as MemberPath,
                  innerDel,
                );
          lines.push(
            `${pad}${path.rootTarget} = $fork($nullishTest(${guardSrc}), () => ${path.rootSrc}, () => (${armSrc}));`,
          );
        }
      }
    }
    // Bug 96：语句位 String.prototype.match/replace/replaceAll 的**参数位**
    // RegExp 状态写回（spec @@match/@replace 对原正则 Set lastIndex；值通道
    // stringRegexMethod 在实参 regex 的副本上执行）。仅字面量字符串接收者 +
    // Identifier 实参（其余接收者类型不可静态判定，保守跳过）；实参非 RegExp
    // brand 由 $reStateCall 运行时判定原样返回。search/split/matchAll 不写回
    //（恢复原值 / 不动 / 克隆）。
    if (
      node.type === "CallExpression" &&
      node.callee?.type === "MemberExpression" &&
      node.callee.computed !== true &&
      node.callee.object?.type === "StringLiteral" &&
      node.callee.property?.type === "Identifier" &&
      STRING_REGEX_ARG_STATE_NAMES.has((node.callee.property as { name: string }).name) &&
      node.arguments?.[0] &&
      (node.arguments[0] as { type?: string }).type === "Identifier"
    ) {
      const mName = (node.callee.property as { name: string }).name;
      // Bug 179：实参取**求值源**而非标识符文本——自由标识符（`undefined` /
      // `eval` / `Math`…）在生成代码里是宿主全局值而非 Abs，传进运行时会在
      // `.shape` 上抛 TypeError（凭空抛）。且**不生成赋值**——`eval = …` /
      // `arguments = …` 在 strict 模式是 SyntaxError（整模块中止 ⇒ 契约从
      // ERROR 降级成 WARNING ⇒ 门禁假绿）；lastIndex 改为**就地**写
      // （$reStateCall 就地改槽），无需重绑根绑定。
      const argSrc = emitTranspileExpression(node.arguments[0] as Expression, opts);
      const subjSrc = emitTranspileExpression(node.callee.object as Expression, opts);
      lines.push(`${pad}$reStateCall(${argSrc}, ${JSON.stringify(mName)}, [${subjSrc}]);`);
    }
    // 自增/自减：标识符前/后缀均在表达式内自包含写回
    //（后缀缓存 ToNumeric 旧值），本 pass 不得再补写回——否则双倍自增。
    // 成员目标（o.n++/++o.n）同样**自包含**（Bug 155：一次 Get + 一次 Put，
    // getter 只读一次）——本 pass 也不得再补写回（否则双倍自增 / 读两遍）。
    // 注：成员臂的写回下沉到表达式内后，语句位不再有任何自增写回；私有名
    // 目标（this.#x++）本就自包含（memberPathOf 对 PrivateName 返回 null）。
    // 成员目标的自增/自减写回已下沉到表达式内（自包含）——本 pass 不再补写。
    for (const key of Object.keys(node)) {
      if (key === "loc" || key === "start" || key === "end" || key === "range") continue;
      if (key === "callee" || key === "property") continue; // 已处理 receiver
      const child = (node as Record<string, unknown>)[key];
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === "object") visit(child);
    }
  };
  visit(expr);
  return lines;
}

export function emitDestructure(
  pattern: Node,
  fromSrc: string,
  kw: string,
  pad: string,
  opts: TranspileOptions,
  out: string[],
  tmpSeq: { n: number },
): void {
  // Bug 181：解构临时名与**用户标识符**避让——共享计数器推过用户占用的
  // `_d{n}` / `_n{n}` 序号（statement.ts 的 `_d{n}` 与此处的 `_n{n}` 共用
  // 同一计数器 `n++`）。用户自己声明 `_d0` 时，生成码的 `const _d0` 会与
  // 用户声明重复（SyntaxError ⇒ 整模块求值失败 ⇒ 导出退化为 unknown），
  // 在函数体内还会**遮蔽**模块级同名绑定（错值）。
  bumpDestrTmpSeq(tmpSeq, userIdentInfo(opts.source));
  // 赋值解构（kw 为空）写 const 绑定 → TypeError；声明解构走 kw（let/const）
  const assignName = (name: string): void => {
    if (kw === "" && isConstAssignTarget(name, opts)) {
      out.push(`${pad}$throwConstAssign();`);
      return;
    }
    out.push(`${pad}${kw} ${name} = ${fromSrc};`);
  };
  if (pattern.type === "Identifier") {
    assignName(pattern.name);
    return;
  }
  if (pattern.type === "ObjectPattern") {
    const namedKeys: string[] = [];
    /** Bug 160：动态计算键的临时绑定名（rest 排除集用——原生按**求值后的键**排除） */
    const computedKeyNames: string[] = [];
    let restName: string | undefined;
    let restMember: Node | undefined;
    for (const prop of pattern.properties) {
      if (prop.type === "RestElement") {
        if (prop.argument.type === "Identifier") restName = prop.argument.name;
        // ({ a, ...o.x } = src)：赋值位 rest 成员目标（键集收齐后写回）
        else if (prop.argument.type === "MemberExpression") {
          restMember = prop.argument as Node;
        }
        continue;
      }
      if (prop.type !== "ObjectProperty") continue;
      // Bug 160：计算键的**裸标识符**是**表达式**（`{ [k]: v }` 读 o[k]），
      // 不得取标识符的源码名当键——此前读 o["k"]（恒 undefined）且 k 从未
      // 求值。staticKeyOf 只看节点 type/name，不看 computed ⇒ 须在此分流。
      const keyNode = prop.key as { type?: string; name?: string; value?: unknown };
      const isComputed = (prop as { computed?: boolean }).computed === true;
      const keyIsComputedIdent = isComputed && keyNode.type === "Identifier";
      const key = keyIsComputedIdent ? null : staticKeyOf(keyNode);
      // Bug 47：计算键不得静默丢绑定（target 变自由标识符 → 值域腐化 +
      // 裸读 ReferenceError 面）。[Symbol.X] → "@@X" 投影（镜像对象字面量
      // 计算键 / 成员读写口径）；其余计算键经 $idx 计算读（键不可判定 →
      // 槽并 undefined，sound 过近似）。
      const symKey =
        key === null && isComputed
          ? symbolKeyOf(prop.key as unknown as Parameters<typeof symbolKeyOf>[0])
          : null;
      // Bug 160：计算键表达式**只求值一次**（原生求值一次，读与 rest 排除集
      // 共用同一值）→ 绑定临时量，读与排除集都引它。
      let computedKeySrc: string | null = null;
      if (key === null && symKey === null && isComputed) {
        const t = `_n${tmpSeq.n++}`;
        out.push(`${pad}const ${t} = ${emitTranspileExpression(prop.key as Expression, opts)};`);
        computedKeySrc = t;
        computedKeyNames.push(t);
      }
      if (key === null && symKey === null && computedKeySrc === null) continue;
      const keyLit = key !== null ? JSON.stringify(key) : symKey;
      if (keyLit !== null) namedKeys.push(JSON.parse(keyLit));
      // 键读取源：静态/符号投影键走 $get；抽象计算键走 $idx
      // Bug 149：符号投影键带 symbolKey 标记——陷阱边界把 "@@X" 还原成真 symbol
      const readSrc =
        keyLit !== null
          ? `$get(${fromSrc}, ${keyLit}${symKey !== null ? ", { symbolKey: true }" : ""})`
          : `$idx(${fromSrc}, ${computedKeySrc})`;
      if (prop.value.type === "AssignmentPattern") {
        const def = emitTranspileExpression(prop.value.right as Expression, opts);
        const left = prop.value.left;
        if (left.type === "Identifier") {
          if (kw === "" && isConstAssignTarget(left.name, opts)) {
            out.push(`${pad}$throwConstAssign();`);
          } else {
            out.push(
              `${pad}${kw} ${left.name} = $orDefault(${readSrc}, () => ${def});`,
            );
          }
        } else if (left.type === "MemberExpression") {
          // Bug 162：**成员目标**带默认值（`({ a: o.x = 1 } = src)`）——写回
          // 不能丢。此前只认 Identifier / 子模式：成员目标落进「嵌套 + 默认」
          // 分支后被当子模式递归，成员写回**静默丢弃** ⇒ 目标成员保持旧值
          // （错值；原生是「读属性 → undefined 取默认 → 写回目标成员」）。
          const t = `_n${tmpSeq.n++}`;
          out.push(`${pad}const ${t} = $orDefault(${readSrc}, () => ${def});`);
          emitMemberTargetAssign(left as Node, t, pad, opts, out);
        } else {
          // 嵌套 + 默认：const { a: { b } = {} } = o
          const t = `_n${tmpSeq.n++}`;
          out.push(`${pad}const ${t} = $orDefault(${readSrc}, () => ${def});`);
          emitDestructure(left, t, kw, pad, opts, out, tmpSeq);
        }
        continue;
      }
      if (prop.value.type === "ObjectPattern" || prop.value.type === "ArrayPattern") {
        const t = `_n${tmpSeq.n++}`;
        out.push(`${pad}const ${t} = ${readSrc};`);
        emitDestructure(prop.value, t, kw, pad, opts, out, tmpSeq);
        continue;
      }
      if (prop.value.type === "Identifier") {
        if (kw === "" && isConstAssignTarget(prop.value.name, opts)) {
          out.push(`${pad}$throwConstAssign();`);
        } else {
          out.push(`${pad}${kw} ${prop.value.name} = ${readSrc};`);
        }
      } else if (prop.value.type === "MemberExpression") {
        // ({ p: o.x } = src)：成员目标写回（不得静默跳过）
        emitMemberTargetAssign(prop.value as Node, readSrc, pad, opts, out);
      }
    }
    // Bug 160：rest 排除集 = 静态键名 + **动态计算键的求值结果**（原生按
    // 求值后的键排除；此前只排静态名 → 计算键仍留在 rest 里）。
    const dropList = [...namedKeys.map((k) => JSON.stringify(k)), ...computedKeyNames];
    const restSrc = `$objRest(${fromSrc}, [${dropList.join(", ")}])`;
    if (restName) {
      if (kw === "" && isConstAssignTarget(restName, opts)) {
        out.push(`${pad}$throwConstAssign();`);
      } else {
        out.push(`${pad}${kw} ${restName} = ${restSrc};`);
      }
    } else if (restMember) {
      // rest 成员目标写回（namedKeys 须循环收齐后再算 $objRest）
      emitMemberTargetAssign(restMember, restSrc, pad, opts, out);
    }
    return;
  }
  if (pattern.type === "ArrayPattern") {
    // 原生数组解构 = GetIterator + IteratorNext：非可迭代接收者抛 TypeError。
    // 逐项 $idx / $arrRest 投影前先过迭代性守卫（Bug 7：`const [x] = 1` /
    // `= {}` definite，抽象接收者 may）；字符串/元组等可迭代接收者与对象
    // 模式（$get 路径）不受影响。fromSrc 是临时名/绑定名，重复求值无副作用。
    //
    // Bug 140：接收者是**用户 iterable**（对象带自有 `@@iterator` 槽，引擎
    // 无其元素模型）时，元素按**迭代序**取（GetIterator + IteratorNext），
    // 不是按索引读（$idx 读索引属性 ⇒ 与迭代序无关的错值 / 确定 undefined）。
    // `$iterCheck` 兼做守卫与**迭代序元素读取器**：非用户 iterable → null ⇒
    // 走既有 `$idx` / `$arrRest` 快速路径（tuple / 数组 / 字符串 / Set / Map /
    // 生成器 / `$tpl` / 数组迭代器…逐字不变）。
    //
    // 取元素个数：模式有 n 个位置就取 n 个（原生空位也消耗一个迭代步）；
    // 有 rest ⇒ 取到 done（运行时步数上界兜底，超界折 unknown）。
    const hasRest = pattern.elements.some(
      (el) => el !== null && el.type === "RestElement",
    );
    const uiReader = `_n${tmpSeq.n++}`;
    out.push(
      `${pad}const ${uiReader} = $iterCheck(${fromSrc}, ${hasRest ? -1 : pattern.elements.length});`,
    );
    const readAt = (i: number): string =>
      `${uiReader} ? ${uiReader}.get(${i}) : $idx(${fromSrc}, $lit(${i}))`;
    const readRest = (i: number): string =>
      `${uiReader} ? ${uiReader}.rest(${i}) : $arrRest(${fromSrc}, ${i})`;
    let restName: string | undefined;
    let restAt = 0;
    pattern.elements.forEach((el, i) => {
      if (!el) return;
      if (el.type === "RestElement") {
        if (el.argument.type === "Identifier") {
          restName = el.argument.name;
          restAt = i;
          return;
        }
        // ...[b, c] / ...{0: b}（rest 实参为模式）：rest 值先入临时，再子模式
        // 绑定。此前只认 Identifier，模式实参静默丢绑定 → 子名自由读
        // spurious-throw 面（差分 FALSE-THROW）。
        if (el.argument.type === "ObjectPattern" || el.argument.type === "ArrayPattern") {
          const t = `_n${tmpSeq.n++}`;
          out.push(`${pad}const ${t} = ${readRest(i)};`);
          emitDestructure(el.argument, t, kw, pad, opts, out, tmpSeq);
          return;
        }
        if (el.argument.type === "MemberExpression") {
          // [...o.x] = src（赋值位 rest 成员目标）：成员写回，不得静默跳过
          emitMemberTargetAssign(
            el.argument as Node,
            readRest(i),
            pad,
            opts,
            out,
          );
          return;
        }
        // 其余 LVal（TS 断言等）无可靠 lowering：fail-closed 回落
        throw new NudoUnsupportedError(
          "destructure-rest",
          el.argument.loc
            ? { line: el.argument.loc.start.line, column: el.argument.loc.start.column }
            : undefined,
        );
      }
      if (el.type === "AssignmentPattern") {
        const def = emitTranspileExpression(el.right as Expression, opts);
        const idx = readAt(i);
        if (el.left.type === "Identifier") {
          if (kw === "" && isConstAssignTarget(el.left.name, opts)) {
            out.push(`${pad}$throwConstAssign();`);
          } else {
            out.push(`${pad}${kw} ${el.left.name} = $orDefault(${idx}, () => ${def});`);
          }
        } else if (el.left.type === "MemberExpression") {
          // Bug 162：成员目标 + 默认值（`[o.x = 1] = src`）——同对象模式分支：
          // 写回不能丢（读 → undefined 取默认 → 写回目标成员）。
          const t = `_n${tmpSeq.n++}`;
          out.push(`${pad}const ${t} = $orDefault(${idx}, () => ${def});`);
          emitMemberTargetAssign(el.left as Node, t, pad, opts, out);
        } else {
          const t = `_n${tmpSeq.n++}`;
          out.push(`${pad}const ${t} = $orDefault(${idx}, () => ${def});`);
          emitDestructure(el.left, t, kw, pad, opts, out, tmpSeq);
        }
        return;
      }
      if (el.type === "ObjectPattern" || el.type === "ArrayPattern") {
        const t = `_n${tmpSeq.n++}`;
        out.push(`${pad}const ${t} = ${readAt(i)};`);
        emitDestructure(el, t, kw, pad, opts, out, tmpSeq);
        return;
      }
      if (el.type === "Identifier") {
        if (kw === "" && isConstAssignTarget(el.name, opts)) {
          out.push(`${pad}$throwConstAssign();`);
        } else {
          out.push(`${pad}${kw} ${el.name} = ${readAt(i)};`);
        }
      } else if (el.type === "MemberExpression") {
        // [o.x] = src：成员目标写回（不得静默跳过）
        emitMemberTargetAssign(el as Node, readAt(i), pad, opts, out);
      }
    });
    if (restName) {
      if (kw === "" && isConstAssignTarget(restName, opts)) {
        out.push(`${pad}$throwConstAssign();`);
      } else {
        out.push(`${pad}${kw} ${restName} = ${readRest(restAt)};`);
      }
    }
  }
}

/**
 * 函数参数签名 + 解构 prologue：
 * Identifier 直通；ObjectPattern/ArrayPattern/AssignmentPattern 用占位参数
 * `_p{i}` 接收，再在函数体首部 emitDestructure / $orDefault 绑定。
 * RestElement 返回 rest 名（FunctionDeclaration 由 arguments 绑定；arrow 直接 rest 形参）。
 * defaulted：sig 下标里默认参（AssignmentPattern）占位的位置——宿主签名
 * 按位补 `= void 0` 后 fn.length 与原生对齐（Bug 69：首个默认值前形参数）。
 */
export function emitParamBinding(
  params: Node[],
  pad: string,
  opts: TranspileOptions,
): { sig: string[]; rest?: string; prologue: string[]; defaulted: number[] } {
  const sig: string[] = [];
  const prologue: string[] = [];
  const defaulted: number[] = [];
  let rest: string | undefined;
  // Bug 181：共享解构临时名计数器（跨形参唯一）+ 与用户标识符避让。
  // 此前每个形参各建一个 `{ n: 0 }` ⇒ 多个解构形参的 `_n{n}` 临时名互相
  // 撞名（重复 const ⇒ SyntaxError ⇒ 整模块求值失败）。
  const tmpSeq = opts.destrTmpSeq ?? { n: 0 };
  const userInfo = userIdentInfo(opts.source);
  bumpDestrTmpSeq(tmpSeq, userInfo);
  params.forEach((p, i) => {
    if (p.type === "Identifier") {
      sig.push(p.name);
      return;
    }
    if (p.type === "RestElement") {
      if (p.argument.type === "Identifier") {
        rest = p.argument.name;
        return;
      }
      const ph = safeTmpName(`_rest${i}`, userInfo);
      rest = ph;
      // Bug 161：形参绑定**可变**（原生 `function f([...a]) { a = 5; }` 合法）
      // ——此前按 const 发射 ⇒ 体内再赋抛 TypeError（假红 + 错值）。
      emitDestructure(p.argument, ph, "let", pad, opts, prologue, tmpSeq);
      return;
    }
    const ph = safeTmpName(`_p${i}`, userInfo);
    sig.push(ph);
    if (p.type === "AssignmentPattern") {
      defaulted.push(i);
      const def = emitTranspileExpression(p.right as Expression, opts);
      if (p.left.type === "Identifier") {
        // Bug 161：默认参绑定可变（原生 `function f(a = 1) { a = 5; }` 合法）
        prologue.push(`${pad}let ${p.left.name} = $orDefault(${ph}, () => ${def});`);
      } else {
        const t = safeTmpName(`_pd${i}`, userInfo);
        prologue.push(`${pad}const ${t} = $orDefault(${ph}, () => ${def});`);
        emitDestructure(p.left, t, "let", pad, opts, prologue, tmpSeq);
      }
      return;
    }
    if (p.type === "ObjectPattern" || p.type === "ArrayPattern") {
      // Bug 161：形参解构绑定可变（原生可再赋）
      emitDestructure(p, ph, "let", pad, opts, prologue, tmpSeq);
    }
  });
  return { sig, rest, prologue, defaulted };
}

/**
 * 从 `$arguments` 槽（`__nudoArgs`）绑定形参——FunctionExpression 走
 * `(...__allArgs)` 收齐全量实参时用。Identifier/默认参/解构/rest 与
 * emitParamBinding 同语义，但读 `$idx(__nudoArgs, i)` 而不是 JS 形参。
 * 返回 rest 名与 prologue；namedCount 供 $arrRest 切片。
 */
export function emitParamBindingFromArgs(
  params: Node[],
  pad: string,
  opts: TranspileOptions,
  argsSrc: string,
): { prologue: string[]; rest?: string; namedCount: number } {
  const prologue: string[] = [];
  let rest: string | undefined;
  let namedCount = 0;
  // rest 绑定是否已在 RestElement 处提前发射（模式 rest 参的 destructure
  // 行引用 `_rest{i}`，尾置绑定 = TDZ ReferenceError）
  let restBoundEarly = false;
  // Bug 181：共享解构临时名计数器 + 与用户标识符避让
  const tmpSeq = opts.destrTmpSeq ?? { n: 0 };
  const userInfo = userIdentInfo(opts.source);
  bumpDestrTmpSeq(tmpSeq, userInfo);
  params.forEach((p, i) => {
    if (p.type === "RestElement") {
      if (p.argument.type === "Identifier") {
        rest = p.argument.name;
      } else {
        rest = safeTmpName(`_rest${i}`, userInfo);
        restBoundEarly = true;
        // rest 语法上必为末参 → namedCount 此处已终值
        prologue.push(`${pad}let ${rest} = $arrRest(${argsSrc}, ${namedCount});`);
        // Bug 161：形参 rest 绑定可变
        emitDestructure(p.argument, rest, "let", pad, opts, prologue, tmpSeq);
      }
      return;
    }
    namedCount++;
    const idxSrc = `$idx(${argsSrc}, $lit(${i}))`;
    if (p.type === "Identifier") {
      prologue.push(`${pad}let ${p.name} = ${idxSrc};`);
      return;
    }
    if (p.type === "AssignmentPattern") {
      const def = emitTranspileExpression(p.right as Expression, opts);
      if (p.left.type === "Identifier") {
        prologue.push(`${pad}let ${p.left.name} = $orDefault(${idxSrc}, () => ${def});`);
      } else {
        const t = safeTmpName(`_pd${i}`, userInfo);
        prologue.push(`${pad}let ${t} = $orDefault(${idxSrc}, () => ${def});`);
        // Bug 161：默认参的解构绑定可变
        emitDestructure(p.left, t, "let", pad, opts, prologue, tmpSeq);
      }
      return;
    }
    if (p.type === "ObjectPattern" || p.type === "ArrayPattern") {
      emitDestructure(p, idxSrc, "let", pad, opts, prologue, tmpSeq);
    }
  });
  if (rest && !restBoundEarly) {
    prologue.push(`${pad}let ${rest} = $arrRest(${argsSrc}, ${namedCount});`);
  }
  return { prologue, rest, namedCount };
}

/** 收集语句/表达式里以 Identifier 为 receiver 的数组 mutator 名 */

export function forkArmThunk(
  bodyLines: string[],
  outPrefix: string,
  names: string[],
): string {
  return [
    `() => {`,
    ...names.map((n) => `  ${n} = $copy(__fk0_${n});`),
    `  let __cont = true;`,
    `  try {`,
    ...bodyLines.map((l) => `    ${l}`),
    `  } catch (e) {`,
    `    if ($isForkExit(e)) __cont = false;`,
    `    throw e;`,
    `  } finally {`,
    `    if (__cont) {`,
    ...names.map((n) => `      __${outPrefix}${n} = ${n};`),
    ...names.map((n) => `      __${outPrefix}set_${n} = true;`),
    `    }`,
    `  }`,
    `}`,
  ].join("\n");
}

/** fork 绑定声明：snapshot（深拷贝——容器写已就地化，臂间必须状态隔离）+ 两臂槽位 + ran 标志 */
export function forkBindingDecls(names: string[], pad = ""): string[] {
  return names.flatMap((n) => [
    `${pad}const __fk0_${n} = $copy(${n});`,
    `${pad}let __fk1_${n}; let __fk2_${n};`,
    `${pad}let __fk1_set_${n} = false; let __fk2_set_${n} = false;`,
  ]);
}

/** fork 后把各臂结束态 join 回绑定（仅 join **未**以 return/throw 退出的臂） */
export function forkJoinBindings(names: string[], pad = ""): string[] {
  return names.map(
    (n) =>
      `${pad}${n} = (__fk1_set_${n} && __fk2_set_${n}) ? $join(__fk1_${n}, __fk2_${n}) : (__fk1_set_${n} ? __fk1_${n} : (__fk2_set_${n} ? __fk2_${n} : ${n}));`,
  );
}

/**
 * 可选 require 模式：`try { m = require(A); } catch { m = require(B); }`
 * 两侧说明符都可常量折叠时返回 [A, B]（优先成功侧）；否则 null（走诚实 try/catch）。
 */
export function matchOptionalRequire(stmt: {
  block?: unknown;
  handler?: { body?: unknown } | null;
}): { name: string; specs: [string, string]; locLine: number; locCol: number } | null {
  const takeAssign = (bodyNode: unknown): { name: string; spec: string } | null => {
    if (!bodyNode || typeof bodyNode !== "object") return null;
    const b = bodyNode as { type?: string; body?: unknown[]; expression?: unknown };
    let expr: unknown;
    if (b.type === "BlockStatement") {
      if (!Array.isArray(b.body) || b.body.length !== 1) return null;
      const s = b.body[0] as { type?: string; expression?: unknown } | undefined;
      if (!s || s.type !== "ExpressionStatement") return null;
      expr = s.expression;
    } else if (b.type === "ExpressionStatement") {
      expr = b.expression;
    } else {
      return null;
    }
    const a = expr as {
      type?: string;
      operator?: string;
      left?: { type?: string; name?: string };
      right?: {
        type?: string;
        callee?: { type?: string; name?: string };
        arguments?: unknown[];
      };
    } | null;
    if (!a || a.type !== "AssignmentExpression" || a.operator !== "=") return null;
    if (a.left?.type !== "Identifier" || !a.left.name) return null;
    const call = a.right;
    if (!call || call.type !== "CallExpression") return null;
    if (call.callee?.type !== "Identifier" || call.callee.name !== "require") return null;
    const spec = foldRequireSpecArg(call.arguments?.[0]);
    if (spec === undefined) return null;
    return { name: a.left.name, spec };
  };
  if (!stmt.block || !stmt.handler) return null;
  const tryA = takeAssign(stmt.block);
  const catchA = takeAssign(stmt.handler.body);
  if (!tryA || !catchA || tryA.name !== catchA.name) return null;
  const loc = (stmt as { loc?: { start: { line: number; column: number } } }).loc;
  return {
    name: tryA.name,
    specs: [tryA.spec, catchA.spec],
    locLine: loc?.start.line ?? 0,
    locCol: loc?.start.column ?? 0,
  };
}

/**
 * catch 体是否可能 rethrow：任意深度语句位置出现 ThrowStatement 即视为
 * 可能（条件 throw 保守按可能算，与 evalTry 的 catchR.threw 口径一致）；
 * 不降入嵌套函数/箭头/类方法体（其 throw 不构成本 catch 的 rethrow）。
 */
export function catchMayRethrow(handler: { body: Node }): boolean {
  const visit = (n: unknown): boolean => {
    if (!n || typeof n !== "object") return false;
    const o = n as { type?: string; [k: string]: unknown };
    if (o.type === "ThrowStatement") return true;
    if (
      o.type === "FunctionDeclaration" ||
      o.type === "FunctionExpression" ||
      o.type === "ArrowFunctionExpression" ||
      o.type === "ClassMethod" ||
      o.type === "ObjectMethod" ||
      o.type === "ClassDeclaration"
    ) {
      return false;
    }
    for (const key of Object.keys(o)) {
      if (key === "loc" || key === "start" || key === "end") continue;
      const v = o[key];
      if (Array.isArray(v)) {
        for (const item of v) if (visit(item)) return true;
      } else if (v && typeof v === "object") {
        if (visit(v)) return true;
      }
    }
    return false;
  };
  return visit(handler.body);
}
