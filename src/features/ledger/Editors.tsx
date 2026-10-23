import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { ExchangeForm } from './ExchangeForm';
import { ExpenseForm } from './ExpenseForm';

// Opens the expense and exchange sheets from anywhere (home quick-add, ledger, stats).

interface Editors {
  openExpense: (id?: string) => void;
  /** A new expense prefilled from an earlier one (U-01). */
  copyExpense: (fromId: string) => void;
  openExchange: (id?: string) => void;
}

const Ctx = createContext<Editors>({ openExpense: () => {}, copyExpense: () => {}, openExchange: () => {} });

export function EditorsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ kind: 'expense' | 'exchange'; id?: string; copyFrom?: string } | null>(null);
  const close = useCallback(() => setState(null), []);
  const value = useMemo<Editors>(
    () => ({
      openExpense: id => setState({ kind: 'expense', id }),
      copyExpense: copyFrom => setState({ kind: 'expense', copyFrom }),
      openExchange: id => setState({ kind: 'exchange', id })
    }),
    []
  );
  return (
    <Ctx.Provider value={value}>
      {children}
      <ExpenseForm
        open={state?.kind === 'expense'} editId={state?.kind === 'expense' ? state.id : undefined} copyFromId={state?.copyFrom}
        onCopy={id => setState({ kind: 'expense', copyFrom: id })} onClose={close}
      />
      <ExchangeForm open={state?.kind === 'exchange'} editId={state?.kind === 'exchange' ? state.id : undefined} onClose={close} />
    </Ctx.Provider>
  );
}

export const useEditors = () => useContext(Ctx);
