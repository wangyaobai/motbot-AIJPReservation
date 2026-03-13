import { createContext, useContext, useEffect, useState } from 'react';

const UiLangContext = createContext({ uiLang: 'zh', toggleUiLang: () => {} });

export function UiLangProvider({ children }) {
  const [uiLang, setUiLang] = useState(() => {
    if (typeof window === 'undefined') return 'zh';
    const saved = window.localStorage.getItem('uiLang');
    return saved === 'en' ? 'en' : 'zh';
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('uiLang', uiLang);
    }
  }, [uiLang]);

  const toggleUiLang = () => {
    setUiLang((prev) => (prev === 'en' ? 'zh' : 'en'));
  };

  return (
    <UiLangContext.Provider value={{ uiLang, toggleUiLang }}>
      {children}
    </UiLangContext.Provider>
  );
}

export function useUiLang() {
  return useContext(UiLangContext);
}

