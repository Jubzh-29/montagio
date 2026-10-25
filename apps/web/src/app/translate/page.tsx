import type { Metadata } from 'next';
import { VoicePage } from '@/components/VoicePage';

export const metadata: Metadata = { title: 'Translate — Montagio' };

export default function Translate() {
  return <VoicePage mode="translate" />;
}
