/**
 * [[Set]] 原型链写门（Bug 197）——**叶子模块**（只依赖 abs / objects /
 * accessors / invariants 四个叶子，不与 exec/runtime 其它模块成环）。
 *
 * 规范 OrdinarySetWithOwnDescriptor / OrdinarySet（ES2024 13.15.2）：
 * receiver **无自有该键**时，[[Set]] 沿 [[Prototype]] 链上溯——第一个
 * 「持有该键」的原型决定写语义：
 * - 访问器描述符 → 调 setter（**无 setter** → strict 赋值 TypeError）
 * - 数据描述符 writable:false → strict 赋值 TypeError
 *   （frozen 原型同理：其自有键全部不可写）
 * - 数据描述符可写 → receiver 建**自有**数据属性（原型不参与写）
 * 链上无人持有该键 → receiver 建自有数据属性（允许）。
 *
 * receiver **有**自有该键时，原生只看自有描述符（数据槽看 writable、
 * 访问器看 setter），**不**上溯原型链——故本门只在「无自有该键」时查。
 *
 * 与 strict 赋值（$set）同源；Reflect.set 口径（[[Set]] 返 boolean、
 * 失败返 false **不抛**）由调用方镜像本判定（builtins/reflect.ts 的
 * case "set"）。
 *
 * Bug 197（类实例面）：原型的解析有两个来源——protoTable（Object.create /
 * setPrototypeOf 记录的 open obj）与**类注册表 / 品牌名面**
 * （builtins/ctor.ts 的 protoOfRecv）。**类实例**（brand 名 = 类名）不
 * 登记 protoTable，其 [[Prototype]] 是 `A.prototype`（protoBrandAbs 按名
 * 驻留的 brand Abs，与 `A.prototype` 成员读同一引用）——此前只查 protoTable
 * ⇒ 类实例原型链恒空 ⇒ 写门恒 allow ⇒ `Reflect.set(new A(), "x", 2)` 在
 * 原型只读属性上不拒写（假绿）。
 */
import type { Abs } from "../../abs.ts";
import { getProtoAbs, getSlot, type ObjShape } from "../../objects.ts";
import { extStateOf, getPropFlags } from "../../builtins/invariants.ts";
import { lookupObjAccessor } from "../../accessors.ts";
import { protoOfRecv } from "../../builtins/ctor.ts";
import { MAX_PROTO_DEPTH, ownPropHolder } from "./proto-walk.ts";

/** 原型链写门判定结果 */
export type ProtoSetVerdict =
  /** 允许写：链上无人持该键，或原型持该键但可写（receiver 建自有属性） */
  | { kind: "allow" }
  /** 拒写：命中不可写数据属性 / frozen 原型 / getter-only 访问器 → strict TypeError */
  | { kind: "deny" }
  /** 命中带 setter 的访问器 → 派发 setter（this = receiver，原生同） */
  | { kind: "setter"; setter: (t: Abs, v: Abs) => Abs };

/**
 * Bug 197：receiver 的 [[Prototype]] 解析——**两个来源**：
 * 1. protoTable（objects.ts 的 getProtoAbs）——`Object.create(p)` /
 *    `setPrototypeOf` 记录过的原型（open obj 走这条）；
 * 2. 类注册表 / 品牌名面（builtins/ctor.ts 的 protoOfRecv）——**类实例**
 *    （brand 名 = 类名）的原型是 `A.prototype`（protoBrandAbs 按名驻留的
 *    brand Abs，与 `A.prototype` 成员读同一引用）——类实例**未登记
 *    protoTable**，此前只查 protoTable ⇒ 原型链恒空 ⇒ 写门恒 allow ⇒
 *    `Reflect.set(new A(), "x", 2)` 在只读原型属性上不拒写（假绿）。
 *
 * protoOfRecv 对普通 obj 返回 Object.prototype（原生同）——Object.prototype
 * 自有面只有 constructor（可写）⇒ 不改写门判定（原生 Object.prototype 的
 * 数据属性皆可写，Object.prototype 自身是冻结档但只影响其自有键）。
 *
 * 抽象/不可判的原型（protoOfRecv 返 unknown）→ 链终止（sound 保守）。
 */
function protoOf(o: Abs): Abs | undefined {
  const registered = getProtoAbs(o);
  if (registered !== undefined) return registered;
  const p = protoOfRecv(o);
  if (!p || p.shape.k === "unknown") return undefined;
  return p;
}

/**
 * [[Set]] 原型链写门判定（**仅当 receiver 无自有该键时**调用）。
 *
 * @param o receiver（[[Set]] 的 this）
 * @param key 属性键（字符串）
 */
export function protoChainSetVerdict(o: Abs, key: string): ProtoSetVerdict {
  let p = protoOf(o);
  let depth = 0;
  const seen = new Set<object>();
  while (p !== undefined && depth++ < MAX_PROTO_DEPTH) {
    // 原型链防环：protoOfRecv 对 fn 形态返 functionProtoAbs 单例（自环），
    // 品牌名面也可能自环（protoBrandAbs 驻留）——同 Abs 不再上溯。
    if (seen.has(p as unknown as object)) break;
    seen.add(p as unknown as object);
    const holder = ownPropHolder(p);
    if (holder) {
      // 自有访问器遮蔽数据槽（原生 [[GetOwnProperty]] 单描述符语义）
      const acc = lookupObjAccessor(holder, key);
      if (acc) {
        if (!acc.set) return { kind: "deny" };
        return { kind: "setter", setter: acc.set };
      }
      const slot = getSlot((holder.shape as ObjShape).slots, key);
      if (slot) {
        // 数据属性：原型持该键 → 原型侧不可写则拒写
        if (extStateOf(p) === "frozen" || extStateOf(holder) === "frozen") return { kind: "deny" };
        if (getPropFlags(p)?.get(key)?.writable === false) return { kind: "deny" };
        if (getPropFlags(holder)?.get(key)?.writable === false) return { kind: "deny" };
        return { kind: "allow" };
      }
    }
    p = protoOf(p);
  }
  return { kind: "allow" };
}
