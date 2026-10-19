// Fixed vocabularies shared by the database, the domain logic and the UI.
// See CzechMate_Requirements_Spec.md section 4.

export const CURRENCIES = ['TWD', 'CZK', 'EUR', 'HUF', 'PLN', 'GBP'] as const;
export type Currency = (typeof CURRENCIES)[number];

export const MODES = ['prep', 'daily', 'travel'] as const;
export type Mode = (typeof MODES)[number];
export const MODE_LABEL: Record<Mode, string> = { prep: '出發前準備', daily: '日常生活', travel: '旅遊' };
export const MODE_SHORT: Record<Mode, string> = { prep: '出發前', daily: '日常', travel: '旅遊' };

export const RESOURCE_TYPES = ['note', 'dcard', 'web', 'screenshot', 'doc'] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];
export const RESOURCE_TYPE_LABEL: Record<ResourceType, string> = {
  note: '筆記',
  dcard: 'Dcard',
  web: '網站',
  screenshot: '截圖',
  doc: '文件'
};

export const STAGES = ['before', 'after', 'travel', 'any'] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABEL: Record<Stage, string> = { before: '出發前', after: '抵達後', travel: '旅遊', any: '不分' };

export const PAYMENT_KINDS = ['cash', 'credit', 'debit'] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];
export const PAYMENT_KIND_LABEL: Record<PaymentKind, string> = { cash: '現金', credit: '信用卡', debit: '簽帳卡' };

export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];
