/**
 * Content languages tracked for Chhattisgarh. Mirrors the backend enums
 * (Keyword/Event: en, hi, hne, all; NewsArticle: en, hi, hne, unknown).
 *
 * Hindi is the state's official language and the language of its press.
 * Chhattisgarhi ('hne', Devanagari script, often romanised on social media)
 * is the everyday spoken language and common in local political posts.
 */
export const LANGUAGE_LABELS = {
  en: 'English',
  hi: 'Hindi',
  hne: 'Chhattisgarhi',
  all: 'All',
  unknown: 'Unknown',
};

/* Options for keyword / event language pickers, in display order. */
export const KEYWORD_LANGUAGE_OPTIONS = ['en', 'hi', 'hne', 'all'].map((value) => ({
  value,
  label: LANGUAGE_LABELS[value],
}));

export const languageLabel = (code) => LANGUAGE_LABELS[code] || LANGUAGE_LABELS.en;

/**
 * Google Input Tools code for phonetic typing. Google has no Chhattisgarhi
 * input tool; Chhattisgarhi is written in Devanagari, so the Hindi one
 * produces the right script.
 */
export const transliterationCode = (lang) =>
  ({ hne: 'hi-t-i0-und', hi: 'hi-t-i0-und' }[lang] || 'hi-t-i0-und');
