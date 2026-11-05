/**
 * memo 键里的**身份注册表**（check 整文件 memo 与 generalize L0 共用）。
 *
 * - `loadModuleId`：loader 函数对象 → 数字 id。身份键（同一对象跨调用稳定），
 *   与内容指纹互补——CLI 每次新建 loader 对象时走内容指纹，宿主复用同一
 *   loader 时身份命中。
 * - `moduleMapId`：模块表对象 → `m<id>`。同信任模型（调用方同表对象跨调用）。
 *
 * 两个缓存共用同一注册表（id 只需进程内唯一，不要求按缓存分区）；键本身
 * 不透明，测试不得断言具体数值。
 */

const loadModuleIds = new WeakMap<object, number>();
let nextLoadModuleId = 1;

export function loadModuleId(
  fn?: (spec: string, fromFile: string) => string | undefined,
): number {
  if (!fn) return 0;
  let id = loadModuleIds.get(fn);
  if (id === undefined) {
    id = nextLoadModuleId++;
    loadModuleIds.set(fn, id);
  }
  return id;
}

const moduleMapIds = new WeakMap<object, number>();
let moduleMapIdSeq = 0;

export function moduleMapId(m: object | undefined): string {
  if (!m) return "-";
  let id = moduleMapIds.get(m);
  if (id === undefined) {
    id = ++moduleMapIdSeq;
    moduleMapIds.set(m, id);
  }
  return `m${id}`;
}
