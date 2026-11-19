/**
 * Date 构造 / Date.* / Date 实例方法。
 * Bug 24：构造器实参强转校验——单参形式 ToPrimitive(number)→ToNumber：
 * symbol/bigint 值（prim 或字面量）确定 TypeError（node 实测 new Date(1n) 抛，
 * 与 bug 文本一致）；Date brand 豁免（读 [[TimeValue]]）；闭 obj 字面量无自有
 * coercer 槽 total（ToPrimitive 恒得 "[object Object]" → Invalid Date）；其余
 * 抽象 may（coercer 可能产 Symbol/BigInt）。多参形式每个实参直接 ToNumber。
 * Bug 62：setter 实参逐个 ToNumber 校验；getter/toString 族值域建模。
 *
 * Invariants:
 * - Bug 297：Date 的 time value 是**可写槽**（构造期写入 brand shape 的 tv
 *   facet）。`Date.prototype.set*` 族不再是空操作——按规范语义回写该槽
 *   （MakeDay/MakeTime 归一化、月日溢出、TimeClip 越界 → Invalid Date，与
 *   原生逐条同口径：实现走**宿主 Date**，两位年映射差异（构造器 1900 偏移 vs
 *   setter 不偏移）自动对齐）。**实参不可判定 → 作废该槽**（精确渲染面随之
 *   降级为 may-throw，绝不给过期日期）。getTime/valueOf 与 toISOString 读
 *   同一槽 ⇒ 读面 / 投影面（JSON.stringify）同源，不会自相矛盾。
 * - Bug 319：`toJSON` 单列一档——Invalid Date（tv=NaN）→ **null 字面量**
 *   （原生返回 null，不是字符串）；tv 已知且有效 → ISO 串；tv 不可知 → 保守
 *   `string | null` 域（不再是恒 string）。
 * - BUG-154：time value 面共有**三档**，不是两档：
 *   1. 已知值（`tv` facet：字面量实参 / 全字面量多参）→ 精确折叠，
 *      NaN ⇒ 确定 RangeError；
 *   2. **合法但值未知**（零参 `new Date()` = 当前时间，规范保证落在
 *      ±8.64e15 内 ⇒ 恒非 Invalid）→ `DATE_VALID_TV_SLOT` 标记：
 *      `toISOString` 恒不抛、`toJSON` 恒字符串；
 *   3. 值未知且可能 Invalid（抽象实参 / 外部 Date）→ may 档。
 *   setter 之后第 2 档退化为第 3 档（setTime(NaN) / 越界归一化能造出
 *   Invalid Date，而起点 tv 未知 ⇒ 结果合法性不可判定）。
 */
import type { Abs } from "../abs.ts";
import { abs, strLit, numLit, boolLit, absLit } from "../abs.ts";
import { numPrim, str, mayCoerceThrowOperand } from "./shared.ts";
import { NudoThrow } from "../exec/nudo-throw.ts";
import { errorTypeAbs, recordMayThrow } from "../exec/may-throw.ts";
import { isSymbolAbs } from "../key/symbol-id.ts";
import { isBigintPrimAbs } from "./shared.ts";

/** symbol/bigint 值（prim 无 lit 项，或 bigint 字面量）→ ToNumber 确定 TypeError */
function isToNumberThrowAbs(a: Abs | undefined): boolean {
  if (!a) return false;
  return (
    isSymbolAbs(a) ||
    isBigintPrimAbs(a) ||
    (a.term?.op === "lit" && typeof a.term.value === "bigint")
  );
}

/** 抽象实参 may 档：闭 obj 字面量无自有 coercer 槽 → total；其余 may */
function noteToPrimitiveMayThrow(a: Abs, cause: string): void {
  if (a.shape.k === "obj") {
    const so = a.shape as { slots: Record<string, unknown>; open?: boolean };
    const hasCoercer = "toString" in so.slots || "valueOf" in so.slots;
    if (!so.open && !hasCoercer) return;
  }
  // tuple/arr：join 元素可能为 symbol（node 实测 new Date([Symbol()]) 抛）
  if (mayCoerceThrowOperand(a) || a.shape.k === "tuple" || a.shape.k === "arr") {
    recordMayThrow({ kind: "TypeError", cause });
  }
}

export function evalDateCtor(args: Abs[]): Abs {
  if (args.length <= 1) {
    const a0 = args[0];
    if (a0) {
      if (isToNumberThrowAbs(a0)) throw new NudoThrow(errorTypeAbs("TypeError"));
      // Date brand 豁免：原生读 [[TimeValue]]（node 实测 new Date(new Date(5)) total）
      const isDateBrand = a0.shape.k === "brand" && (a0.shape as { name?: string }).name === "Date";
      if (!isDateBrand) {
        noteToPrimitiveMayThrow(a0, "Date constructor argument ToPrimitive may produce Symbol/BigInt");
      }
    }
  } else {
    // 多参形式：y/m/d/h/ms 每个实参直接 ToNumber（无 string 解析特判）
    for (const a of args) {
      if (isToNumberThrowAbs(a)) throw new NudoThrow(errorTypeAbs("TypeError"));
      noteToPrimitiveMayThrow(a, "Date constructor argument ToNumber may throw (Symbol/BigInt)");
    }
  }
  // time-value facet：全字面量实参 → 原生 Date 构造计算
  // [[TimeValue]]（范围 clamp / 字符串解析 / Invalid 与原生
  // 同口径——直接复用宿主构造器）。含非字面量实参 → 不设（消费方走 may 档）。
  // BUG-154：**零参**是另一档——`new Date()` 取当前时间，规范保证落在
  // 可表示区间内 ⇒ time value **值未知但恒合法**。这一档不写 tv（值不是
  // 编译期常量，写具体数会造自信的错值），改写合法性标记槽（见
  // DATE_VALID_TV_SLOT），消费方据此判「不可能是 Invalid Date」。
  let tv: number | undefined;
  if (args.length > 0 && args.every((a) => a.term?.op === "lit")) {
    const lits = args.map((a) => (a.term as { op: "lit"; value: unknown }).value);
    if (
      lits.every(
        (v) =>
          v === undefined ||
          v === null ||
          typeof v === "number" ||
          typeof v === "string" ||
          typeof v === "boolean",
      )
    ) {
      // 单参：null → epoch 0、undefined → NaN（Invalid Date），与原生同口径；
      // 多参：逐参 ToNumber（原生口径）。Date 构造器是定长签名非 rest，
      // 展开须元组化（TS2556）。
      tv =
        lits.length === 1
          ? new Date(lits[0] == null ? (lits[0] === null ? 0 : NaN) : (lits[0] as number | string)).getTime()
          : new Date(...(lits.map(Number) as [number, number, number, number, number, number, number])).getTime();
    }
  }
  return abs(
    {
      k: "brand",
      name: "Date",
      shape: abs(
        {
          k: "obj",
          slots:
            args.length === 0
              ? { [DATE_VALID_TV_SLOT]: { value: boolLit(true), internal: true } }
              : {},
        },
        undefined,
        undefined,
        "exact",
      ),
      ...(tv !== undefined ? { tv } : {}),
    },
    undefined,
    undefined,
    "path",
  );
}

export function evalDateStatic(name: string, args: Abs[]): Abs | undefined {
  // Date.now() 非编译期常量：每次运行值都变，折叠成具体时间戳既不 sound 又
  // 让分析结果不确定（golden/memo 抖动）。返回 number（未知）。
  if (name === "now") return numPrim("path");
  // Bug 7：parse/UTC——env 声明被硬编码派发表遮蔽，此前落 `?? unknown`。
  // 值域恒可判定：parse 恒 number（无效输入 NaN 非抛）、UTC 恒 number；
  // 全字面量实参按宿主折叠到精确时间戳。
  if (name === "parse") {
    // 首参 ToString：symbol 定抛；抽象 may（与 Number.parseInt 的口径一致）
    const a0 = args[0];
    if (a0 && isSymbolAbs(a0)) throw new NudoThrow(errorTypeAbs("TypeError"));
    if (a0 && a0.term?.op !== "lit") {
      if (mayCoerceThrowOperand(a0)) {
        recordMayThrow({ kind: "TypeError", cause: "Date.parse argument ToString may throw (Symbol)" });
      }
      return numPrim("path");
    }
    const v = a0 ? (a0.term as { op: "lit"; value: unknown }).value : undefined;
    return numLit(Date.parse(String(v)));
  }
  if (name === "UTC") {
    // 各实参直接 ToNumber（与 Date 构造器多参形式同口径）：symbol/bigint
    // （prim 无 lit 项或 bigint 字面量）定抛 TypeError；抽象 may。
    // 全字面量 → 折叠精确时间戳；任一抽象 → numPrim("path")
    let allLit = true;
    for (const a of args) {
      if (isToNumberThrowAbs(a)) throw new NudoThrow(errorTypeAbs("TypeError"));
      if (a && a.term?.op !== "lit") {
        noteToPrimitiveMayThrow(a, "Date.UTC argument ToNumber may throw (Symbol/BigInt)");
        allLit = false;
      }
    }
    if (allLit) {
      const lits = args.map((a) => (a!.term as { op: "lit"; value: unknown }).value);
      return numLit(Date.UTC(...(lits.map(Number) as [number, number, number, number, number, number, number])));
    }
    return numPrim("path");
  }
  return undefined;
}

/** getter（无实参强转——原生忽略实参，node 实测 getTime(Symbol()) OK）→ number */
const DATE_NUMBER_GETTERS = new Set([
  "getTime", "valueOf",
  "getFullYear", "getUTCFullYear", "getMonth", "getUTCMonth",
  "getDate", "getUTCDate", "getDay", "getUTCDay",
  "getHours", "getUTCHours", "getMinutes", "getUTCMinutes",
  "getSeconds", "getUTCSeconds", "getMilliseconds", "getUTCMilliseconds",
  "getTimezoneOffset",
  // Bug 39：Annex B 遗留 getter（= getFullYear() - 1900，原生未移除）→ number
  "getYear",
]);

/** toString 族 → string（toISOString 原生对 Invalid Date 抛 RangeError——
 *  Date brand 的 time value 不可知，保守 total 不打点）。
 *  toJSON 不在此列：Bug 319——Invalid Date 返回 null（不是 string）。 */
const DATE_STRING_METHODS = new Set([
  "toString", "toDateString", "toTimeString", "toUTCString", "toGMTString",
  "toLocaleString", "toLocaleDateString", "toLocaleTimeString",
  "toISOString",
]);

/** setter：实参逐个 ToNumber（缺省合法——node 实测 setFullYear() → NaN） */
const DATE_SETTERS = new Set([
  "setTime", "setMilliseconds", "setUTCMilliseconds",
  "setSeconds", "setUTCSeconds", "setMinutes", "setUTCMinutes",
  "setHours", "setUTCHours", "setDate", "setUTCDate",
  "setMonth", "setUTCMonth", "setFullYear", "setUTCFullYear",
  // Bug 39：Annex B 遗留 setter（返回新 time value）→ number
  "setYear",
]);

/**
 * Bug 297：Date brand 的 time value 槽（构造期写入；setter 可回写）。
 * 非 Date brand / 无 tv facet → undefined（time value 不可知）。
 */
function dateTvOf(recv: Abs): number | undefined {
  if (recv.shape.k !== "brand") return undefined;
  const sh = recv.shape as { name?: string; tv?: number };
  return sh.name === "Date" ? sh.tv : undefined;
}

/**
 * BUG-154：零参 `new Date()`（= 当前时间）的 **time-value 合法性**标记。
 *
 * 规范保证当前时间落在 ±8.64e15 ms 内 ⇒ 零参构造**恒非 Invalid Date** ⇒
 * `toISOString()` 恒不抛 `RangeError`、`toJSON()` 恒返回字符串。但具体
 * time value 不是编译期常量 ⇒ 不能写 `tv`（写死具体数 = 自信的错值）。
 * 缺的是「**合法但值未知**」这一档，与「值未知、可能 Invalid」的抽象
 * Date（`new Date(x)` / 外部传入）区分开。
 *
 * 承载方式照抄装箱 prim 的 `[[PrimitiveValue]]` 范式：brand **内层 obj 的
 * internal 槽**——投影面（自有键 / 枚举 / spread / JSON / descriptor）一律
 * 按 `internal` 剔除，对用户可观察面不可见；但 `absKey` 的 obj 臂会带上
 * 槽名与 flags ⇒ 「合法未知」与「抽象可能 Invalid」仍是**两个不同的结构
 * 键**，不会被 join / 去重吞成同一个（合并「合法」进「可能 Invalid」是
 * 保守方向，反向则是假绿）。
 */
const DATE_VALID_TV_SLOT = "[[ValidTimeValue]]";

/** Date brand 的内层槽表（非 Date brand / 内层非 obj → undefined） */
function dateInnerSlots(
  recv: Abs,
): Record<string, { value: Abs; internal?: boolean }> | undefined {
  if (recv.shape.k !== "brand") return undefined;
  const sh = recv.shape as { name?: string; shape?: Abs };
  if (sh.name !== "Date" || !sh.shape) return undefined;
  const inner = sh.shape;
  if (inner.shape.k !== "obj") return undefined;
  return inner.shape.slots as Record<string, { value: Abs; internal?: boolean }>;
}

/** BUG-154：time value **值未知但恒合法**（零参 `new Date()`） */
function dateTvValidOf(recv: Abs): boolean {
  return dateInnerSlots(recv)?.[DATE_VALID_TV_SLOT] !== undefined;
}

/**
 * BUG-154：作废合法性标记。setter 之后不再成立（`setTime(NaN)` /
 * 越界归一化都能把合法 Date 变成 Invalid Date，而起点 tv 未知 ⇒ 结果
 * 合法性不可判定）⇒ 回落「可能 Invalid」的 may 档，绝不沿用旧标记。
 */
function clearDateTvValid(recv: Abs): void {
  const slots = dateInnerSlots(recv);
  if (slots) delete slots[DATE_VALID_TV_SLOT];
}

/**
 * Bug 297：回写 time value 槽。undefined = **不可知**（实参不可判定）——
 * 作废槽位：精确渲染面（toISOString）随之降级为 may-throw，绝不给过期日期。
 */
function writeDateTv(recv: Abs, tv: number | undefined): void {
  if (recv.shape.k !== "brand") return;
  const sh = recv.shape as { name?: string; tv?: number };
  if (sh.name !== "Date") return;
  if (tv === undefined) delete sh.tv;
  else sh.tv = tv;
}

/**
 * Bug 297：setter 实参 → ToNumber 结果。不可判定 → undefined（实参存在但
 * 值不可知——抽象 number / 抽象对象等）。缺省实参不进本函数（缺省 ≠ 显式
 * undefined：前者保留当前时间分量，后者 → NaN → Invalid Date）。
 */
function setterArgNumber(a: Abs | undefined): number | undefined {
  if (!a) return undefined;
  const t = a.term;
  if (t?.op !== "lit") return undefined;
  const v = (t as { op: "lit"; value: unknown }).value;
  if (typeof v === "number") return v;
  if (typeof v === "string" || typeof v === "boolean" || v === null) return Number(v);
  if (v === undefined) return NaN;
  // bigint 字面量：调用点已定抛 TypeError（走不到这里）；其余 → 不可判定
  return undefined;
}

/**
 * Bug 297：setter 计算——以**宿主 Date** 实现规范语义：MakeDay/MakeTime
 * 归一化（1 月 31 日 setUTCMonth(1) → 3 月 2 日）、两位年映射差异
 * （构造器 1900 偏移 vs setter 不偏移）、TimeClip 越界 → Invalid Date，
 * 与原生逐条同口径（node 实测；规范细节多且近年生效，用宿主实现避免手抄漂移）。
 * 实参不可判定 → undefined（调用方作废 tv 槽）。
 */
function applyDateSetter(name: string, tv: number, args: Abs[]): number | undefined {
  const vals: number[] = [];
  for (const a of args) {
    const v = setterArgNumber(a);
    if (v === undefined) return undefined;
    vals.push(v);
  }
  const d = new Date(tv);
  const fn = (d as unknown as Record<string, (...a: number[]) => void>)[name];
  if (typeof fn !== "function") return undefined;
  fn.apply(d, vals);
  return d.getTime();
}

export function evalDateMethod(name: string, recv: Abs, args: Abs[]): Abs | undefined {
  // Bug 319：toJSON 单列一档——Invalid Date（tv=NaN）→ null 字面量（原生
  // 返回 null，不是字符串）；tv 已知且有效 → ISO 串；tv 不可知 → 保守
  // `string | null` 域（抽象 Date 可能是 Invalid Date）。
  // BUG-154：但**零参构造**的 Date 是「合法、值未知」——toJSON ≡ toISOString
  // 恒得串（原生 `new Date().toJSON()` 永不返回 null）⇒ 域收窄成 string。
  if (name === "toJSON") {
    const tv = dateTvOf(recv);
    if (tv !== undefined) {
      if (Number.isNaN(tv)) return absLit(null);
      return strLit(new Date(tv).toISOString());
    }
    if (dateTvValidOf(recv)) return str("path");
    return abs({ k: "sum", members: [str("path"), absLit(null)] }, undefined, undefined, "path");
  }
  // toISOString：time-value facet 已知时精确——Invalid Date
  // （tv=NaN）确定 RangeError（原生）；valid → ISO 字面量
  // （确定性折叠）。facet 缺失（抽象 Date）→ may 档。
  // BUG-154：合法性标记（零参构造）⇒ 值未知但必然合法 ⇒ 恒不抛。
  if (name === "toISOString") {
    const tv = dateTvOf(recv);
    if (tv !== undefined) {
      if (Number.isNaN(tv)) {
        throw new NudoThrow(errorTypeAbs("RangeError"));
      }
      return strLit(new Date(tv).toISOString());
    }
    if (dateTvValidOf(recv)) return str("path");
    recordMayThrow({
      kind: "RangeError",
      cause: "Date.prototype.toISOString on possibly-Invalid Date",
    });
    return str("path");
  }
  // Bug 297：getTime / valueOf 读 time value 槽（tv 已知 → 精确 number；
  // 不可知 → 抽象 number）。setter 回写后二者同步更新。
  if (name === "getTime" || name === "valueOf") {
    const tv = dateTvOf(recv);
    return tv !== undefined ? numLit(tv) : numPrim("path");
  }
  if (DATE_NUMBER_GETTERS.has(name)) return numPrim("path");
  if (DATE_STRING_METHODS.has(name)) return str("path");
  if (DATE_SETTERS.has(name)) {
    // Bug 62：symbol/bigint 实参确定 TypeError（node 实测 setTime(Symbol())/
    // setTime(1n) 抛）；抽象 obj/fn/brand/sum/any → may；返回新 time value
    for (const a of args) {
      if (isToNumberThrowAbs(a)) throw new NudoThrow(errorTypeAbs("TypeError"));
      noteToPrimitiveMayThrow(a, `Date.prototype.${name} ToNumber argument may throw (Symbol/BigInt)`);
    }
    // Bug 297：setter 真正回写 time value（此前是空操作——精确渲染面给出
    // 过期日期）。tv 不可知（抽象 Date）→ 新值不可知（返回抽象 number，槽位
    // 保持不可知）；实参不可判定 → 作废槽位（精确面降级，不给过期日期）。
    // BUG-154：起点的 tv 不可知时，**合法性标记也必须作废**——setter 能把
    // 合法 Date 变成 Invalid（setTime(NaN) / 越界归一化），标记一旦留下就是
    // 假绿（toISOString 宣称恒不抛）。
    const tv = dateTvOf(recv);
    if (tv === undefined) {
      clearDateTvValid(recv);
      return numPrim("path");
    }
    const next = applyDateSetter(name, tv, args);
    writeDateTv(recv, next);
    return next === undefined ? numPrim("path") : numLit(next);
  }
  return undefined;
}
