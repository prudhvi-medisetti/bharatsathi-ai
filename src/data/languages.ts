export type AppLanguage = {
  code: string;
  name: string;
  nativeName: string;
  locale: string;
};

export const appLanguages: AppLanguage[] = [
  { code: 'en', name: 'English', nativeName: 'English', locale: 'en-IN' },
  { code: 'as', name: 'Assamese', nativeName: 'অসমীয়া', locale: 'as-IN' },
  { code: 'bn', name: 'Bengali', nativeName: 'বাংলা', locale: 'bn-IN' },
  { code: 'brx', name: 'Bodo', nativeName: 'बड़ो', locale: 'brx-IN' },
  { code: 'doi', name: 'Dogri', nativeName: 'डोगरी', locale: 'doi-IN' },
  { code: 'gu', name: 'Gujarati', nativeName: 'ગુજરાતી', locale: 'gu-IN' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', locale: 'hi-IN' },
  { code: 'kn', name: 'Kannada', nativeName: 'ಕನ್ನಡ', locale: 'kn-IN' },
  { code: 'ks', name: 'Kashmiri', nativeName: 'कश्मीरी', locale: 'ks-IN' },
  { code: 'kok', name: 'Konkani', nativeName: 'कोंकणी', locale: 'kok-IN' },
  { code: 'mai', name: 'Maithili', nativeName: 'मैथिली', locale: 'mai-IN' },
  { code: 'ml', name: 'Malayalam', nativeName: 'മലയാളം', locale: 'ml-IN' },
  { code: 'mni', name: 'Manipuri', nativeName: 'মৈতৈলোন্', locale: 'mni-IN' },
  { code: 'mr', name: 'Marathi', nativeName: 'मराठी', locale: 'mr-IN' },
  { code: 'ne', name: 'Nepali', nativeName: 'नेपाली', locale: 'ne-IN' },
  { code: 'or', name: 'Odia', nativeName: 'ଓଡ଼ିଆ', locale: 'or-IN' },
  { code: 'pa', name: 'Punjabi', nativeName: 'ਪੰਜਾਬੀ', locale: 'pa-IN' },
  { code: 'sa', name: 'Sanskrit', nativeName: 'संस्कृतम्', locale: 'sa-IN' },
  { code: 'sat', name: 'Santali', nativeName: 'ᱥᱟᱱᱛᱟᱲᱤ', locale: 'sat-IN' },
  { code: 'sd', name: 'Sindhi', nativeName: 'سنڌي', locale: 'sd-IN' },
  { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்', locale: 'ta-IN' },
  { code: 'te', name: 'Telugu', nativeName: 'తెలుగు', locale: 'te-IN' },
  { code: 'ur', name: 'Urdu', nativeName: 'اردو', locale: 'ur-IN' },
];

const interfaceLanguageCodes = new Set(['en', 'gu', 'hi', 'ml', 'mr', 'pa', 'ta', 'te']);

export const interfaceLanguages = appLanguages.filter(({ code }) => interfaceLanguageCodes.has(code));

export function getAppLanguage(code: string | undefined): AppLanguage {
  return appLanguages.find((language) => language.code === code)
    ?? appLanguages[0];
}

export function getLanguageCode(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLocaleLowerCase();
  const match = appLanguages.find((language) => (
    language.code === normalized
    || language.name.toLocaleLowerCase() === normalized
    || language.nativeName.toLocaleLowerCase() === normalized
  ));
  return match?.code;
}

export function getInterfaceLanguage(value: unknown): string | undefined {
  const code = getLanguageCode(value);
  return interfaceLanguages.some((language) => language.code === code) ? code : undefined;
}

export function detectLanguageFromScript(text: string, fallback: string): string {
  if (/\p{Script=Telugu}/u.test(text)) return 'te';
  if (/\b(?:nenu|naaku|meeru|mee|ekkada|ippudu|cheyyali|pampali|enduku|ela|avuthundi|ledu|cheppu)\b/i.test(text)) return 'te';
  if (/\p{Script=Tamil}/u.test(text)) return 'ta';
  if (/\p{Script=Kannada}/u.test(text)) return 'kn';
  if (/\p{Script=Malayalam}/u.test(text)) return 'ml';
  if (/\p{Script=Bengali}/u.test(text)) return fallback === 'as' ? 'as' : 'bn';
  if (/\p{Script=Gujarati}/u.test(text)) return 'gu';
  if (/\p{Script=Oriya}/u.test(text)) return 'or';
  if (/\p{Script=Gurmukhi}/u.test(text)) return 'pa';
  if (/\p{Script=Arabic}/u.test(text)) return fallback === 'sd' ? 'sd' : 'ur';
  if (/\p{Script=Ol_Chiki}/u.test(text)) return 'sat';
  if (/\p{Script=Devanagari}/u.test(text)) return fallback && ['hi', 'mr', 'ne', 'sa', 'mai', 'doi', 'brx', 'kok', 'ks'].includes(fallback) ? fallback : 'hi';
  if (/\p{Script=Meetei_Mayek}/u.test(text)) return 'mni';
  return fallback;
}
