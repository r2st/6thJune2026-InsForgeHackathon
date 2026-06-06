import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Hush — live receipt',
  description: 'The screen that lights up when Hush catches a silent backend bug.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
