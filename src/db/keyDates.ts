import { getSetting, setSetting } from './index';
import { validateKeyDate, type KeyDate } from '../domain/keyDates';

// Key dates live in settings, so backups and restores carry them without a schema change.

export const getKeyDates = () => getSetting<KeyDate[]>('keyDates', []);

export async function saveKeyDate(input: { title: string; date: string; note?: string }, id?: string): Promise<void> {
  const error = validateKeyDate(input);
  if (error) throw new Error(error);
  const list = await getKeyDates();
  const item: KeyDate = { id: id ?? crypto.randomUUID(), title: input.title.trim(), date: input.date, note: input.note?.trim() || undefined };
  await setSetting('keyDates', id ? list.map(d => (d.id === id ? item : d)) : [...list, item]);
}

export async function deleteKeyDate(id: string): Promise<void> {
  await setSetting('keyDates', (await getKeyDates()).filter(d => d.id !== id));
}
