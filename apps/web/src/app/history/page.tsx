import type { Metadata } from 'next';
import { HistoryPage } from '@/components/HistoryPage';

export const metadata: Metadata = { title: 'History — Montagio' };

export default function History() {
  return <HistoryPage />;
}
