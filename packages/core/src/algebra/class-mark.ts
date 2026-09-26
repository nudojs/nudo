/**
 * class 值身份标记（叶子模块）。
 * surface(typeofAbs) 与 exec($class/$instanceof/$set/$copy) 共用；
 * 独立于 class-registry，避免 algebra/surface 反向依赖 exec。
 */
const classValues = new WeakMap<object, string>();

export function markClassValue(v: object, name: string): void {
  classValues.set(v, name);
}

export function classNameOfValue(v: object): string | undefined {
  return classValues.get(v);
}
