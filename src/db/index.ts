import { CzechMateDB, DB_NAME } from './schema';
import { seedDefaults } from './seed';

export * from './schema';

export function createDB(name = DB_NAME): CzechMateDB {
  const db = new CzechMateDB(name);
  // `populate` runs once, inside the transaction that creates the database.
  db.on('populate', tx => seedDefaults(tx.db as CzechMateDB));
  return db;
}

export const db = createDB();

export async function getSetting<T>(key: string, fallback: T, database: CzechMateDB = db): Promise<T> {
  const row = await database.settings.get(key);
  return row === undefined ? fallback : (row.value as T);
}

export async function setSetting(key: string, value: unknown, database: CzechMateDB = db): Promise<void> {
  await database.settings.put({ key, value });
}
