import type { ReactNode } from 'react';
import { ThemeProvider, themeScript } from '@opsninja/ui-kit';
import './globals.css';

export const metadata = {
  title: 'OpsNinja — Agent Workspace',
  description: 'Support agent workspace for OpsNinja',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Sets data-theme before first paint — prevents flash of incorrect theme */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="bg-surface text-primary font-sans antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
