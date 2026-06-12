import { useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
export default function ProfitabilityPage() {
  const router = useRouter();

  useEffect(() => {
    void router.replace('/dashboard');
  }, [router]);

  return (
    <>
      <Head><title>Redirecting | FindMyMiners</title></Head>
      <div style={{ padding: '48px 32px', color: 'var(--muted)' }}>
        Redirecting to the dashboard...
      </div>
    </>
  );
}
