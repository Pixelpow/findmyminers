import { useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { useT } from '@/lib/i18n';
export default function ProfitabilityPage() {
  const router = useRouter();
  const t = useT();

  useEffect(() => {
    void router.replace('/dashboard');
  }, [router]);

  return (
    <>
      <Head><title>{t('Redirection', 'Redirecting')} · FindMyMiners</title></Head>
      <div style={{ padding: '48px 32px', color: 'var(--muted)' }}>
        {t('Redirection vers le tableau de bord…', 'Redirecting to the dashboard…')}
      </div>
    </>
  );
}
