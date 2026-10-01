/**
 * Playground 预设的 i18n 文案（唯一依赖 @docusaurus/Translate 的地方）。
 * `presets.ts` 保持纯数据：测试、脚本与任何非浏览器宿主都能直接导入它。
 */
import { translate } from '@docusaurus/Translate';
import type { Preset } from './types';
import {
  GROUP_CONTRACTS,
  GROUP_BASIC,
  GROUP_CALLSITE,
  GROUP_SEMANTICS,
} from './presets';

// 预设分组名 → 翻译 id（optgroup label 用）
const GROUP_LABEL_IDS: Record<string, string> = {
  [GROUP_CONTRACTS]: 'playground.group.contracts',
  [GROUP_BASIC]: 'playground.group.basic',
  [GROUP_CALLSITE]: 'playground.group.callsite',
  [GROUP_SEMANTICS]: 'playground.group.semantics',
};

export function tGroup(group: string): string {
  const id = GROUP_LABEL_IDS[group];
  return id ? translate({ id, message: group }) : group;
}

// 预设名 → 翻译 id（下拉 option 文案用；英文名即回退默认值）
export function tPresetName(preset: Preset): string {
  return translate({ id: `playground.preset.${preset.id}.name`, message: preset.name });
}
