import type { Metadata } from 'next';
import { VoicePage } from '@/components/VoicePage';

export const metadata: Metadata = { title: 'Voice change — Montagio' };

export default function Voice() {
  return <VoicePage />;
}
