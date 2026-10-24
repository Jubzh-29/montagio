import type { Metadata } from 'next';
import { CommunityPage } from '@/components/CommunityPage';

export const metadata: Metadata = { title: 'Community — Montagio' };

export default function Community() {
  return <CommunityPage />;
}
