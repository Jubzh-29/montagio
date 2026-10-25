import type { Metadata } from 'next';
import { RemixPage } from '@/components/RemixPage';

export const metadata: Metadata = { title: 'Trend remix — Montagio' };

export default function Remix() {
  return <RemixPage />;
}
