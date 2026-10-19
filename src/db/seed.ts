import type { Category, CzechMateDB, HandbookSource, PaymentMethod } from './schema';
import type { Mode } from '../domain/constants';

// Default records created the first time the database opens (requirements spec 4.5).
// Fixed IDs keep tests and backups stable.

export const DEFAULT_PAYMENT_METHODS: PaymentMethod[] = [
  { id: 'pay-cash', name: '現金', kind: 'cash', order: 0, active: true },
  { id: 'pay-cube', name: '國泰世華 Cube', kind: 'credit', order: 1, active: true },
  { id: 'pay-ctbc-debit', name: '中國信託簽帳卡', kind: 'debit', order: 2, active: true },
  { id: 'pay-ctbc-uniopen', name: '中國信託 uniopen', kind: 'credit', order: 3, active: true },
  { id: 'pay-mega', name: '兆豐 Mega', kind: 'credit', order: 4, active: true }
];

// Same name → same chart colour across modes (UI spec 6.2). Values index --cat1..--cat10.
export const CATEGORY_COLOR: Record<string, number> = {
  '房租／住宿': 1, 住宿: 1, '學費／押金': 1,
  超市: 2, '體檢／疫苗': 2,
  餐飲: 3,
  日用品: 4, 行李用品: 4,
  電信: 5, 保險: 5,
  交通: 6, 機票: 6,
  學校: 7, '簽證／居留': 7,
  娛樂: 8, '門票／景點': 8, 文件規費: 8,
  紀念品: 9,
  其他: 10
};

const DEFAULT_CATEGORY_NAMES: Record<Mode, [slug: string, name: string][]> = {
  prep: [
    ['flight', '機票'], ['visa', '簽證／居留'], ['insurance', '保險'], ['tuition', '學費／押金'],
    ['health', '體檢／疫苗'], ['docs', '文件規費'], ['luggage', '行李用品'], ['other', '其他']
  ],
  daily: [
    ['food', '餐飲'], ['grocery', '超市'], ['transport', '交通'], ['rent', '房租／住宿'], ['telecom', '電信'],
    ['school', '學校'], ['household', '日用品'], ['fun', '娛樂'], ['other', '其他']
  ],
  travel: [
    ['transport', '交通'], ['lodging', '住宿'], ['food', '餐飲'], ['tickets', '門票／景點'],
    ['souvenir', '紀念品'], ['other', '其他']
  ]
};

export const DEFAULT_CATEGORIES: Category[] = (Object.keys(DEFAULT_CATEGORY_NAMES) as Mode[]).flatMap(mode =>
  DEFAULT_CATEGORY_NAMES[mode].map(([slug, name], order) => ({
    id: `cat-${mode}-${slug}`,
    mode,
    name,
    color: CATEGORY_COLOR[name] ?? 10,
    order,
    active: true
  }))
);

export const DEFAULT_HANDBOOK_SOURCES: HandbookSource[] = [
  {
    id: 'hb-tchajwan',
    title: '捷克交換學生生存手冊',
    url: 'https://hackmd.io/@tchajwan/tchaj-wan-student-survival-guide',
    kind: 'book'
  }
];

export async function seedDefaults(db: CzechMateDB): Promise<void> {
  await db.paymentMethods.bulkAdd(DEFAULT_PAYMENT_METHODS);
  await db.categories.bulkAdd(DEFAULT_CATEGORIES);
  await db.handbookSources.bulkAdd(DEFAULT_HANDBOOK_SOURCES);
  await db.settings.bulkAdd([{ key: 'theme', value: 'system' }]);
}
