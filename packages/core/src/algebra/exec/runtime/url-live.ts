/**
 * Bug 65：`URL.searchParams` 是与父 URL **同源的 live view**。
 *
 * `urlBrandAbs` 把组件存成构造期快照，另把 searchParams 存成一个独立的
 * URLSearchParams brand；`set` / `append` / `delete` / `sort` 只原地改那个
 * brand 的 `@@entries` 槽，没有任何反向指针 ⇒ 父 URL 的 `search` / `href`
 * 永远停在旧串（自信错值）。
 *
 * 修法（本文件 = exec 侧的反向指针 + 变更后回写）：
 * - 读 `u.searchParams` 时把父 URL 登记到该 brand（member.ts 的读面接线）；
 * - URLSearchParams 的变更方法返回后（invoke.ts 的分派出口接线）按新条目
 *   重算父 URL 的 `search` 与 `href` 槽，其余组件不受影响。
 *
 * 条目读取复用 web.ts 已导出的 `urlSearchParamsEntriesOf`（单一真值源）。
 */
import type { Abs } from "../../abs.ts";
import { strLit, litValue } from "../../abs.ts";
import { getSlot, setSlot } from "../../objects.ts";
import { urlSearchParamsEntriesOf } from "../../builtins/error/web.ts";

/** URLSearchParams brand → 拥有它的 URL brand（仅经 `u.searchParams` 读取时登记）。 */
const urlParents = new WeakMap<Abs, Abs>();

/** 会原地改 `@@entries` 的方法（读方法 / size / 迭代器不触发回写）。 */
const URL_SP_MUTATORS = new Set(["set", "append", "delete", "sort"]);

export function isUrlSpMutator(method: string): boolean {
  return URL_SP_MUTATORS.has(method);
}

export function registerUrlSearchParamsParent(sp: Abs | undefined, url: Abs): void {
  if (sp && sp.shape.k === "brand" && sp.shape.name === "URLSearchParams") {
    urlParents.set(sp, url);
  }
}

/** 变更后按新条目重算父 URL 的 search / href（引用共享 ⇒ 调用点可见）。 */
export function syncUrlSearchParamsParent(sp: Abs): void {
  const url = urlParents.get(sp);
  if (!url || url.shape.k !== "brand" || url.shape.name !== "URL") return;
  const entries = urlSearchParamsEntriesOf(sp);
  if (entries === undefined) return;
  const inner = url.shape.shape;
  if (inner.shape.k !== "obj") return;
  const slots = (inner.shape as { slots: Record<string, { value: Abs }> }).slots;
  const hrefSlot = getSlot(slots, "href");
  const hashSlot = getSlot(slots, "hash");
  const oldHref = hrefSlot ? litValue(hrefSlot.value) : undefined;
  const hash = hashSlot ? litValue(hashSlot.value) : undefined;
  const hashStr = hash?.ok && typeof hash.value === "string" ? hash.value : "";
  const query = entries.map(([n, v]) => `${n}=${v}`).join("&");
  const search = query ? `?${query}` : "";
  setSlot(slots, "search", { value: strLit(search) });
  if (oldHref?.ok && typeof oldHref.value === "string") {
    const h = oldHref.value;
    const qIdx = h.indexOf("?");
    // 取 href 里 search 段之前的基准（含 origin/pathname/port/userinfo），
    // 再拼新 search 与 hash；不重造 URL 解析。
    const base =
      qIdx >= 0
        ? h.slice(0, qIdx)
        : hashStr
          ? h.slice(0, h.length - hashStr.length)
          : h;
    setSlot(slots, "href", { value: strLit(base + search + hashStr) });
  }
}
