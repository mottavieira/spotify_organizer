import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'node:crypto';
import path from 'node:path';
import session from 'express-session';
import {
  addTrackToPlaylist,
  removeTrackFromPlaylist,
  fetchLikedTracks,
  refreshSpotifyAccessToken,
  SpotifyApiError,
} from './spotifyService';
import {
  addTrackToPlaylistIndex,
  buildPlaylistIndex,
  clearPlaylistIndex,
  getPlaylistIndex,
  removeTrackFromPlaylistIndex,
} from './playlistIndex';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

declare module 'express-session' {
  interface SessionData {
    oauthState?: string;
    accessToken?: string;
    refreshToken?: string;
    accessTokenExpiresAt?: number;
  }
}

const app = express();
const port = Number(process.env.PORT) || 3001;
const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const spotifyScopes = [
  'user-library-read',
  'playlist-read-private',
  'playlist-modify-public',
  'playlist-modify-private',
].join(' ');

app.use(cors({
  origin: 'http://127.0.0.1:5173',
  credentials: true,
}));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: 24 * 60 * 60 * 1000,
  },
}));

app.get('/auth/login', (req, res) => {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    res.status(500).send('Spotify OAuth is not configured.');
    return;
  }

  const state = crypto.randomBytes(32).toString('hex');
  req.session.oauthState = state;

  const authorizationUrl = new URL('https://accounts.spotify.com/authorize');
  authorizationUrl.search = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    state,
    scope: spotifyScopes,
  }).toString();

  res.redirect(authorizationUrl.toString());
});

app.get('/auth/callback', async (req, res) => {
  const { code, state } = req.query;
  const expectedState = req.session.oauthState;
  delete req.session.oauthState;

  if (typeof code !== 'string' || typeof state !== 'string' || !expectedState) {
    res.status(400).send('Invalid OAuth callback.');
    return;
  }

  const receivedState = Buffer.from(state);
  const storedState = Buffer.from(expectedState);
  if (
    receivedState.length !== storedState.length ||
    !crypto.timingSafeEqual(receivedState, storedState)
  ) {
    res.status(400).send('Invalid OAuth state.');
    return;
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    res.status(500).send('Spotify OAuth is not configured.');
    return;
  }

  try {
    const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      res.status(502).send('Spotify authentication failed.');
      return;
    }

    const tokens = await tokenResponse.json() as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };

    if (!tokens.access_token || !tokens.refresh_token) {
      res.status(502).send('Spotify authentication failed.');
      return;
    }

    req.session.accessToken = tokens.access_token;
    req.session.refreshToken = tokens.refresh_token;
    req.session.accessTokenExpiresAt = Date.now() + (tokens.expires_in || 3600) * 1000;
    res.redirect(frontendUrl);
  } catch {
    res.status(502).send('Spotify authentication failed.');
  }
});

app.get('/auth/status', (req, res) => {
  res.json({ authenticated: Boolean(req.session.accessToken) });
});

app.post('/auth/logout', (req, res) => {
  clearPlaylistIndex(req.session.id);
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.status(204).send();
  });
});

app.get('/api/me/playlists', async (req, res) => {
  if (!req.session.accessToken || !req.session.refreshToken) {
    res.status(401).json({ error: 'Not authenticated.' });
    return;
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    res.status(500).json({ error: 'Spotify OAuth is not configured.' });
    return;
  }

  try {
    let accessToken = req.session.accessToken;
    if (req.session.accessTokenExpiresAt && req.session.accessTokenExpiresAt <= Date.now()) {
      const refreshed = await refreshSpotifyAccessToken(clientId, clientSecret, req.session.refreshToken);
      accessToken = refreshed.accessToken;
      req.session.accessToken = refreshed.accessToken;
      req.session.accessTokenExpiresAt = refreshed.expiresAt;
    }

    try {
      const index = await buildPlaylistIndex(req.session.id, accessToken);
      res.json({ items: index.playlists, total: index.playlists.length });
    } catch (error) {
      if (!(error instanceof SpotifyApiError) || error.status !== 401) {
        throw error;
      }
      const refreshed = await refreshSpotifyAccessToken(clientId, clientSecret, req.session.refreshToken);
      req.session.accessToken = refreshed.accessToken;
      req.session.accessTokenExpiresAt = refreshed.expiresAt;
      const index = await buildPlaylistIndex(req.session.id, refreshed.accessToken);
      res.json({ items: index.playlists, total: index.playlists.length });
    }
  } catch (error) {
    if (error instanceof SpotifyApiError) {
      if (error.retryAfter) {
        res.setHeader('Retry-After', error.retryAfter);
      }
      res.status(error.status === 401 ? 401 : error.status === 429 ? 429 : 502)
        .json({ error: error.status === 403 ? 'Some playlists could not be indexed.' : 'Spotify request failed.' });
      return;
    }
    res.status(502).json({ error: 'Spotify request failed.' });
  }
});

app.get('/api/me/tracks/:trackId/playlists', (req, res) => {
  if (!req.session.accessToken) {
    res.status(401).json({ error: 'Not authenticated.' });
    return;
  }
  const index = getPlaylistIndex(req.session.id);
  if (!index) {
    res.status(409).json({ error: 'Playlists have not been indexed yet.' });
    return;
  }
  res.json({ items: index.trackToPlaylists.get(req.params.trackId) || [] });
});

app.post('/api/me/tracks/:trackId/playlists', async (req, res) => {
  if (!req.session.accessToken || !req.session.refreshToken) {
    res.status(401).json({ error: 'Not authenticated.' });
    return;
  }

  const trackId = req.params.trackId;
  const playlistIds = req.body?.playlistIds;
  const spotifyIdPattern = /^[A-Za-z0-9]{22}$/;
  if (!spotifyIdPattern.test(trackId)) {
    res.status(400).json({ error: 'Invalid track ID.' });
    return;
  }
  if (!Array.isArray(playlistIds)) {
    res.status(400).json({ error: 'playlistIds must be an array.' });
    return;
  }

  const validPlaylistIds = [...new Set(playlistIds.filter(
    (playlistId): playlistId is string => typeof playlistId === 'string' && spotifyIdPattern.test(playlistId),
  ))];
  if (validPlaylistIds.length === 0) {
    res.status(400).json({ error: 'At least one valid playlist is required.' });
    return;
  }

  const index = getPlaylistIndex(req.session.id);
  if (!index) {
    res.status(409).json({ error: 'Playlists have not been indexed yet.' });
    return;
  }

  const currentPlaylists = index.trackToPlaylists.get(trackId) || [];
  const results: Array<{
    playlistId: string;
    status: 'added' | 'already_exists' | 'failed';
    error?: string;
    retryAfter?: string;
  }> = [];
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    res.status(500).json({ error: 'Spotify OAuth is not configured.' });
    return;
  }

  let accessToken = req.session.accessToken;
  for (const playlistId of validPlaylistIds) {
    const playlist = index.playlists.find((candidate) => candidate.id === playlistId);
    if (!playlist) {
      results.push({ playlistId, status: 'failed', error: 'Playlist is not available in the current index.' });
      continue;
    }
    if (currentPlaylists.some((candidate) => candidate.id === playlistId)) {
      results.push({ playlistId, status: 'already_exists' });
      continue;
    }

    try {
      let refreshedAfterUnauthorized = false;
      try {
        await addTrackToPlaylist(accessToken, playlistId, trackId);
      } catch (error) {
        if (!(error instanceof SpotifyApiError) || error.status !== 401 || refreshedAfterUnauthorized) {
          throw error;
        }
        const refreshed = await refreshSpotifyAccessToken(clientId, clientSecret, req.session.refreshToken);
        accessToken = refreshed.accessToken;
        req.session.accessToken = refreshed.accessToken;
        req.session.accessTokenExpiresAt = refreshed.expiresAt;
        refreshedAfterUnauthorized = true;
        await addTrackToPlaylist(accessToken, playlistId, trackId);
      }
      addTrackToPlaylistIndex(req.session.id, trackId, playlist);
      results.push({ playlistId, status: 'added' });
    } catch (error) {
      if (error instanceof SpotifyApiError) {
        results.push({
          playlistId,
          status: 'failed',
          error: error.status === 403 ? 'Playlist could not be modified.' : 'Spotify request failed.',
          ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}),
        });
        if (error.retryAfter) {
          res.setHeader('Retry-After', error.retryAfter);
        }
        continue;
      }
      results.push({ playlistId, status: 'failed', error: 'Spotify request failed.' });
    }
  }

  res.json({ results });
});

app.delete('/api/me/tracks/:trackId/playlists', async (req, res) => {
  if (!req.session.accessToken || !req.session.refreshToken) {
    res.status(401).json({ error: 'Not authenticated.' });
    return;
  }

  const trackId = req.params.trackId;
  const playlistIds = req.body?.playlistIds;
  const spotifyIdPattern = /^[A-Za-z0-9]{22}$/;
  if (!spotifyIdPattern.test(trackId)) {
    res.status(400).json({ error: 'Invalid track ID.' });
    return;
  }
  if (!Array.isArray(playlistIds)) {
    res.status(400).json({ error: 'playlistIds must be an array.' });
    return;
  }

  const validPlaylistIds = [...new Set(playlistIds.filter(
    (playlistId): playlistId is string => typeof playlistId === 'string' && spotifyIdPattern.test(playlistId),
  ))];
  if (validPlaylistIds.length === 0) {
    res.status(400).json({ error: 'At least one valid playlist is required.' });
    return;
  }

  const index = getPlaylistIndex(req.session.id);
  if (!index) {
    res.status(409).json({ error: 'Playlists have not been indexed yet.' });
    return;
  }

  const currentPlaylists = index.trackToPlaylists.get(trackId) || [];
  const results: Array<{
    playlistId: string;
    status: 'removed' | 'not_present' | 'failed';
    error?: string;
    retryAfter?: string;
  }> = [];
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    res.status(500).json({ error: 'Spotify OAuth is not configured.' });
    return;
  }

  let accessToken = req.session.accessToken;
  for (const playlistId of validPlaylistIds) {
    const playlist = index.playlists.find((candidate) => candidate.id === playlistId);
    if (!playlist) {
      results.push({ playlistId, status: 'failed', error: 'Playlist is not available in the current index.' });
      continue;
    }
    if (!currentPlaylists.some((candidate) => candidate.id === playlistId)) {
      results.push({ playlistId, status: 'not_present' });
      continue;
    }

    try {
      try {
        await removeTrackFromPlaylist(accessToken, playlistId, trackId);
      } catch (error) {
        if (!(error instanceof SpotifyApiError) || error.status !== 401) {
          throw error;
        }
        const refreshed = await refreshSpotifyAccessToken(clientId, clientSecret, req.session.refreshToken);
        accessToken = refreshed.accessToken;
        req.session.accessToken = refreshed.accessToken;
        req.session.accessTokenExpiresAt = refreshed.expiresAt;
        await removeTrackFromPlaylist(accessToken, playlistId, trackId);
      }
      removeTrackFromPlaylistIndex(req.session.id, trackId, playlistId);
      results.push({ playlistId, status: 'removed' });
    } catch (error) {
      if (error instanceof SpotifyApiError) {
        results.push({
          playlistId,
          status: 'failed',
          error: error.status === 403 ? 'Playlist could not be modified.' : 'Spotify request failed.',
          ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}),
        });
        if (error.retryAfter) {
          res.setHeader('Retry-After', error.retryAfter);
        }
        continue;
      }
      results.push({ playlistId, status: 'failed', error: 'Spotify request failed.' });
    }
  }

  res.json({ results });
});

app.get('/api/me/liked-tracks', async (req, res) => {
  if (!req.session.accessToken || !req.session.refreshToken) {
    res.status(401).json({ error: 'Not authenticated.' });
    return;
  }

  const parsedLimit = Number(req.query.limit);
  const parsedOffset = Number(req.query.offset);
  const requestedLimit = Number.isFinite(parsedLimit) ? parsedLimit : 20;
  const requestedOffset = Number.isFinite(parsedOffset) ? parsedOffset : 0;
  const limit = Math.min(Math.max(Math.floor(requestedLimit), 1), 50);
  const offset = Math.max(Math.floor(requestedOffset), 0);
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    res.status(500).json({ error: 'Spotify OAuth is not configured.' });
    return;
  }

  try {
    let accessToken = req.session.accessToken;
    if (req.session.accessTokenExpiresAt && req.session.accessTokenExpiresAt <= Date.now()) {
      const refreshed = await refreshSpotifyAccessToken(
        clientId,
        clientSecret,
        req.session.refreshToken,
      );
      accessToken = refreshed.accessToken;
      req.session.accessToken = refreshed.accessToken;
      req.session.accessTokenExpiresAt = refreshed.expiresAt;
    }

    try {
      res.json(await fetchLikedTracks(accessToken, limit, offset));
    } catch (error) {
      if (!(error instanceof SpotifyApiError) || error.status !== 401) {
        throw error;
      }

      const refreshed = await refreshSpotifyAccessToken(
        clientId,
        clientSecret,
        req.session.refreshToken,
      );
      req.session.accessToken = refreshed.accessToken;
      req.session.accessTokenExpiresAt = refreshed.expiresAt;
      res.json(await fetchLikedTracks(refreshed.accessToken, limit, offset));
    }
  } catch (error) {
    if (error instanceof SpotifyApiError) {
      res.status(error.status === 401 ? 401 : 502).json({ error: 'Spotify request failed.' });
      return;
    }

    res.status(502).json({ error: 'Spotify request failed.' });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'spotify-organizer-api',
    timestamp: new Date().toISOString(),
  });
});

app.listen(port, () => {
  console.log(`API running on http://127.0.0.1:${port}`);
});
