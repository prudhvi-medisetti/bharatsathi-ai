import { Globe2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { interfaceLanguages, getInterfaceLanguage } from '../data/languages';
import i18n from '../i18n';

export default function LanguageSwitcher({ className }: { className: string }) {
  const { t } = useTranslation();
  const [error, setError] = useState('');
  const language = getInterfaceLanguage(i18n.resolvedLanguage) ?? 'en';

  const changeLanguage = async (nextLanguage: string) => {
    setError('');
    try {
      await i18n.changeLanguage(nextLanguage);
      localStorage.setItem('bharatsathi-language', nextLanguage);
    } catch (changeError) {
      console.error('Unable to apply or save the selected language:', changeError);
      setError(t('Could not save your preference. Please try again.'));
    }
  };

  return (
    <span>
      <label className={className}>
        <Globe2 size={15} />
        <span className="sr-only">{t('Language')}</span>
        <select value={language} onChange={(event) => void changeLanguage(event.target.value)} aria-label={t('Language')}>
          {interfaceLanguages.map((option) => <option key={option.code} value={option.code}>{option.nativeName}</option>)}
        </select>
      </label>
      {error && <span className="language-switcher-error" role="alert">{error}</span>}
    </span>
  );
}
