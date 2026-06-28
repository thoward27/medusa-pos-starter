// Matches S3/SigV4 presigned-URL params (and the older SigV2 set). These rotate
// per request, so leaving them in the cache key would bust the cache on every
// list refetch. Any other query param (e.g. a future CDN resizer's `?w=`) is kept
// so genuinely different renditions stay distinct.
const SIGNING_PARAM = /^(x-amz-|awsaccesskeyid$|signature$|expires$)/i;

/**
 * Builds a stable expo-image `cacheKey` from a remote image URL by stripping only
 * the volatile S3 signing params. For the current public S3 URLs (no query string)
 * this is a no-op; it just future-proofs against presigned URLs or a CDN resizer.
 *
 * Implemented with plain string ops rather than `URL`, whose React Native polyfill
 * is unreliable.
 */
export function stableCacheKey(url: string): string {
  const queryIndex = url.indexOf('?');
  if (queryIndex === -1) {
    return url;
  }

  const base = url.slice(0, queryIndex);
  const kept = url
    .slice(queryIndex + 1)
    .split('&')
    .filter((pair) => {
      const name = pair.split('=')[0];
      return name.length > 0 && !SIGNING_PARAM.test(name);
    });

  return kept.length > 0 ? `${base}?${kept.join('&')}` : base;
}
