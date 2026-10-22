import type { Metadata } from 'next';
import { AdsPage } from '@/components/AdsPage';

export const metadata: Metadata = { title: 'Ads — Montagio' };

export default function Ads() {
  return <AdsPage />;
}
