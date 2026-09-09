import {
  fetchPlaylistItemsPage,
  fetchPlaylistsPage,
  PlaylistSummary,
  SpotifyApiError,
} from './spotifyService';

export type PlaylistIndex = {
  playlists: PlaylistSummary[];
  trackToPlaylists: Map<string, PlaylistSummary[]>;
};

const playlistIndexes = new Map<string, PlaylistIndex>();

export function getPlaylistIndex(sessionId: string): PlaylistIndex | undefined {
  return playlistIndexes.get(sessionId);
}

export function clearPlaylistIndex(sessionId: string): void {
  playlistIndexes.delete(sessionId);
}

export function addTrackToPlaylistIndex(
  sessionId: string,
  trackId: string,
  playlist: PlaylistSummary,
): boolean {
  const index = playlistIndexes.get(sessionId);
  if (!index) {
    return false;
  }

  const matchingPlaylists = index.trackToPlaylists.get(trackId) || [];
  if (matchingPlaylists.some((matchingPlaylist) => matchingPlaylist.id === playlist.id)) {
    return false;
  }

  matchingPlaylists.push(playlist);
  index.trackToPlaylists.set(trackId, matchingPlaylists);
  return true;
}

export function removeTrackFromPlaylistIndex(
  sessionId: string,
  trackId: string,
  playlistId: string,
): boolean {
  const index = playlistIndexes.get(sessionId);
  const matchingPlaylists = index?.trackToPlaylists.get(trackId);
  if (!matchingPlaylists) {
    return false;
  }

  const remainingPlaylists = matchingPlaylists.filter((playlist) => playlist.id !== playlistId);
  if (remainingPlaylists.length === matchingPlaylists.length) {
    return false;
  }

  if (remainingPlaylists.length === 0) {
    index?.trackToPlaylists.delete(trackId);
  } else {
    index?.trackToPlaylists.set(trackId, remainingPlaylists);
  }
  return true;
}

export async function buildPlaylistIndex(
  sessionId: string,
  accessToken: string,
): Promise<PlaylistIndex> {
  const playlists: PlaylistSummary[] = [];
  const trackToPlaylists = new Map<string, PlaylistSummary[]>();
  let playlistOffset = 0;
  const playlistLimit = 50;

  while (true) {
    const page = await fetchPlaylistsPage(accessToken, playlistLimit, playlistOffset);
    playlists.push(...page.items);
    if (page.offset + page.limit >= page.total || page.items.length === 0) {
      break;
    }
    playlistOffset = page.offset + page.limit;
  }

  for (const playlist of playlists) {
    const trackIds: string[] = [];
    let itemOffset = 0;
    const itemLimit = 50;

    try {
      while (true) {
        const page = await fetchPlaylistItemsPage(accessToken, playlist.id, itemLimit, itemOffset);
        trackIds.push(...page.items);
        if (page.offset + page.limit >= page.total || page.items.length === 0) {
          break;
        }
        itemOffset = page.offset + page.limit;
      }
    } catch (error) {
      if (error instanceof SpotifyApiError && error.status === 403) {
        continue;
      }
      throw error;
    }

    for (const trackId of trackIds) {
      const matchingPlaylists = trackToPlaylists.get(trackId) || [];
      if (matchingPlaylists.some((matchingPlaylist) => matchingPlaylist.id === playlist.id)) {
        continue;
      }
      matchingPlaylists.push(playlist);
      trackToPlaylists.set(trackId, matchingPlaylists);
    }
  }

  const index = { playlists, trackToPlaylists };
  playlistIndexes.set(sessionId, index);
  return index;
}