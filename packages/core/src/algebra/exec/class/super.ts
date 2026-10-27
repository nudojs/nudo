/**
 * super 家族：$super/$invokeSuper/$getSuper/$setSuper + 对象超与静态超。
 *
 * Invariants:
 * - super 解析沿注册表继承链（evalClassChain）；链洞（未注册父名）→
 *   sound unknown（不得闭 obj miss 折 wrong-exact undefined）。
 * - SUPER_PROTO_CHAIN_LIMIT 封顶 superProtoOf 递归（防原型环栈溢出）。
 * - 宿主内建父构造器（superBuiltinHost 标记）才放行宿主静态通道。
 */
import type { Abs } from "../../abs.ts";
import { abs, unknown } from "../../abs.ts";
import { getSlot, setSlot, propertyKeyOf, getProtoAbs, isNullProtoObj } from "../../objects.ts";
import { findClassAccessor, findStaticClassAccessor } from "../runtime/members.ts";
import { OBJECT_PROTO_METHOD_NAMES, objectProtoMethodAbs, builtinCtorAbs, protoOfRecv, protoBrandAbs } from "../../builtins.ts";
import { $set, $lit, asAbsVal, lookupObjAccessor, clearStaleTermPred } from "../runtime.ts";
import { withNewTargetReset, throwStrictWrite, undef } from "../runtime/state.ts";
import { $call } from "../call.ts";
import { getFnImpl } from "../../abs-fn.ts";
import { extStateOf, getPropFlags } from "../../builtins.ts";
// 直连 member.ts（不经 containers barrel）：本模块体加载期即回调本 setter，
// vite SSR 下 barrel 的 re-export 不是实例化期可用绑定（原单文件拓扑中
// setter 是本模块提升函数声明）。barrel 间接层会在此处拿到 undefined。
import { errorTypeAbs } from "../may-throw.ts";
import { NudoThrow } from "../runtime.ts";
import {
  getEvalClass,
  lookupClassValue,
} from "../class-registry.ts";

import { findMethod, findStaticMethod, constructClass, applyInstanceFields, markSuperCalled, superCalledFor } from "./declare.ts";
import { $setKey } from "./this-member.ts";

/**
 * super(...)：父类构造写入字段（this 保持子类 brand）。
 * transpile: super(a,b) → __this = $super(__this, "Child", [a,b])
 */
export function $super(thisVal: Abs, childName: string, args: Abs[]): Abs {
  const child = getEvalClass(childName);
  // Bug 245：派生构造器**只能调一次** super()——第二次定抛 ReferenceError
  // （"Super constructor may only be called once"）。状态在 declare.ts 的
  // 模块级 WeakMap 侧表（markSuperCalled / superCalledFor）——键 = 实例
  // Abs 身份 + **本层子类名**（同一实例沿继承链逐层传递，内层的 super()
  // 不得误判外层的「已调」）。
  if (superCalledFor(thisVal, childName)) {
    throw new NudoThrow(errorTypeAbs("ReferenceError"));
  }
  markSuperCalled(thisVal, childName);
  // Bug 11：extends null 的显式 super()：原生 TypeError
  // （Super constructor null of … is not a constructor）
  if (child?.superNull) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  const parentName = child?.superName;
  if (!parentName) return thisVal;
  let after = constructClass(parentName, thisVal, args);
  // Bug 59：super() 返回后初始化子类实例字段（原生 InitializeInstanceElements）
  if (child) after = applyInstanceFields(child, after);
  if (after && after.shape.k === "brand") {
    // 保持子类 brand 名
    if (after.shape.name === childName) {
      // 已是子类 brand 名 ⇒ **不重铸 Abs**（保持 Abs 身份）。理由：内建集合
      // 的条目表按 **Abs 身份** 驻留（collections.ts 的 WeakMap）——重铸会
      // 丢表 ⇒ 含内建父的类链（class MyMap extends Map）实例读不到条目。
      // 原生 super() 返回的就是**同一个 this**（不换对象）——此处同口径。
      markSuperCalled(after, childName);
      return after;
    }
    const next = abs(
      { k: "brand", name: childName, shape: after.shape.shape },
      after.term,
      after.pred,
      after.conf,
    );
    // Bug 245：$super 返回**新** brand Abs（内层 obj 共享）——「已调 super」
    // 标记随实例传递到出参，第二次 super() 才拦得住。
    markSuperCalled(next, childName);
    return next;
  }
  if (after && typeof after === "object") markSuperCalled(after, childName);
  return after ?? thisVal;
}

/** super.method()：从父类起找（跳过自身覆盖） */
export function $invokeSuper(
  thisVal: Abs,
  childName: string,
  method: string,
  args: Abs[],
): Abs {
  // Bug 79：super.m() 是方法调用（普通调用面）——new.target 归 undefined
  return withNewTargetReset(() => {
    const child = getEvalClass(childName);
    const parentName = child?.superName;
    if (!parentName) return unknown;
    const m = findMethod(parentName, method);
    if (!m) {
      // Bug 194 遗留（族 59 · W9）：父链闭合且该名**确不存在** ⇒ 原生抛
      // TypeError（`super.m is not a function`）——此前一律折 unknown
      // （假阴性：删方法后 super 调用面看不出原生会抛）。
      if (superMethodAbsent(parentName, method)) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      return unknown;
    }
    return m(thisVal, ...args);
  });
}

/**
 * Bug 194 遗留（族 59 · W9）：`super.m()` 的**缺席判定**——父类原型链上
 * 确实没有该方法 ⇒ 原生 `super.m is not a function`（TypeError，可被用户
 * try/catch 吸收）。
 *
 * 判「确实不存在」需三条**同时**成立（任一不成立 ⇒ 保守 unknown，**绝不假抛**）：
 *
 * 1. **父链闭合**：链上每个类都在注册表里（宿主/未注册父名 ⇒ 链开——内建父
 *    的原型面不可枚举）；fn 伪父（`class B extends (function(){}) {}`）的父
 *    是普通函数，其原型面不受注册表管 ⇒ 链开；
 * 2. **无动态原型写**：`A.prototype.m = fn` 写在注册表之外（注册表只收类体
 *    方法）⇒ 该方法可能存在 ⇒ 链开（原型槽面可见 ⇒ 判存在）；同名**访问器**
 *    （getter 可能返回可调用值）⇒ 链开；
 * 3. **不是 Object.prototype 成员**：链尾（无 extends）接 Object.prototype ⇒
 *    `super.toString()` / `super.hasOwnProperty(…)` 原生存在 ⇒ 不是 TypeError
 *    （引擎不建 Object.prototype 方法的调用面 ⇒ 仍折 unknown）。
 */
function superMethodAbsent(parentName: string, method: string): boolean {
  let cur: string | undefined = parentName;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const spec = getEvalClass(cur);
    if (!spec) return false; // 链洞（宿主 / 未注册父名）⇒ 不可判
    // fn 伪父：父是普通函数值（原型面不受注册表管）⇒ 不可判
    const cv = lookupClassValue(cur);
    if (cv && cv.shape.k === "fn") return false;
    // 同名访问器：super.m 取到 getter 的返回值（可能是函数）⇒ 不可判
    if (spec.accessors && Object.hasOwn(spec.accessors, method)) return false;
    // 动态原型写（A.prototype.m = fn）：注册表外 ⇒ 方法可能存在 ⇒ 不可判
    // （constructor 槽是原型对象自带的，不算动态写）
    if (method !== "constructor" && protoSlotHasKey(cur, method)) return false;
    if (spec.superNull) return true; // extends null：链止于此（无 Object.prototype 尾）
    const next = spec.superName;
    if (!next) {
      // 链尾 = Object.prototype
      if (method === "constructor") return true; // 父类构造器本身（原生调用抛 TypeError）
      if (OBJECT_PROTO_METHOD_NAMES.has(method)) return false;
      return true;
    }
    cur = next;
  }
  return false; // 环（防御）
}

/** 类原型对象上有该键的槽（动态原型写 / 内建槽）——不可判 ⇒ true（开链） */
function protoSlotHasKey(className: string, key: string): boolean {
  const pb = protoBrandAbs(className);
  if (pb.shape.k !== "brand") return true;
  const inner = pb.shape.shape;
  if (inner.shape.k !== "obj") return true;
  return !!getSlot(inner.shape.slots, key);
}

/** 类实例方法内 super.p / super[k] 属性读（Bug 14）：父类原型链上的
 *  访问器以 this 调用；实例字段/自有槽不在查找面（super 读的是原型）。
 *  方法作为值（super.m 未调用）不做 fn Abs 投影——诚实 unknown。
 *  R2a：闭链缺槽折 undefined——父链全为已注册求值类且终止于「无
 *  extends」（尾巴 Object.prototype）/「extends null」（无尾巴）时，
 *  缺键原生读 undefined（`super.x += 5` 折 NaN）；setter-only 访问器
 *  挡链读同样 undefined。宿主基类（extends Array/Error 等未注册名）/
 *  抽象键 → 链开 → 诚实 unknown。Object.prototype 尾巴与 $get 闭 obj
 *  缺槽同口径（方法名/constructor/__proto__ 不折 undefined）。 */
export function $getSuper(thisVal: Abs, childName: string, key: Abs): Abs {
  const k = propertyKeyOf(key);
  if (k === undefined) return unknown;
  const childSpec = getEvalClass(childName);
  if (!childSpec) return unknown;
  // extends null：B.prototype 之上无链（无 Object.prototype 尾巴）
  if (childSpec.superNull) return undef();
  let cur: string | undefined = childSpec.superName;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const spec = getEvalClass(cur);
    if (!spec) return unknown; // 宿主/未注册基类：原型面不可枚举 → 链开
    // Bug 266：`super.constructor` = **父类构造器本身**（原生父类原型上的
    // "constructor" 自有属性 ⇒ 父类值；ClassDefinitionEvaluation 装它时
    // 覆盖类体里同名访问器）。引擎此前只在 spec.methods 里找 "constructor"
    // ⇒ 找不到 ⇒ 回落内置 `Object` ⇒ `Sub.who() => "Object"`、
    // `super.constructor === Base` 假 false（确定错值）。
    // 取法：类值注册表（lookupClassValue）——注册表存的就是 $class 产出的
    // 类值 Abs 本身（与源码里的 `Base` 绑定同一引用 ⇒ === 恒真）。
    if (k === "constructor") {
      const ctorVal = lookupClassValue(cur);
      if (ctorVal) return ctorVal;
      // 父类已注册但**无类值**（宿主函数声明 / 手写 spec）⇒ 构造器值不可
      // 表示 ⇒ 诚实 unknown（不得回落内置 Object——那是确定错值）。
      return unknown;
    }
    const acc = spec.accessors?.[k];
    // 访问器挡链（含 setter-only：读止步于此 → undefined）
    if (acc) return acc.get ? acc.get(thisVal) : undef();
    // 方法存在（作为值读取）：不做 fn 投影——诚实 unknown，不得折 undefined
    if (spec.methods?.[k]) return unknown;
    if (spec.superNull) return undef(); // extends null：链终止，无尾巴
    cur = spec.superName; // 无 superName → 循环退出 → Object.prototype 尾巴
  }
  if (cur) return unknown; // 环（防御）：链不可判定
  // Object.prototype 尾巴（闭）：与 $get 闭 obj 缺槽同口径
  if (OBJECT_PROTO_METHOD_NAMES.has(k)) return objectProtoMethodAbs(k);
  if (k === "constructor") return builtinCtorAbs("Object");
  if (k === "__proto__") {
    const p = protoOfRecv(thisVal);
    return isNullProtoObj(p) ? undef() : p;
  }
  return undef();
}

/** 类实例方法/构造器内 super.k = v（Bug 55）：SetSuper——沿父类原型链找
 *  setter（以接收者 this 调用）；getter-only 挡链 → strict TypeError；
 *  无 setter → 原生折接收者自有数据属性（CreateDataProperty on this）。
 *  子类自有同名访问器不拦截 super 写（查找从父类起）——绕过 $set 的
 *  访问器派发直写接收者槽（brand 内层 in-place，引用语义）。 */
export function $setSuper(thisVal: Abs, childName: string, key: Abs, value: Abs): Abs {
  const k = propertyKeyOf(key);
  if (k === undefined) {
    // 抽象键：链上 setter 不可判定 → 计算键写（sound 过近似，不假精确）
    return $setKey(thisVal, key, value);
  }
  const parentName = getEvalClass(childName)?.superName;
  if (parentName) {
    const acc = findClassAccessor(parentName, k);
    if (acc) {
      if (acc.set) return acc.set(thisVal, value);
      // getter-only 访问器：strict TypeError（catch 可吸收）
      throwStrictWrite();
    }
    if (findClassAccessor(childName, k)) {
      // 子类-only 访问器：super 写不得派发它——接收者自有槽直写
      if (thisVal.shape.k === "brand" && thisVal.shape.shape.shape.k === "obj") {
        if (extStateOf(thisVal) === "frozen") throwStrictWrite();
        const inner = thisVal.shape.shape.shape as { slots: Record<string, { value: Abs }> };
        const st = extStateOf(thisVal);
        if ((st === "sealed" || st === "nonext") && !getSlot(inner.slots, k)) {
          throwStrictWrite();
        }
        if (getPropFlags(thisVal)?.get(k)?.writable === false) throwStrictWrite();
        setSlot(inner.slots, k, { value: asAbsVal(value) });
        clearStaleTermPred(thisVal);
        return thisVal;
      }
      return $setKey(thisVal, $lit(k), value);
    }
  }
  // 无 setter：$set 的实例字段写（frozen/sealed/不可变标志检查 + in-place）
  return $set(thisVal, k, value);
}

/** 类实例方法内 super[k](args) 计算键调用（Bug 14）：ToPropertyKey 后沿父类链派发 */
export function $invokeSuperKey(
  thisVal: Abs,
  childName: string,
  key: Abs,
  args: Abs[],
): Abs {
  const k = propertyKeyOf(key);
  if (k === undefined) return unknown;
  const parentName = getEvalClass(childName)?.superName;
  if (!parentName) return unknown;
  const m = findMethod(parentName, k);
  if (!m) {
    // Bug 194 遗留（族 59 · W9）：同 $invokeSuper——缺席且父链闭合 ⇒ TypeError
    if (superMethodAbsent(parentName, k)) {
      throw new NudoThrow(errorTypeAbs("TypeError"));
    }
    return unknown;
  }
  return withNewTargetReset(() => m(thisVal, ...args));
}

/**
 * 对象字面量方法内 super 派发（Bug 19）：home object 的原型（运行时
 * 侧表，setProtoAbs 记录）沿链查找方法/访问器（排除自有——否则覆盖方法
 * 自递归），以接收者 thisVal 调用/求值。链未建模（无显式原型设定 /
 * Object.prototype 面）→ 诚实 unknown。
 */
const SUPER_PROTO_CHAIN_LIMIT = 8;

function superProtoOf(o: Abs): Abs | undefined {
  return o.shape.k === "obj" ? getProtoAbs(o) : undefined;
}

/** super.m() / super[k]()：原型链方法查找 + receiver 注入调用 */
export function $invokeSuperObj(thisVal: Abs, key: Abs, args: Abs[]): Abs {
  const k = propertyKeyOf(key);
  if (k === undefined) return unknown;
  let cur = superProtoOf(thisVal);
  let hops = 0;
  while (cur && hops++ < SUPER_PROTO_CHAIN_LIMIT) {
    if (cur.shape.k === "obj") {
      const slot = getSlot(cur.shape.slots, k);
      const impl = slot ? getFnImpl(slot.value) : undefined;
      if (impl) {
        return withNewTargetReset(() =>
          $call(slot!.value, args, thisVal),
        );
      }
    }
    cur = superProtoOf(cur);
  }
  return unknown;
}

/** super.v / super[k]：原型链属性读（访问器 getter 以 this 调用；数据槽直读）。
 *  R2a：闭链缺槽折 undefined——home 原型链全为闭 obj 且终止（无记录
 *  原型 → Object.prototype 尾巴 / 显式 null-proto）时缺键原生读
 *  undefined；开 obj / 品牌 / 超深链 → 链开 → 诚实 unknown。 */
export function $getSuperObj(thisVal: Abs, key: Abs): Abs {
  const k = propertyKeyOf(key);
  if (k === undefined) return unknown;
  // 非 obj 接收者（borrow-call 的 brand this 等）：home 链不可判
  if (thisVal.shape.k !== "obj") return unknown;
  let cur: Abs = thisVal;
  let hops = 0;
  while (hops++ < SUPER_PROTO_CHAIN_LIMIT) {
    const proto = superProtoOf(cur);
    if (proto === undefined) {
      // 链终止：显式 null-proto → 之上无链；否则尾巴是 Object.prototype
      //（闭，与 $get 闭 obj 缺槽同口径）
      if (isNullProtoObj(cur)) return undef();
      if (OBJECT_PROTO_METHOD_NAMES.has(k)) return objectProtoMethodAbs(k);
      if (k === "constructor") return builtinCtorAbs("Object");
      if (k === "__proto__") {
        const p = protoOfRecv(thisVal);
        return isNullProtoObj(p) ? undef() : p;
      }
      return undef();
    }
    if (proto.shape.k !== "obj") return unknown; // 品牌等未建模原型 → 链开
    const acc = lookupObjAccessor(proto, k);
    // 访问器挡链（含 setter-only：读止步于此 → undefined）
    if (acc) return acc.get ? acc.get(thisVal) : undef();
    if ((proto.shape as { open?: boolean }).open) return unknown; // 开 obj：键集不完整
    const slot = getSlot(proto.shape.slots, k);
    if (slot) return slot.value;
    cur = proto;
  }
  return unknown;
}

/** 对象字面量方法内 super.k = v（Bug 55 home object 面）：home 原型链
 *  （运行时侧表）上找访问器 setter（以接收者调用）；getter-only →
 *  strict TypeError；数据槽/缺槽 → 原生折接收者自有写（$set）。 */
export function $setSuperObj(thisVal: Abs, key: Abs, value: Abs): Abs {
  const k = propertyKeyOf(key);
  if (k === undefined) return $setKey(thisVal, key, value);
  let cur = superProtoOf(thisVal);
  let hops = 0;
  while (cur && hops++ < SUPER_PROTO_CHAIN_LIMIT) {
    if (cur.shape.k === "obj") {
      const acc = lookupObjAccessor(cur, k);
      if (acc) {
        if (acc.set) return acc.set(thisVal, value);
        throwStrictWrite();
      }
    }
    cur = superProtoOf(cur);
  }
  return $set(thisVal, k, value);
}

/** 静态方法体内 super.m(args) / super[k](args)（R5）：沿父类**静态**链查找
 *  （home = 类值，[[Prototype]] = 父构造器——Bug 18 链），以接收者类值
 *  为 this 调用（原生 super.m() 的 this 是外围 this = 调用类，非父类）。 */
export function $staticSuperInvoke(
  thisVal: Abs,
  childName: string,
  key: Abs,
  args: Abs[],
): Abs {
  const k = propertyKeyOf(key);
  if (k === undefined) return unknown;
  const parentName = getEvalClass(childName)?.superName;
  if (!parentName) return unknown;
  const m = findStaticMethod(parentName, k);
  if (!m) return unknown;
  return withNewTargetReset(() => m(thisVal, ...args));
}

/** 静态方法体内 super.k = v（R5 / SetSuper 静态面）：沿父类静态链找 setter
 *  （以接收者类值调用）；getter-only 挡链 → strict TypeError；数据字段/
 *  缺槽 → 原生折接收者自有数据属性（OrdinarySetWithOwnDescriptor：
 *  CreateDataProperty on this = 调用类值，父类槽不动）。 */
export function $setSuperStatic(thisVal: Abs, childName: string, key: Abs, value: Abs): Abs {
  const k = propertyKeyOf(key);
  if (k === undefined) {
    // 抽象键：链上 setter 不可判定 → 接收者计算键写（sound 过近似）
    return $setKey(thisVal, key, value);
  }
  const parentName = getEvalClass(childName)?.superName;
  if (parentName) {
    const sacc = findStaticClassAccessor(parentName, k);
    if (sacc) {
      if (sacc.set) return sacc.set(thisVal, value);
      // getter-only 访问器：strict TypeError（catch 可吸收）
      throwStrictWrite();
    }
  }
  // 无 setter：接收者（类值）自有槽写（$set 类值臂就地共享 slots）
  return $set(thisVal, k, value);
}
