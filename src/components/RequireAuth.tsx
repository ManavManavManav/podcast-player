// components/RequireAuth.tsx
'use client';

import { useEffect } from 'react';
import { useUserStore } from '@/lib/store/useUserStore';
import { useRouter } from 'next/navigation';

export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const { username } = useUserStore();
  const router = useRouter();

  useEffect(() => {
    if (!username) {
      router.replace('/login');
    }
  }, [username, router]);

  if (!username) return null;
  return <>{children}</>;
}
