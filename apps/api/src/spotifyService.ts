const spotifyApiUrl = 'https://api.spotify.com/v1';
const spotifyTokenUrl = 'https://accounts.spotify.com/api/token';

export type LikedTrack = {
  id: string;
  uri: string;
  name: string;
  artists: string[];
  album: string;
  albumImageUrl?: string;
};

export type LikedTracksPage = {
  items: LikedTrack[];
  total: number;
  limit: number;
  offset: number;
  nextOffset: number | null;
};

export type PlaylistSummary = {
  id: string;
  name: string;
  public: boolean;
  collaborative: boolean;
  itemCount: number;
  imageUrl?: string;
};

export type SpotifyPage<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};

type SpotifyTokenResponse = {
  access_token?: string;
  expires_in?: number;
};

type SpotifySavedTracksResponse = {
  items?: Array<{
    track?: {
      id?: string;
      uri?: string;
      name?: string;
      artists?: Array<{ name?: string }>;
      album?: {
        name?: string;
        images?: Array<{ url?: string }>;
      };
    } | null;
  }>;
  total?: number;
  limit?: number;
  offset?: number;
};

export class SpotifyApiError extends Error {
  constructor(public readonly status: number, public readonly retryAfter?: string) {
    super('Spotify API request failed.');
  }
}

async function spotifyRequest<T>(accessToken: string, url: URL): Promise<T> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new SpotifyApiError(response.status, response.headers.get('retry-after') || undefined);
  }

  return response.json() as Promise<T>;
}

export async function refreshSpotifyAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<{ accessToken: string; expiresAt: number }> {
  const response = await fetch(spotifyTokenUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    throw new SpotifyApiError(response.status);
  }

  const tokens = await response.json() as SpotifyTokenResponse;
  if (!tokens.access_token) {
    throw new SpotifyApiError(502);
  }

  return {
    accessToken: tokens.access_token,
    expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
  };
}

export async function fetchLikedTracks(
  accessToken: string,
  limit: number,
  offset: number,
): Promise<LikedTracksPage> {
  const url = new URL(`${spotifyApiUrl}/me/tracks`);
  url.search = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  }).toString();

  const data = await spotifyRequest<SpotifySavedTracksResponse>(accessToken, url);
  const items = (data.items || []).flatMap(({ track }) => {
    if (!track?.id || !track.uri || !track.name || !track.album?.name) {
      return [];
    }

    return [{
      id: track.id,
      uri: track.uri,
      name: track.name,
      artists: (track.artists || [])
        .map((artist) => artist.name)
        .filter((name): name is string => Boolean(name)),
      album: track.album.name,
      albumImageUrl: track.album.images?.[0]?.url,
    }];
  });
  const pageLimit = data.limit ?? limit;
  const pageOffset = data.offset ?? offset;
  const total = data.total ?? pageOffset + items.length;
  const nextOffset = pageOffset + pageLimit < total ? pageOffset + pageLimit : null;

  return { items, total, limit: pageLimit, offset: pageOffset, nextOffset };
}

type SpotifyPlaylist = {
  id?: string;
  name?: string;
  public?: boolean;
  collaborative?: boolean;
  tracks?: { total?: number };
  items?: { total?: number };
  images?: Array<{ url?: string }>;
};

type SpotifyPlaylistTrackItem = {
  item?: { id?: string; type?: string; is_local?: boolean } | null;
};

export async function fetchPlaylistsPage(
  accessToken: string,
  limit: number,
  offset: number,
): Promise<SpotifyPage<PlaylistSummary>> {
  const url = new URL(`${spotifyApiUrl}/me/playlists`);
  url.search = new URLSearchParams({ limit: String(limit), offset: String(offset) }).toString();
  const data = await spotifyRequest<{ items?: SpotifyPlaylist[]; total?: number; limit?: number; offset?: number }>(accessToken, url);
  const items = (data.items || []).flatMap((playlist) => {
    if (!playlist.id || !playlist.name) {
      return [];
    }

    return [{
      id: playlist.id,
      name: playlist.name,
      public: playlist.public === true,
      collaborative: playlist.collaborative === true,
      itemCount: playlist.items?.total ?? playlist.tracks?.total ?? 0,
      imageUrl: playlist.images?.[0]?.url,
    }];
  });

  return {
    items,
    total: data.total ?? offset + items.length,
    limit: data.limit ?? limit,
    offset: data.offset ?? offset,
  };
}

export async function fetchPlaylistItemsPage(
  accessToken: string,
  playlistId: string,
  limit: number,
  offset: number,
): Promise<SpotifyPage<string>> {
  const url = new URL(`${spotifyApiUrl}/playlists/${encodeURIComponent(playlistId)}/items`);
  url.search = new URLSearchParams({ limit: String(limit), offset: String(offset) }).toString();
  const data = await spotifyRequest<{ items?: SpotifyPlaylistTrackItem[]; total?: number; limit?: number; offset?: number }>(accessToken, url);
  const items = (data.items || []).flatMap(({ item }) => {
    if (!item || item.type !== 'track' || !item.id || item.is_local) {
      return [];
    }
    return [item.id];
  });

  return {
    items,
    total: data.total ?? offset + items.length,
    limit: data.limit ?? limit,
    offset: data.offset ?? offset,
  };
}

export async function addTrackToPlaylist(
  accessToken: string,
  playlistId: string,
  trackId: string,
): Promise<void> {
  const response = await fetch(`${spotifyApiUrl}/playlists/${encodeURIComponent(playlistId)}/items`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ uris: [`spotify:track:${trackId}`] }),
  });

  if (!response.ok) {
    throw new SpotifyApiError(response.status, response.headers.get('retry-after') || undefined);
  }
}

export async function removeTrackFromPlaylist(
  accessToken: string,
  playlistId: string,
  trackId: string,
): Promise<void> {
  const response = await fetch(`${spotifyApiUrl}/playlists/${encodeURIComponent(playlistId)}/items`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ items: [{ uri: `spotify:track:${trackId}` }] }),
  });

  if (!response.ok) {
    throw new SpotifyApiError(response.status, response.headers.get('retry-after') || undefined);
  }
}