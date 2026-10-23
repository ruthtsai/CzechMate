import Dexie, { type EntityTable } from 'dexie';
import type { Currency, Mode, PaymentKind, ResourceType, Stage } from '../domain/constants';

// Record shapes follow CzechMate_Requirements_Spec.md section 4.
// Derived values (TWD amount, rate, TWD source) are never stored; domain/money.ts computes them.

export interface Resource {
  id: string;
  title: string;
  type: ResourceType;
  stage: Stage;
  content: string;
  tags: string[];
  url: string;
  imageIds: string[];
  pinned: boolean;
  pinOrder?: number;
  pinLabel?: string;
  /**
   * Where the record lives (requirements spec 6.7): 'sheet' rows come from the Google Sheet and are read-only here;
   * 'pending' were added in the app and wait in the outbox; 'app' predate the sheet (or no sheet is linked).
   */
  source?: 'app' | 'sheet' | 'pending';
  /** Row number in the 資源 sheet, for opening the sheet at that row. */
  sheetRow?: number;
  /** Image file names as written in the sheet (source of imageIds for sheet rows). */
  imageNames?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface StoredImage {
  id: string;
  blob: Blob;
  width: number;
  height: number;
  createdAt: string;
  /** Drive file id and modified time, for images that came from the Drive folder. */
  driveId?: string;
  driveModified?: string;
  name?: string;
}

/** Downloaded HackMD note behind a resource URL (requirements MD-02). */
export interface NoteCache {
  url: string;
  markdown: string;
  fetchedAt: string;
}

/** Writes to the Google Sheet that wait for a connection (requirements RS-03). */
export interface OutboxItem {
  id: string;
  kind: 'appendResource';
  resourceId: string;
  createdAt: string;
  attempts: number;
  lastError?: string;
}

export interface HandbookSource {
  id: string;
  title: string;
  url: string;
  kind: 'book' | 'note';
  lastSyncedAt?: string;
  pageCount?: number;
  failedPages?: string[];
}

export interface HandbookSection {
  id: string;
  sourceId: string;
  pageTitle: string;
  pageUrl: string;
  heading: string;
  anchor: string;
  text: string;
  order: number;
}

export interface PaymentMethod {
  id: string;
  name: string;
  kind: PaymentKind;
  order: number;
  active: boolean;
}

export interface Category {
  id: string;
  mode: Mode;
  name: string;
  color: number;
  order: number;
  active: boolean;
}

export interface Trip {
  id: string;
  name: string;
  startDate: string;
  endDate?: string;
  /** Optional budget in TWD (U-03). */
  budgetTwd?: number;
  createdAt: string;
}

export interface Expense {
  id: string;
  date: string;
  mode: Mode;
  categoryId: string;
  amount: number;
  currency: Currency;
  paymentId: string;
  tripId?: string;
  itemName: string;
  place: string;
  note: string;
  billTwd?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Exchange {
  id: string;
  date: string;
  method: 'cash' | 'atm';
  cardId?: string;
  outAmount: number;
  outCurrency: Currency;
  inAmount: number;
  inCurrency: Currency;
  estimated?: boolean;
  place: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface Setting {
  key: string;
  value: unknown;
}

export const DB_NAME = 'czechmate';

export class CzechMateDB extends Dexie {
  resources!: EntityTable<Resource, 'id'>;
  images!: EntityTable<StoredImage, 'id'>;
  handbookSources!: EntityTable<HandbookSource, 'id'>;
  handbookSections!: EntityTable<HandbookSection, 'id'>;
  paymentMethods!: EntityTable<PaymentMethod, 'id'>;
  categories!: EntityTable<Category, 'id'>;
  trips!: EntityTable<Trip, 'id'>;
  expenses!: EntityTable<Expense, 'id'>;
  exchanges!: EntityTable<Exchange, 'id'>;
  settings!: EntityTable<Setting, 'key'>;
  noteCache!: EntityTable<NoteCache, 'url'>;
  outbox!: EntityTable<OutboxItem, 'id'>;

  constructor(name = DB_NAME) {
    super(name);
    this.version(1).stores({
      // Booleans are not valid IndexedDB keys, so `pinned` is filtered in memory.
      resources: 'id, updatedAt, stage, type, *tags',
      images: 'id',
      handbookSources: 'id',
      handbookSections: 'id, sourceId',
      paymentMethods: 'id, order',
      categories: 'id, mode, order',
      trips: 'id, startDate',
      expenses: 'id, date, mode, categoryId, paymentId, tripId',
      exchanges: 'id, date',
      settings: 'key'
    });
    this.version(2)
      .stores({ noteCache: 'url', outbox: 'id, createdAt' })
      .upgrade(tx =>
        tx.table('resources').toCollection().modify((r: Resource) => {
          r.source ??= 'app';
        })
      );
  }
}
