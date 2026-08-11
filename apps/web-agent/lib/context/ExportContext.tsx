'use client';

/**
 * ExportContext — dispatch slot so each page registers its export handlers.
 *
 * The shell's ExportMenu reads the registered handlers and calls them on demand.
 * Pages that don't register handlers produce a disabled ExportMenu.
 */

import React, { createContext, useCallback, useContext, useRef } from 'react';

export type ExportFormat = 'pdf' | 'csv';

export type ExportHandler = (format: ExportFormat) => Promise<void> | void;

interface ExportContextValue {
  /** Register an export handler for the current page. Returns a cleanup function. */
  registerExportHandler: (handler: ExportHandler) => () => void;
  /** Current registered handler, or null if no page has registered one. */
  handler: ExportHandler | null;
}

const ExportContext = createContext<ExportContextValue>({
  registerExportHandler: () => () => undefined,
  handler: null,
});

export function ExportProvider({ children }: { children: React.ReactNode }) {
  const handlerRef = useRef<ExportHandler | null>(null);
  const [, forceRender] = React.useReducer((x: number) => x + 1, 0);

  const registerExportHandler = useCallback((handler: ExportHandler) => {
    handlerRef.current = handler;
    forceRender();
    return () => {
      if (handlerRef.current === handler) {
        handlerRef.current = null;
        forceRender();
      }
    };
  }, []);

  return (
    <ExportContext.Provider
      value={{ registerExportHandler, handler: handlerRef.current }}
    >
      {children}
    </ExportContext.Provider>
  );
}

export function useExportContext(): ExportContextValue {
  return useContext(ExportContext);
}

/** Hook for pages to register their export handler. */
export function useRegisterExportHandler(handler: ExportHandler | null): void {
  const { registerExportHandler } = useExportContext();
  React.useEffect(() => {
    if (!handler) return;
    return registerExportHandler(handler);
  }, [handler, registerExportHandler]);
}
