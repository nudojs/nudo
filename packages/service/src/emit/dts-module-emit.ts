/**
 * 模块导出面的声明发射器：导出名解析、导出形态、声明行胶水。
 *
 * 从 `dts-generator.ts` 抽出。这里只处理「一条已定型的签名如何按导出形态
 * 落地」，不读取 Abs / 投影上下文。
 */
import { isJsBindingIdent } from "@nudojs/core/internal";
import type { DtsModuleSurface } from "./dts-ir.ts";
import { exportNameRepr } from "./export-binding.ts";
import { dtsIdentifier } from "./dts-text.ts";

/**
 * 本地名 → 全部导出名（源码序）。
 *
 * 本地名本身也是导出名时排在最前；匿名 default（普查名 `default`）单独走
 * 一条。只按 `exportBindings` 记账，不猜 `export {}` 的语法形态。
 */
export function dtsExportNamesOf(surface: DtsModuleSurface, localName: string): string[] {
  // 匿名 default（普查名 "default"）
  if (localName === "default") return ["default"];
  const names: string[] = [];
  for (const [exportName, local] of surface.exportBindings) {
    if (local !== localName) continue;
    if (!names.includes(exportName)) names.push(exportName);
  }
  const self = names.indexOf(localName);
  if (self > 0) {
    names.splice(self, 1);
    names.unshift(localName);
  }
  return names;
}

/** 主声明之外的附加导出名（补一条 `export { <declared> as <name> };`） */
type DtsExportExtra = { exportNameRepr: string };

/** 导出形态 → 声明写法 */
export type DtsExportForm =
  | { kind: "none" }
  | { kind: "named"; exportName: string; extras?: DtsExportExtra[] }
  | { kind: "member"; memberName: string }
  | { kind: "default"; localName: string; extras?: DtsExportExtra[] }
  /**
   * BUG-008：CJS `module.exports = <单值>`。运行期 `require()` 拿到的就是那个
   * 值，ESM 的 `export default` / `export declare function` 声明与真实形态不符
   * ⇒ 消费方 `import f from "./x.cjs"` 报 TS2349（没有调用签名）。
   * `localName` = 产物里承载该值的本地名（匿名右值用 `_default`）。
   */
  | { kind: "exportEquals"; localName: string }
  | {
      kind: "alias";
      exportName: string;
      exportNameRepr: string;
      localName: string;
      extras?: DtsExportExtra[];
    };

/** 导出形态解析（模块面优先；无模块面 ⇒ 普查名即导出名） */
export function dtsExportForm(
  localName: string,
  surface: DtsModuleSurface | undefined,
): DtsExportForm {
  if (!surface) {
    if (localName === "default") return { kind: "default", localName: "" };
    return { kind: "named", exportName: dtsIdentifier(localName) };
  }
  // BUG-008：`module.exports = <单值>` 的模块形态是 `export =`，不是 ESM 导出。
  // 必须先于 exportBindings 判定——扫描面为了「名字可解析」把该本地名登记成
  // 具名导出，但那只是内部记账，不是模块形态。
  if (surface.exportEquals !== undefined) {
    const target = surface.exportEquals.local;
    const hit = target === "" ? localName === "default" : localName === target;
    if (hit) return { kind: "exportEquals", localName: target === "" ? "_default" : target };
  }
  const names = dtsExportNamesOf(surface, localName);
  const exportName = names[0];
  if (exportName === undefined) return { kind: "none" };
  const extras = names.slice(1).map((n) => ({ exportNameRepr: exportNameRepr(n) }));
  const withExtras = extras.length > 0 ? { extras } : {};
  if (exportName === "default") {
    // 匿名 default（普查名 "default"）⇒ `export default function (…)`
    return {
      kind: "default",
      localName: localName === "default" ? "" : localName,
      ...withExtras,
    };
  }
  if (exportName === localName || !isJsBindingIdent(localName)) {
    // 本地名不是合法绑定名 ⇒ 不能 `declare function <local>` + 别名导出
    return { kind: "named", exportName: dtsIdentifier(exportName), ...withExtras };
  }
  return {
    kind: "alias",
    exportName,
    exportNameRepr: exportNameRepr(exportName),
    localName,
    ...withExtras,
  };
}

/** 导出形态 → 导出名（类成员不是模块级导出 ⇒ undefined） */
export function dtsFormExportName(form: DtsExportForm): string | undefined {
  switch (form.kind) {
    case "named":
      return form.exportName;
    case "alias":
      return form.exportName;
    case "default":
      return "default";
    case "exportEquals":
      // `export = X` 对 ESM 消费方等价于 default 导入；台账按导出名记账。
      return form.localName;
    default:
      return undefined;
  }
}

/** 主声明之外的导出名 → `export { <declared> as <name> };` 行 */
function dtsExtraExportLines(
  declared: string | undefined,
  extras: DtsExportExtra[] | undefined,
): string[] {
  if (declared === undefined) return [];
  return (extras ?? []).map((e) => `export { ${declared} as ${e.exportNameRepr} };`);
}

/**
 * BUG-175：源码里的**无体重载声明** → `.d.ts` / stdout 平铺面都能编译的
 * ambient 形态。
 *
 * `.d.ts` 里裸 `export function f(a: string): string;` 本来合法（文件级
 * ambient 上下文），但 stdout 是把同一份文本平铺进**普通 `.ts` 模块**——
 * 非 ambient 的重载签名（无实现）会与实现的 `declare` 混排成 TS2384。
 * 统一补 `declare` 后两处都是 ambient 声明。
 */
export function ambientFunctionDeclarationText(text: string): string {
  const t = text.trim();
  if (/^export\s+declare\s+(async\s+)?function\b/.test(t)) return t;
  if (/^declare\s+(async\s+)?function\b/.test(t)) return t;
  if (/^export\s+(async\s+)?function\b/.test(t)) return t.replace(/^export\s+/, "export declare ");
  if (/^(async\s+)?function\b/.test(t)) return `declare ${t}`;
  return t;
}

/**
 * BUG-175：重载集已由镜像声明发射 ⇒ 实现签名只补**导出胶水**。
 *
 * 具名自导出（`export function f(…)`）的镜像行自带 `export`，无需补；
 * `export { f as g }` / default / `export =` 的导出语句原本挂在实现声明上，
 * 抑制实现后必须单独补回，否则导出面消失。
 */
export function overloadExportGlue(
  form: DtsExportForm,
  declaredExported: boolean,
): string[] {
  switch (form.kind) {
    case "named":
      // 声明本身带 `export` ⇒ 已是导出面成员；否则补一条导出语句
      return declaredExported || !isJsBindingIdent(form.exportName)
        ? []
        : [`export { ${form.exportName} };`];
    case "alias":
      return [
        `export { ${form.localName} as ${form.exportNameRepr} };`,
        ...dtsExtraExportLines(form.localName, form.extras),
      ];
    case "default":
      return [
        `export { ${form.localName} as default };`,
        ...dtsExtraExportLines(form.localName, form.extras),
      ];
    case "exportEquals":
      return [`export = ${form.localName};`];
    default:
      return [];
  }
}

/**
 * 声明行（按导出形态；`signature` = `(<params>): <ret>`，可含类型参数）。
 *
 * `compatSignature`：Bug 57 兼容位——named 形态带源码类型形参时，除
 * `f<T>(…)` 主声明外再补一条同签名的非泛型重载，使「泛型函数旧文本形态」
 * 的既有钉与消费端都成立（TS 允许重载；带显式类型实参的调用命中泛型那条）。
 */
export function dtsExportDeclaration(
  form: DtsExportForm,
  signature: string,
  compatSignature?: string,
): string[] {
  switch (form.kind) {
    case "named":
      return [
        `export declare function ${form.exportName}${signature};`,
        ...(compatSignature
          ? [`export declare function ${form.exportName}${compatSignature};`]
          : []),
        ...dtsExtraExportLines(form.exportName, form.extras),
      ];
    case "member":
      return [`${form.memberName}${signature};`];
    case "default":
      if (form.localName) {
        return [
          `export default function ${form.localName}${signature};`,
          ...dtsExtraExportLines(form.localName, form.extras),
        ];
      }
      // 匿名默认函数：`.d.ts` 上下文里 `export default function (…)` 合法。
      // stdout 平铺面（普通 .ts 模块）需要 `ambientizeDtsSegment` 支持匿名
      // 形态——根因在 packages/nudojs/src/commands/export/stdout.ts，超出
      // 本文件改动范围（见最终汇报），此处保持既有发射形态不动。
      return [`export default function ${signature};`];
    case "alias":
      return [
        `declare function ${form.localName}${signature};`,
        `export { ${form.localName} as ${form.exportNameRepr} };`,
        ...dtsExtraExportLines(form.localName, form.extras),
      ];
    case "exportEquals":
      // `export = <local>` 只允许一条，且不得与其他导出语句共存（TS2309）；
      // 声明本身必须**不带 export**（否则变成 ESM 具名导出 + TS2309）。
      return [
        `declare function ${form.localName}${signature};`,
        `export = ${form.localName};`,
      ];
    default:
      return [];
  }
}
