import type { Abs } from '@nudojs/core';

export interface CaseInfo {
  name: string;
  args: Abs[];
}

export interface SinglePreset {
  mode: 'single';
  id: string;
  name: string;
  group: string;
  code: string;
}

export interface CallsitePreset {
  mode: 'callsite';
  id: string;
  name: string;
  group: string;
  libFile: string;
  libCode: string;
  testFile: string;
  testCode: string;
  exportName: string;
  paramCount: number;
}

export interface SidecarPreset {
  mode: 'sidecar';
  id: string;
  name: string;
  group: string;
  /** 主源码文件名（展示用；分析时固定挂在 /playground.js） */
  mainFile: string;
  mainCode: string;
  /** 侧车契约文件名（同时是虚拟模块解析键） */
  sidecarFile: string;
  sidecarCode: string;
}

export type Preset = SinglePreset | CallsitePreset | SidecarPreset;

export interface DiscoveredCall {
  fnName: string;
  line: number | undefined;
  internal: boolean;
  args: Abs[];
  result: Abs;
}

export interface CallsiteResult {
  records: DiscoveredCall[];
  beforeArgs: Abs[];
  before: Abs | null;
  afterArgs: Abs[] | null;
  after: Abs | null;
  afterSource: string;
  error: string | null;
}
