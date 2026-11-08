const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeSpotifyQuery, spotifySearchURL, normalizeSpotifyWebURL, openSpotifySearch,
} = require('../spotify');

test('Spotify searches repair the reported separators and encode ordinary spaces', () => {
  const expected = 'Michael Jackson Smooth Criminal';
  for (const input of [expected, 'Michael+Jackson+Smooth+Criminal', 'Michael%20Jackson%20Smooth%20Criminal']) {
    assert.deepEqual(spotifySearchURL(input), {
      query: expected,
      uri: 'spotify:search:Michael%20Jackson%20Smooth%20Criminal',
    });
  }
});

test('Spotify query cleanup preserves literal pluses, Unicode, and percent characters', () => {
  for (const value of ['A+B', '+44', '+++', 'C++', 'Florence + The Machine', '100% Pure Love']) {
    assert.equal(normalizeSpotifyQuery(value), value);
  }
  assert.equal(normalizeSpotifyQuery('Florence+%2B+The+Machine'), 'Florence + The Machine');
  assert.equal(normalizeSpotifyQuery('A%2BB'), 'A+B');
  assert.equal(normalizeSpotifyQuery('%2520'), '%20'); // Decode once, not repeatedly.
  assert.equal(normalizeSpotifyQuery('  Michael\tJackson\nSmooth  Criminal  '), 'Michael Jackson Smooth Criminal');
  const unicode = 'مايكل جاكسون Smooth Criminal';
  assert.equal(normalizeSpotifyQuery(encodeURIComponent(unicode)), unicode);
  assert.equal(spotifySearchURL('A%2BB').uri, 'spotify:search:A%2BB');
});

test('Spotify rejects empty or oversized normalized searches', () => {
  for (const input of ['', ' \n\t ', '%20', 'x'.repeat(501)]) {
    assert.throws(() => normalizeSpotifyQuery(input));
  }
});

test('Spotify web search repair is limited to exact Spotify search routes', () => {
  assert.equal(
    normalizeSpotifyWebURL('https://open.spotify.com/search/Michael+Jackson+Smooth+Criminal?si=abc#top'),
    'https://open.spotify.com/search/Michael%20Jackson%20Smooth%20Criminal?si=abc#top',
  );
  assert.equal(
    normalizeSpotifyWebURL('https://open.spotify.com/intl-fr/search/Florence+%2B+The+Machine'),
    'https://open.spotify.com/intl-fr/search/Florence%20%2B%20The%20Machine',
  );
  for (const url of [
    'https://example.com/search/Michael+Jackson+Smooth+Criminal',
    'https://open.spotify.com.evil.test/search/Michael+Jackson+Smooth+Criminal',
    'https://open.spotify.com/track/A+B+C',
  ]) assert.equal(normalizeSpotifyWebURL(url), url);
});

test('Spotify launcher passes the corrected query to the OS and reports it honestly', async () => {
  const opened = [];
  const result = await openSpotifySearch('Michael+Jackson+Smooth+Criminal', async uri => opened.push(uri));
  assert.deepEqual(opened, ['spotify:search:Michael%20Jackson%20Smooth%20Criminal']);
  assert.deepEqual(result, { status: 'search_requested', query: 'Michael Jackson Smooth Criminal' });
  await assert.rejects(
    openSpotifySearch('Smooth Criminal', async () => { throw new Error('Spotify could not open'); }),
    /Spotify could not open/,
  );
});
