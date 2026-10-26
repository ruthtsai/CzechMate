import { useLiveQuery } from 'dexie-react-hooks';
import { sheetsLink } from '../../db/sheetsLink';

/** The Google Sheets link as the screens show it, kept up to date; undefined until first read. */
export const useSheetsLinkStatus = () => useLiveQuery(sheetsLink.status, []);

/** Whether the ledger has changes the sheet doesn't have yet. Reads the whole ledger, so only the sync screen uses it. */
export const useLedgerUnsent = () => useLiveQuery(sheetsLink.ledgerNeedsSending, [], false);
