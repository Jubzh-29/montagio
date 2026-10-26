import type { Metadata } from 'next';
import { ExamplesPage } from '@/components/ExamplesPage';

export const metadata: Metadata = { title: 'Examples — Montagio' };

export default function Examples() {
  return <ExamplesPage />;
}
