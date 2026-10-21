import type { Metadata } from 'next';
import { CharactersPage } from '@/components/CharactersPage';

export const metadata: Metadata = { title: 'Characters — Montagio' };

export default function Characters() {
  return <CharactersPage />;
}
