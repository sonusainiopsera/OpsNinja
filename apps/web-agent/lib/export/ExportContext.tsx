/**
 * ExportContext — React context for page-registered export handlers.
 *
 * Pages declare what they can export by calling useRegisterExportHandler().
 * The ExportMenu in the TopBar dispatches to the registered handler.
 * If no handler is registered, the ExportMenu renders as disabled.
 */

'use client';

import React, { createContext, useCallback, useContext, useRef, useState } from 'react';

export type ExportFormat = 'pdf' | 'csv';

export interface ExportHandler {
  (format: ExportFormat): Promise<void>;
}

interface ExportContextValue {
  handler: ExportHandler | null;
  register: (handler: ExportHandler) => () => void;
  dispatch: (format: ExportFormat) => Promise<void>;
  isDispatching: boolean;
  lastError: string | null;
}

const ExportContext = createContext<ExportContextValue>({
  handler: null,
  register: () => () => undefined,
  dispatch: async () => undefined,
  isDispatching: false,
  lastError: null,
});

export function ExportProvider({ children }: { children: React.ReactNode }) {
  const [handler, setHandler] = useState<ExportHandler | null>(null);
  const [isDispatching, setIsDispatching] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const handlerRef = useRef<ExportHandler | null>(null);

  const register = useCallback((h: ExportHandler) => {
    handlerRef.current = h;
    setHandler(() => h);
    return () => {
      if (handlerRef.current === h) {
        handlerRef.current = null;
        setHandler(null);
      }
    };
  }, []);

  const dispatch = useCallback(async (format: ExportFormat) => {
    const h = handlerRef.current;
    if (!h) return;
    setIsDispatching(true);
    setLastError(null);
    try {
      await h(format);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Export failed';
      setLastError(msg);
    } finally {
      setIsDispatching(false);
    }
  }, []);

  return (
    <ExportContext.Provider value={{ handler, register, dispatch, isDispatching, lastError }}>
      {children}
    </ExportContext.Provider>
  );
}

export function useExportContext() {
  return useContext(ExportContext);
}

/** Pages call this to register an export handler for the current route. */
export function useRegisterExportHandler(handler: ExportHandler) {
  const { register } = useExportContext();
  React.useEffect(() => register(handler), [register, handler]);
}
