import type { Metadata } from 'next';
import { CaptureProvider } from '@/lib/hush/CaptureProvider';

export const metadata: Metadata = {
  title: 'Hush demo storefront',
  description: 'The toy app Hush watches.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          background: '#fafaf7',
          color: '#0f1419',
        }}
      >
        <CaptureProvider />
        {children}
      </body>
    </html>
  );
}
