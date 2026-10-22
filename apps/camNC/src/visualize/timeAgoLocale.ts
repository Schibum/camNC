/** Keep malformed browser language tags from crashing Intl's relative-time formatter. */
export function getTimeAgoLocale(language: string | undefined): string {
  try {
    return Intl.getCanonicalLocales(language)[0] ?? 'en';
  } catch {
    return 'en';
  }
}
