/**
 * package.json#nudo 键的**形状**问题探针（Bug 468 / 936）。
 *
 * 背景（service 侧已修，CLI 报告面看不到）：
 * - 468：`nudo` 键的**值不是对象**（`"nudo": true` / `"adoption"` / `[]` …）
 *   时配置层按「无配置」处理并给一条 stderr 提示——但 check / health 的
 *   **报告面**看不到 ⇒ 用户不知道自己写错了。
 * - 936：子包 package.json 的 `nudo` 键是**假值**（`false` / `null` / `0` /
 *   `""`）时按「本包无 nudo 配置」处理（不继承祖先配置）——同样只有 stderr。
 *
 * 本探针**只读**、**零依赖**：从目标目录向上找**第一个含 `nudo` 键**的
 * package.json（与服务侧 `findProjectConfig` 同一停步规则：键**存在**即停，
 * 「无 nudo 键」才继续向上），判定其值形状。
 *
 * 不复用 service 侧实现的原因：service 的 `findProjectConfig` 对非法形状
 * 返回 `null`（=「本子树没有项目配置」），CLI 无法区分「压根没有
 * package.json#nudo」与「有但写坏了」——而这两者对 onboarding 提示的含义
 * 相反（见 check-report.ts 的 onboarding 条件）。
 */
import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseJsonText } from "./read-json.ts";

/**
 * 报告面诊断码（468/936）。
 *
 * **刻意不用 `nudo:` 前缀**：新增 `nudo:*` 码必须在
 * `packages/website/docs/reference/diagnostics.md`（en + zh）有显式锚点
 * ——docs-coverage 门禁按 `code: "nudo:*"` 字面量扫描源码强制；CLI 包无权
 * 改网站文档 ⇒ 用非 `nudo:` 码（与既有的 `syntax-error` 同类做法），
 * 既避开打不出的文档深链（printDocsLinks 只认 `nudo:` 前缀码），也
 * 不引入新的注册表/文档耦合。
 */
export const CONFIG_SHAPE_CODE = "config-shape";

/** 配置形状问题（一条 = 一个 package.json） */
export type ConfigShapeIssue = {
  /** 出问题的 package.json 绝对路径 */
  pkgPath: string;
  /** 原始值的可读渲染 */
  value: string;
  /** 是否假值（false / null / 0 / ""）——与「非法真值形状」分开说 */
  falsy: boolean;
  /** 面向用户的一句话（check / health 报告面直接用） */
  message: string;
};

/** 值的可读描述（JSON 优先；循环引用等异常形状回落 typeof） */
function describeValue(raw: unknown): string {
  try {
    const s = JSON.stringify(raw);
    return s === undefined ? String(raw) : s;
  } catch {
    return typeof raw;
  }
}

/**
 * 最近的、含 `nudo` 键的 package.json 的形状问题；无问题返回 null。
 *
 * 停步规则与服务侧一致：
 * - package.json 不存在 ⇒ 继续向上；
 * - package.json 读/解析失败 ⇒ **停**（service 侧同样 fail-closed 停在
 *   这里并另有一条 stderr 诊断；本探针不重复该诊断，只是不越权上报）；
 * - 有 `nudo` 键 ⇒ 停（键存在即遮断祖先搜索）。
 */
export function projectConfigShapeIssue(startDir: string): ConfigShapeIssue | null {
  let dir = resolve(startDir);
  const root = resolve("/");
  while (dir !== root) {
    const pkgPath = resolve(dir, "package.json");
    let exists = false;
    try {
      exists = statSync(pkgPath, { throwIfNoEntry: false }) !== undefined;
    } catch {
      // stat 失败（EACCES…）：service 侧在此 fail-closed 停步并告警——
      // 本探针同样停步（不越权猜测祖先配置）。
      return null;
    }
    if (exists) {
      let pkg: unknown;
      try {
        pkg = parseJsonText(readFileSync(pkgPath, "utf-8"));
      } catch {
        return null; // 解析失败：service 侧另有诊断，本探针不重复
      }
      if (pkg !== null && typeof pkg === "object") {
        if (Object.prototype.hasOwnProperty.call(pkg, "nudo")) {
          const value = (pkg as { nudo?: unknown }).nudo;
          const valid = value !== null && typeof value === "object" && !Array.isArray(value);
          if (valid) return null;
          const falsy = !value;
          return {
            pkgPath,
            value: describeValue(value),
            falsy,
            message:
              `package.json at ${pkgPath} has ${falsy ? "a falsy" : "an invalid"} "nudo" key ` +
              `(${describeValue(value)}; expected an object) — this package has no nudo config ` +
              `(ancestor configs are not inherited)`,
          };
        }
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * `nudo.cache` 子键的形状问题（对象形态 `{ dir?, sign? }` 的 typo 防护）。
 *
 * 与 468/936 / `nudo.env` 探针同一口径：service 侧对非法形状宽松归一
 * （`dir` 非法 → 默认根；`sign` 非法 → **配置错误**，由 `diskCacheSignState`
 * 拒绝运行）——本探针让**报告面**可见，用户不用从「sign 报错 / dir 没生效」
 * 的现象倒推 typo。停步规则不需要重走：`projectDir` 已由 findProjectConfig
 * 定位，直接读那一份。
 */
export function projectCacheShapeIssue(projectDir: string | undefined): ConfigShapeIssue | null {
  if (!projectDir) return null;
  const pkgPath = resolve(projectDir, "package.json");
  let pkg: unknown;
  try {
    pkg = parseJsonText(readFileSync(pkgPath, "utf8"));
  } catch {
    return null; // 读/解析失败：service 侧另有诊断，本探针不重复
  }
  if (pkg === null || typeof pkg !== "object") return null;
  const nudo = (pkg as { nudo?: unknown }).nudo;
  if (nudo === null || typeof nudo !== "object" || Array.isArray(nudo)) return null;
  const raw = (nudo as { cache?: unknown }).cache;
  if (raw === undefined || typeof raw === "boolean" || typeof raw === "string") return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return {
      pkgPath,
      value: describeValue(raw),
      falsy: !raw,
      message:
        `package.json at ${pkgPath} has an invalid "nudo.cache" value ` +
        `(${describeValue(raw)}; expected true | false | a directory string | an object { dir?, sign? }) ` +
        `— the disk cache stays off`,
    };
  }
  // 对象形态：未知键 = typo 防护（与 --profile typo 警告同动机）；
  // sign/dir 的形状错误由本探针点名（service 侧 sign 非法 = 拒绝运行）
  const obj = raw as Record<string, unknown>;
  const unknownKeys = Object.keys(obj).filter((k) => k !== "dir" && k !== "sign");
  const badSign = obj.sign !== undefined && typeof obj.sign !== "boolean";
  const badDir =
    obj.dir !== undefined && typeof obj.dir !== "string" && typeof obj.dir !== "boolean";
  if (unknownKeys.length === 0 && !badSign && !badDir) return null;
  const problems: string[] = [];
  if (unknownKeys.length > 0) {
    problems.push(
      `unknown key(s) ${unknownKeys.map((k) => `"cache.${k}"`).join(", ")} (allowed: dir, sign)`,
    );
  }
  if (badSign) problems.push(`"cache.sign" must be boolean (got ${describeValue(obj.sign)})`);
  if (badDir) {
    problems.push(
      `"cache.dir" must be a directory string or boolean (got ${describeValue(obj.dir)})`,
    );
  }
  return {
    pkgPath,
    value: describeValue(raw),
    falsy: !raw,
    message:
      `package.json at ${pkgPath} has an invalid "nudo.cache" object ` +
      `(${problems.join("; ")})`,
  };
}
