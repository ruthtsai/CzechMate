import { describe, expect, it } from 'vitest';
import { SYNC_LOG_MAX, withLogEntry, type SyncLogEntry } from './sheetsSync';

describe('sync log', () => {
  it('keeps the newest entries first and drops the oldest past the cap', () => {
    let log: SyncLogEntry[] = [];
    for (let i = 0; i < SYNC_LOG_MAX + 5; i++) log = withLogEntry(log, { at: `t${i}`, job: '記帳', ok: true, message: String(i) });
    expect(log).toHaveLength(SYNC_LOG_MAX);
    expect(log[0].message).toBe(String(SYNC_LOG_MAX + 4));
    expect(log.at(-1)!.message).toBe('5');
  });
});
