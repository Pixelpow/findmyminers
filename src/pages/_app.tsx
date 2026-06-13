import "@/styles/globals.css";
import type { AppProps } from "next/app";
import { useEffect, useCallback } from "react";
import { useRouter } from "next/router";
import { Inter, JetBrains_Mono } from "next/font/google";
import Layout from "@/components/Layout";
import ToastProvider from "@/components/ToastProvider";
import ErrorBoundary from "@/components/ErrorBoundary";

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-inter',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-jb-mono',
});

// Pages that use the new Layout sidebar
const LAYOUT_PAGES = ['/miners', '/pools', '/dashboard', '/advisor', '/settings', '/alerts', '/discover', '/records', '/overclock'];

// Keyboard shortcut page map (1-based)
const SHORTCUT_PAGES = ['/dashboard', '/miners', '/alerts', '/advisor', '/settings', '/pools', '/records', '/discover'];

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter();
  const useLayout = LAYOUT_PAGES.some((p) => router.pathname === p || router.pathname.startsWith(p + '/'));

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Keep registration failure silent in dev/self-hosted environments.
    });
  }, []);

  // Global keyboard shortcuts
  const handleKeyboard = useCallback((event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable;

    // Ctrl+K → focus search (if any search input on the page)
    if ((event.ctrlKey || event.metaKey) && event.key === 'k') {
      event.preventDefault();
      const searchInput = document.querySelector<HTMLInputElement>('input[placeholder*="Search"], input[placeholder*="search"], input[placeholder*="Recherch"], input[placeholder*="recherch"]');
      if (searchInput) searchInput.focus();
      return;
    }

    // Esc → close modals (blur active element / click overlay)
    if (event.key === 'Escape') {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      const overlay = document.querySelector<HTMLElement>('[data-modal-overlay]');
      if (overlay) overlay.click();
      return;
    }

    // Only process shortcuts when not in an input
    if (isInput) return;

    // R → refresh page data (dispatch custom event that pages can listen to)
    if (event.key === 'r' || event.key === 'R') {
      window.dispatchEvent(new CustomEvent('app:refresh'));
      return;
    }

    // Number keys 1-8 → navigate to page
    const num = parseInt(event.key, 10);
    if (num >= 1 && num <= SHORTCUT_PAGES.length) {
      router.push(SHORTCUT_PAGES[num - 1]);
    }
  }, [router]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyboard);
    return () => window.removeEventListener('keydown', handleKeyboard);
  }, [handleKeyboard]);

  // Page transition key to trigger CSS animation on route change
  const pageKey = router.asPath;

  const fontClasses = `${inter.variable} ${jetbrainsMono.variable}`;

  if (useLayout) {
    return (
      <div className={fontClasses}>
        <ToastProvider>
          <Layout>
            <ErrorBoundary>
              <div key={pageKey} className="page-transition-enter">
                <Component {...pageProps} />
              </div>
            </ErrorBoundary>
          </Layout>
        </ToastProvider>
      </div>
    );
  }

  return (
    <div className={fontClasses}>
      <ToastProvider>
        <ErrorBoundary>
          <Component {...pageProps} />
        </ErrorBoundary>
      </ToastProvider>
    </div>
  );
}
