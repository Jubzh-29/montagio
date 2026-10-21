import type { Metadata } from 'next';
import { ExplorePage } from '@/components/ExplorePage';

export const metadata: Metadata = { title: 'Explore — Montagio' };

export default function Explore() {
  return <ExplorePage />;
}
