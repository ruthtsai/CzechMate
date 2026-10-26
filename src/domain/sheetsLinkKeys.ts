// The settings behind the Google Sheets link (see GLOSSARY.md). Every gs* setting is either link state or a sync preference.

/** The sheet's script address and this phone's key for it: link state that a backup may carry when the user asks. */
export const LINK_CREDENTIAL_KEYS = ['gsUrl', 'gsSecret'] as const;

/** What this phone remembers about its current link: cleared on unlinking; backups carry at most the credentials. */
export const LINK_STATE_KEYS = [
  ...LINK_CREDENTIAL_KEYS,
  'gsSheetUrl', 'gsSheetName', 'gsResourcesGid', 'gsScriptImageFolder', 'gsScriptFeatures',
  'gsLastSyncAt', 'gsLastPullAt', 'gsLastError', 'gsPullErrors', 'gsSyncLog',
  'gsLedgerOwner', 'gsRestoreOffer', 'gsPushedFingerprint',
  'gsDirty' // no longer written; listed so unlinking clears it from older versions
] as const;

/** Choices the user makes about syncing: kept on unlinking, carried by backups. */
export const SYNC_PREFERENCE_KEYS = ['gsAutoSync', 'gsImageFolder'] as const;

const credentials = new Set<string>(LINK_CREDENTIAL_KEYS);
const linkState = new Set<string>(LINK_STATE_KEYS);

export const isLinkCredential = (key: string) => credentials.has(key);
/** Link state other than the credentials: what a backup never carries. */
export const isLinkRecord = (key: string) => linkState.has(key) && !credentials.has(key);
