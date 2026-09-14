/** Only same-origin, relative, non-sign-in paths are allowed as a post-sign-in destination. */
export function safeNext(candidate: string | undefined | null, fallback = '/inbox'): string {
  if (!candidate) return fallback;
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.startsWith('/\\'))
    return fallback;
  if (candidate.startsWith('/sign-in')) return fallback;
  return candidate;
}
