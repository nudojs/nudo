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

export type Preset = SinglePreset | CallsitePreset;

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
