import type { Metadata } from 'next';
import { OpenStack } from '@/components/OpenStack';

export const metadata: Metadata = { title: 'Open stack — Montagio' };

export default function OpenStackPage() {
  return <OpenStack />;
}
