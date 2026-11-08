// Keep Spotify search text separate from URI encoding. In particular, '+' in a
// URI path is a literal character, not a substitute for a space.
function normalizeSpotifyQuery(value) {
  if (typeof value !== 'string' || value.length > 500) throw new Error('Use a Spotify search phrase under 500 characters.');
  let query = value.trim();
  // Repair a compact form-encoded phrase, as in Michael+Jackson+Smooth+Criminal.
  // Do this BEFORE decoding so an explicit %2B stays a literal plus. Leading,
  // repeated, spaced, and ambiguous single pluses (such as +44 or A+B) stay intact.
  if (/^[^\s+]+(?:\+[^\s+]+){2,}$/u.test(query)) query = query.replaceAll('+', ' ');
  try { query = decodeURIComponent(query); } catch { /* A literal '%' is valid in a title. */ }
  query = query.replace(/\s+/gu, ' ').trim();
  if (!query) throw new Error('Enter a song or artist to search for.');
  return query;
}

function spotifySearchURL(value) {
  const query = normalizeSpotifyQuery(value);
  return { query, uri: 'spotify:search:' + encodeURIComponent(query) };
}

function normalizeSpotifyWebURL(value) {
  const url = new URL(value);
  if (url.hostname !== 'open.spotify.com' || !['http:', 'https:'].includes(url.protocol)) return url.href;
  const match = url.pathname.match(/^(\/(?:intl-[a-z-]+\/)?search\/)([^/]+)(\/?)$/i);
  if (match) url.pathname = match[1] + encodeURIComponent(normalizeSpotifyQuery(match[2])) + match[3];
  return url.href;
}

async function openSpotifySearch(value, openExternal) {
  const { query, uri } = spotifySearchURL(value);
  await openExternal(uri);
  return { status: 'search_requested', query };
}

module.exports = { normalizeSpotifyQuery, spotifySearchURL, normalizeSpotifyWebURL, openSpotifySearch };
