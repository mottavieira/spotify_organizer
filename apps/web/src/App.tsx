import { useEffect, useMemo, useRef, useState } from 'react';

const apiUrl = import.meta.env.VITE_API_URL || 'http://127.0.0.1:3001';

type LikedTrack = {
  id: string;
  name: string;
  artists: string[];
  album: string;
};

type LikedTracksPage = {
  items: LikedTrack[];
  nextOffset: number | null;
};

type Playlist = { id: string; name: string };

type SortOption = 'recent' | 'oldest' | 'artist' | 'track' | 'album';
type DisplayOption = 'all' | 'without-playlist';

type PlaylistIndexResponse = {
  items: Playlist[];
};

type AddResult = {
  playlistId: string;
  status: 'added' | 'already_exists' | 'failed';
  error?: string;
};

type RemoveResult = {
  playlistId: string;
  status: 'removed' | 'not_present' | 'failed';
  error?: string;
};

export default function App() {
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tracks, setTracks] = useState<LikedTrack[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [tracksLoading, setTracksLoading] = useState(false);
  const [tracksError, setTracksError] = useState<string | null>(null);
  const [sortOption, setSortOption] = useState<SortOption>('recent');
  const [displayOption, setDisplayOption] = useState<DisplayOption>('all');
  const [allLikedTracksLoaded, setAllLikedTracksLoaded] = useState(false);
  const [fullLibraryLoading, setFullLibraryLoading] = useState(false);
  const [fullLibraryError, setFullLibraryError] = useState<string | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [initializing, setInitializing] = useState(false);
  const [initializationError, setInitializationError] = useState<string | null>(null);
  const [trackPlaylists, setTrackPlaylists] = useState<Record<string, Playlist[]>>({});
  const [selectedPlaylists, setSelectedPlaylists] = useState<Record<string, string[]>>({});
  const [selectedPlaylistsToRemove, setSelectedPlaylistsToRemove] = useState<Record<string, string[]>>({});
  const [addingTrackId, setAddingTrackId] = useState<string | null>(null);
  const [removingTrackId, setRemovingTrackId] = useState<string | null>(null);
  const [addMessages, setAddMessages] = useState<Record<string, string>>({});
  const [removeMessages, setRemoveMessages] = useState<Record<string, string>>({});
  const initializationStarted = useRef(false);
  const fullLibraryPromise = useRef<Promise<void> | null>(null);

  const displayedTracks = useMemo(() => {
    const filteredTracks = displayOption === 'without-playlist'
      ? tracks.filter((track) => (trackPlaylists[track.id] || []).length === 0)
      : tracks;
    if (sortOption === 'recent') {
      return filteredTracks;
    }

    const sortedTracks = [...filteredTracks];
    const compare = (first: LikedTrack, second: LikedTrack) => {
      if (sortOption === 'oldest') {
        return 0;
      }
      if (sortOption === 'artist') {
        return (first.artists[0] || '').localeCompare(second.artists[0] || '', 'pt-BR', { sensitivity: 'base' });
      }
      if (sortOption === 'track') {
        return first.name.localeCompare(second.name, 'pt-BR', { sensitivity: 'base' });
      }
      return first.album.localeCompare(second.album, 'pt-BR', { sensitivity: 'base' });
    };

    sortedTracks.sort(compare);
    return sortOption === 'oldest' ? sortedTracks.reverse() : sortedTracks;
  }, [displayOption, sortOption, trackPlaylists, tracks]);

  useEffect(() => {
    fetch(`${apiUrl}/auth/status`, { credentials: 'include' })
      .then((response) => response.json() as Promise<{ authenticated: boolean }>)
      .then((status) => {
        setAuthenticated(status.authenticated);
        if (status.authenticated && !initializationStarted.current) {
          initializationStarted.current = true;
          initializeSpotifyData();
        }
      })
      .catch(() => setAuthenticated(false))
      .finally(() => setLoading(false));
  }, []);

  const logout = async () => {
    await fetch(`${apiUrl}/auth/logout`, { method: 'POST', credentials: 'include' });
    setAuthenticated(false);
    initializationStarted.current = false;
    setTracks([]);
    setNextOffset(null);
    setSortOption('recent');
    setDisplayOption('all');
    setAllLikedTracksLoaded(false);
    setFullLibraryError(null);
    setPlaylists([]);
    setTrackPlaylists({});
    setSelectedPlaylists({});
    setSelectedPlaylistsToRemove({});
    setAddMessages({});
    setRemoveMessages({});
  };

  const fetchTrackPlaylists = async (tracksToAssociate: LikedTrack[]) => {
    const associations: Record<string, Playlist[]> = {};
    await Promise.all(tracksToAssociate.map(async (track) => {
      const response = await fetch(`${apiUrl}/api/me/tracks/${encodeURIComponent(track.id)}/playlists`, {
        credentials: 'include',
      });
      if (response.ok) {
        associations[track.id] = (await response.json() as { items: Playlist[] }).items;
      }
    }));
    return associations;
  };

  const mergeTrackPlaylists = (associations: Record<string, Playlist[]>) => {
    setTrackPlaylists((current) => ({ ...current, ...associations }));
  };

  const fetchLikedTracks = async (offset: number) => {
    const response = await fetch(`${apiUrl}/api/me/liked-tracks?limit=20&offset=${offset}`, {
      credentials: 'include',
    });
    if (!response.ok) {
      throw new Error('Não foi possível carregar as músicas curtidas.');
    }
    return response.json() as Promise<LikedTracksPage>;
  };

  const initializeSpotifyData = async () => {
    setInitializing(true);
    setInitializationError(null);
    setTracksError(null);
    try {
      const firstPage = await fetchLikedTracks(0);
      setTracks(firstPage.items);
      setNextOffset(firstPage.nextOffset);
      setAllLikedTracksLoaded(firstPage.nextOffset === null);

      const playlistsResponse = await fetch(`${apiUrl}/api/me/playlists`, { credentials: 'include' });
      if (!playlistsResponse.ok) throw new Error('Não foi possível carregar as playlists.');
      const playlistData = await playlistsResponse.json() as PlaylistIndexResponse;
      setPlaylists(playlistData.items);

      const associations = await fetchTrackPlaylists(firstPage.items);
      setTrackPlaylists(associations);
    } catch (error) {
      setInitializationError(error instanceof Error ? error.message : 'Não foi possível preparar os dados do Spotify.');
    } finally {
      setInitializing(false);
    }
  };

  const retryInitialization = () => {
    initializeSpotifyData();
  };

  const loadFullLibrary = async () => {
    if (allLikedTracksLoaded) {
      return;
    }
    if (fullLibraryPromise.current) {
      return fullLibraryPromise.current;
    }

    const promise = (async () => {
      setFullLibraryLoading(true);
      setFullLibraryError(null);
      try {
        let offset = nextOffset;
        const knownTrackIds = new Set(tracks.map((track) => track.id));
        while (offset !== null) {
          const page = await fetchLikedTracks(offset);
          const newTracks = page.items.filter((track) => !knownTrackIds.has(track.id));
          newTracks.forEach((track) => knownTrackIds.add(track.id));
          if (newTracks.length > 0) {
            setTracks((currentTracks) => {
              const currentIds = new Set(currentTracks.map((track) => track.id));
              return [...currentTracks, ...newTracks.filter((track) => !currentIds.has(track.id))];
            });
            mergeTrackPlaylists(await fetchTrackPlaylists(newTracks));
          }
          offset = page.nextOffset;
        }
        setNextOffset(null);
        setAllLikedTracksLoaded(true);
      } catch (error) {
        setFullLibraryError(error instanceof Error ? error.message : 'Não foi possível carregar a biblioteca completa.');
      } finally {
        setFullLibraryLoading(false);
        fullLibraryPromise.current = null;
      }
    })();

    fullLibraryPromise.current = promise;
    return promise;
  };

  const changeSortOption = async (nextSortOption: SortOption) => {
    setSortOption(nextSortOption);
    if (nextSortOption !== 'recent' && !allLikedTracksLoaded) {
      await loadFullLibrary();
    }
  };

  const changeDisplayOption = async (nextDisplayOption: DisplayOption) => {
    setDisplayOption(nextDisplayOption);
    if (nextDisplayOption === 'without-playlist' && !allLikedTracksLoaded) {
      await loadFullLibrary();
    }
  };

  const loadLikedTracks = async (offset = 0) => {
    setTracksLoading(true);
    setTracksError(null);
    try {
      const page = await fetchLikedTracks(offset);
      setTracks((currentTracks) => {
        if (offset === 0) {
          return page.items;
        }
        const currentIds = new Set(currentTracks.map((track) => track.id));
        return [...currentTracks, ...page.items.filter((track) => !currentIds.has(track.id))];
      });
      setNextOffset(page.nextOffset);
      if (offset > 0) {
        const associations = await fetchTrackPlaylists(page.items);
        mergeTrackPlaylists(associations);
      }
      if (page.nextOffset === null) {
        setAllLikedTracksLoaded(true);
      }
    } catch (error) {
      setTracksError(error instanceof Error ? error.message : 'Não foi possível carregar as músicas curtidas.');
    } finally {
      setTracksLoading(false);
    }
  };

  const togglePlaylist = (trackId: string, playlistId: string) => {
    setSelectedPlaylists((current) => {
      const currentSelection = current[trackId] || [];
      const nextSelection = currentSelection.includes(playlistId)
        ? currentSelection.filter((id) => id !== playlistId)
        : [...currentSelection, playlistId];
      return { ...current, [trackId]: nextSelection };
    });
  };

  const addTrackToPlaylists = async (track: LikedTrack) => {
    const playlistIds = selectedPlaylists[track.id] || [];
    if (playlistIds.length === 0) {
      setAddMessages((current) => ({ ...current, [track.id]: 'Selecione ao menos uma playlist.' }));
      return;
    }

    setAddingTrackId(track.id);
    setAddMessages((current) => ({ ...current, [track.id]: '' }));
    try {
      const response = await fetch(`${apiUrl}/api/me/tracks/${encodeURIComponent(track.id)}/playlists`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ playlistIds }),
      });
      const data = await response.json() as { results?: AddResult[]; error?: string };
      if (!response.ok || !data.results) {
        throw new Error(data.error || 'Não foi possível adicionar a música.');
      }

      const successfulIds = data.results
        .filter((result) => result.status === 'added' || result.status === 'already_exists')
        .map((result) => result.playlistId);
      setTrackPlaylists((current) => {
        const existing = current[track.id] || [];
        const additions = playlists.filter((playlist) => successfulIds.includes(playlist.id));
        const merged = [...existing, ...additions.filter((playlist) => !existing.some((item) => item.id === playlist.id))];
        return { ...current, [track.id]: merged };
      });
      setSelectedPlaylists((current) => ({ ...current, [track.id]: [] }));
      const added = data.results.filter((result) => result.status === 'added').length;
      const alreadyExists = data.results.filter((result) => result.status === 'already_exists').length;
      const failed = data.results.filter((result) => result.status === 'failed').length;
      setAddMessages((current) => ({
        ...current,
        [track.id]: `${added} adicionada(s), ${alreadyExists} já existente(s), ${failed} falha(s).`,
      }));
    } catch (error) {
      setAddMessages((current) => ({
        ...current,
        [track.id]: error instanceof Error ? error.message : 'Não foi possível adicionar a música.',
      }));
    } finally {
      setAddingTrackId(null);
    }
  };

  const togglePlaylistToRemove = (trackId: string, playlistId: string) => {
    setSelectedPlaylistsToRemove((current) => {
      const currentSelection = current[trackId] || [];
      const nextSelection = currentSelection.includes(playlistId)
        ? currentSelection.filter((id) => id !== playlistId)
        : [...currentSelection, playlistId];
      return { ...current, [trackId]: nextSelection };
    });
  };

  const removeTrackFromPlaylists = async (track: LikedTrack) => {
    const playlistIds = selectedPlaylistsToRemove[track.id] || [];
    if (playlistIds.length === 0) {
      setRemoveMessages((current) => ({ ...current, [track.id]: 'Selecione ao menos uma playlist.' }));
      return;
    }

    setRemovingTrackId(track.id);
    setRemoveMessages((current) => ({ ...current, [track.id]: '' }));
    try {
      const response = await fetch(`${apiUrl}/api/me/tracks/${encodeURIComponent(track.id)}/playlists`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ playlistIds }),
      });
      const data = await response.json() as { results?: RemoveResult[]; error?: string };
      if (!response.ok || !data.results) {
        throw new Error(data.error || 'Não foi possível remover a música.');
      }

      const removedIds = data.results
        .filter((result) => result.status === 'removed')
        .map((result) => result.playlistId);
      setTrackPlaylists((current) => ({
        ...current,
        [track.id]: (current[track.id] || []).filter((playlist) => !removedIds.includes(playlist.id)),
      }));
      setSelectedPlaylists((current) => ({
        ...current,
        [track.id]: (current[track.id] || []).filter((playlistId) => !removedIds.includes(playlistId)),
      }));
      setSelectedPlaylistsToRemove((current) => ({
        ...current,
        [track.id]: (current[track.id] || []).filter((playlistId) => !removedIds.includes(playlistId)),
      }));
      const removed = data.results.filter((result) => result.status === 'removed').length;
      const notPresent = data.results.filter((result) => result.status === 'not_present').length;
      const failed = data.results.filter((result) => result.status === 'failed').length;
      setRemoveMessages((current) => ({
        ...current,
        [track.id]: `${removed} removida(s), ${notPresent} não presente(s), ${failed} falha(s).`,
      }));
    } catch (error) {
      setRemoveMessages((current) => ({
        ...current,
        [track.id]: error instanceof Error ? error.message : 'Não foi possível remover a música.',
      }));
    } finally {
      setRemovingTrackId(null);
    }
  };

  return (
    <main className="app-shell">
      <div className="card">
        <p className="eyebrow">Spotify Organizer</p>
        {!authenticated ? <h1>Conecte seu Spotify</h1> : null}
        {loading ? <p>Verificando conexão...</p> : null}
        {!loading && authenticated && initializing ? (
          <p>Preparando suas músicas e playlists...</p>
        ) : null}
        {!loading && authenticated && initializationError ? (
          <>
            <p role="alert">{initializationError}</p>
            <button type="button" onClick={retryInitialization} disabled={initializing}>
              Tentar novamente
            </button>
          </>
        ) : null}
        {!loading && authenticated && !initializing && !initializationError ? (
          <>
            <p>Conexão com Spotify realizada.</p>
            <button type="button" onClick={logout}>Sair</button>
            <label className="sort-control">
              Ordenar por
              <select
                value={sortOption}
                disabled={fullLibraryLoading}
                onChange={(event) => { void changeSortOption(event.target.value as SortOption); }}
              >
                <option value="recent">Mais recentes</option>
                <option value="oldest">Mais antigas</option>
                <option value="artist">Artista</option>
                <option value="track">Música</option>
                <option value="album">Álbum</option>
              </select>
            </label>
            <label className="sort-control">
              Exibir
              <select
                value={displayOption}
                disabled={fullLibraryLoading}
                onChange={(event) => { void changeDisplayOption(event.target.value as DisplayOption); }}
              >
                <option value="all">Todas as músicas</option>
                <option value="without-playlist">Sem nenhuma playlist</option>
              </select>
            </label>
            {fullLibraryLoading ? <p>Carregando biblioteca completa...</p> : null}
            {fullLibraryError ? (
              <>
                <p role="alert">{fullLibraryError}</p>
                <button type="button" onClick={() => { void loadFullLibrary(); }} disabled={fullLibraryLoading}>
                  Tentar carregar novamente
                </button>
              </>
            ) : null}
            {tracksError ? <p role="alert">{tracksError}</p> : null}
            {!fullLibraryLoading && !(displayOption === 'without-playlist' && fullLibraryError) ? (
              <p className="track-count">{displayedTracks.length} {displayedTracks.length === 1 ? 'música' : 'músicas'}</p>
            ) : null}
            {!fullLibraryLoading && !(displayOption === 'without-playlist' && fullLibraryError) && displayedTracks.length > 0 ? (
              <ul>
                {displayedTracks.map((track) => (
                  <li key={track.id}>
                    <strong>{track.name}</strong>
                    <span>{track.artists.join(', ')} · {track.album}</span>
                    <span>Já está em: {trackPlaylists[track.id]?.map((playlist) => playlist.name).join(', ') || 'nenhuma playlist acessível'}</span>
                    {playlists.length > 0 ? (
                      <fieldset>
                        <legend>Adicionar a playlists</legend>
                        {playlists.map((playlist) => {
                          const alreadyContains = trackPlaylists[track.id]?.some((item) => item.id === playlist.id) || false;
                          return (
                            <label key={playlist.id}>
                              <input
                                type="checkbox"
                                checked={alreadyContains || (selectedPlaylists[track.id] || []).includes(playlist.id)}
                                disabled={alreadyContains || addingTrackId !== null}
                                onChange={() => togglePlaylist(track.id, playlist.id)}
                              />
                              {playlist.name}{alreadyContains ? ' (já contém)' : ''}
                            </label>
                          );
                        })}
                        <button type="button" onClick={() => addTrackToPlaylists(track)} disabled={addingTrackId !== null}>
                          {addingTrackId === track.id ? 'Adicionando...' : 'Adicionar às playlists'}
                        </button>
                        {addMessages[track.id] ? <span role="status">{addMessages[track.id]}</span> : null}
                      </fieldset>
                    ) : null}
                    {trackPlaylists[track.id]?.length > 0 ? (
                      <fieldset>
                        <legend>Remover de playlists</legend>
                        {trackPlaylists[track.id].map((playlist) => (
                          <label key={playlist.id}>
                            <input
                              type="checkbox"
                              checked={(selectedPlaylistsToRemove[track.id] || []).includes(playlist.id)}
                              disabled={removingTrackId !== null}
                              onChange={() => togglePlaylistToRemove(track.id, playlist.id)}
                            />
                            {playlist.name}
                          </label>
                        ))}
                        <button type="button" onClick={() => removeTrackFromPlaylists(track)} disabled={removingTrackId !== null}>
                          {removingTrackId === track.id ? 'Removendo...' : 'Remover das playlists'}
                        </button>
                        {removeMessages[track.id] ? <span role="status">{removeMessages[track.id]}</span> : null}
                      </fieldset>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {displayOption === 'all' && sortOption === 'recent' && nextOffset !== null && !allLikedTracksLoaded ? (
              <button type="button" onClick={() => loadLikedTracks(nextOffset)} disabled={tracksLoading}>
                {tracksLoading ? 'Carregando...' : 'Carregar mais'}
              </button>
            ) : null}
          </>
        ) : null}
        {!loading && !authenticated ? (
          <button type="button" onClick={() => { window.location.href = `${apiUrl}/auth/login`; }}>
            Entrar com Spotify
          </button>
        ) : null}
      </div>
    </main>
  );
}
