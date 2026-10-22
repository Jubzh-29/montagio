import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { I18nProvider } from '@/i18n';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Montagio — viral video effects from one photo, on open weights',
  description:
    'One photo becomes a few seconds of viral effect, a camera move or a short film. 100% open weights, every preset opens in ComfyUI.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
