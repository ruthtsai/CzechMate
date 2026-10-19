import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { ExchangeForm } from './ExchangeForm';
import { ExpenseForm } from './ExpenseForm';

// Opens the expense and exchange sheets from anywhere (home quick-add, ledger, stats).

interface Editors {
  openExpense: (id?: string) => void;
  openExchange: (id?: string) => void;
}

const Ctx = createContext<Editors>({ openExpense: () => {}, openExchange: () => {} });

export function EditorsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ kind: 'expense' | 'exchange'; id?: string } | null>(null);
  const close = useCallback(() => setState(null), []);
  const value = useMemo<Editors>(
    () => ({
      openExpense: id => setState({ kind: 'expense', id }),
      openExchange: id => setState({ kind: 'exchange', id })
    }),
    []
  );
  return (
    <Ctx.Provider value={value}>
      {children}
      <ExpenseForm open={state?.kind === 'expense'} editId={state?.kind === 'expense' ? state.id : undefined} onClose={close} />
      <ExchangeForm open={state?.kind === 'exchange'} editId={state?.kind === 'exchange' ? state.id : undefined} onClose={close} />
    </Ctx.Provider>
  );
}

export const useEditors = () => useContext(Ctx);
