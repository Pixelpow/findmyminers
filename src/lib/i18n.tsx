/**
 * i18n minimaliste, sans dépendance.
 *
 * - `useT()` renvoie `t(fr, en)` qui choisit la langue active.
 * - Anglais par défaut (cible Reddit / international) ; bouton FR/EN pour basculer.
 * - La préférence est mémorisée dans le navigateur (localStorage).
 *
 * Usage :  const t = useT();  <h1>{t('Tableau de bord', 'Dashboard')}</h1>
 */
import { createContext, useCallback, useContext, useEffect, useState } from 'react';

export type Lang = 'en' | 'fr';

type LangCtx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (fr: string, en: string) => string;
};

const Ctx = createContext<LangCtx>({
  lang: 'en',
  setLang: () => {},
  t: (_fr, en) => en,
});

export function LangProvider({ children }: { children: React.ReactNode }) {
  // Anglais par défaut côté serveur ET premier rendu client (pas de mismatch).
  const [lang, setLangState] = useState<Lang>('en');

  useEffect(() => {
    // Rendu serveur + premier rendu client = 'en' (pas de mismatch d'hydratation) ;
    // on lit la préférence sauvegardée seulement après le montage.
    try {
      const saved = localStorage.getItem('fmm_lang');
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved === 'fr' || saved === 'en') setLangState(saved);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { localStorage.setItem('fmm_lang', l); } catch { /* ignore */ }
  }, []);

  const t = useCallback((fr: string, en: string) => (lang === 'fr' ? fr : en), [lang]);

  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>;
}

export const useLang = () => useContext(Ctx);
export const useT = () => useContext(Ctx).t;
