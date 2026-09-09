# Spotify Organizer

A local web application for organizing your Spotify liked songs into existing playlists.

## Features

- Sign in with Spotify using OAuth Authorization Code flow, automatic access-token refresh, and logout.
- Browse liked songs with track name, artists, and album.
- See which indexed, accessible playlists contain each song.
- Add a song to multiple selected playlists, skipping memberships already recorded in the index.
- Remove a song from selected playlists, with per-playlist success and failure feedback.
- Load more liked songs in pages of 20.
- Sort by most recently saved, oldest saved, first artist, track name, or album.
- Filter liked songs with no playlist membership in the current index.

## Technology and architecture

- Frontend: React 18, TypeScript, and Vite 5.
- Backend: Node.js, Express, TypeScript, express-session, dotenv, and CORS.
- Integration: Spotify Web API and Spotify OAuth.
- Tooling: npm workspaces, tsx for backend development, and concurrently.

```text
React frontend -> Express backend -> Spotify Web API
```

The frontend sends requests with a session cookie. The backend handles OAuth through Spotify Accounts, keeps access and refresh tokens in the server-side session, and calls Spotify on the user's behalf. A per-session index maps track IDs to playlists. Successful playlist changes update both Spotify and the local index.

## Project structure

```text
spotify-organizer/
  apps/
    api/
      src/
        server.ts          # HTTP routes, OAuth, and sessions
        spotifyService.ts  # Spotify API requests and token refresh
        playlistIndex.ts   # In-memory playlist membership index
      package.json
    web/
      src/
        App.tsx            # Authentication and library interface
        main.tsx           # React entry point
        styles.css
      vite.config.ts
      package.json
  .env.example
  package.json             # Workspace scripts
  README.md
```

## Prerequisites

- Node.js 18 or newer and npm with workspace support (npm 9 or newer).
- A browser and internet access.
- A Spotify account with access to a Spotify Developer App and permission to use it.

## Spotify Developer App

Create or configure an app in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) for Web API access. Obtain its client ID and client secret for the backend configuration.

Register this exact local redirect URI in the app settings:

```text
http://127.0.0.1:3001/auth/callback
```

Use the same value for `SPOTIFY_REDIRECT_URI`. Spotify permits HTTP for explicit loopback IP addresses and does not accept `localhost` as a redirect URI. See the [Spotify redirect URI requirements](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri).

The backend requests these scopes during sign-in:

- `user-library-read`
- `playlist-read-private`
- `playlist-modify-public`
- `playlist-modify-private`

## Environment configuration

The checked-in `.env.example` currently contains only `PORT=3001` and `VITE_API_URL=http://localhost:3001`; it does not include the OAuth settings required by the current backend.

If you do not already have a root `.env`, copy the template there:

```powershell
Copy-Item .env.example .env
```

On macOS or Linux, use `cp .env.example .env` instead. Configure the root `.env` as follows; the credential and secret values below are placeholders:

```dotenv
PORT=3001
FRONTEND_URL=http://127.0.0.1:5173
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
SPOTIFY_REDIRECT_URI=http://127.0.0.1:3001/auth/callback
SESSION_SECRET=replace_with_a_long_random_secret
VITE_API_URL=http://127.0.0.1:3001
```

The backend explicitly loads the root `.env`. `PORT` selects its port, `FRONTEND_URL` controls the destination after sign-in, and `SESSION_SECRET` signs session cookies. Without a session secret, the backend generates one at startup. Keep credentials private and never put them in a `VITE_` variable.

Vite runs from `apps/web` and does not load the root `.env` with the current configuration. The frontend already defaults to `http://127.0.0.1:3001`, so no separate frontend environment file is needed for this setup. To override `VITE_API_URL`, provide it in the frontend process environment or an `apps/web/.env` file.

Use `127.0.0.1` consistently and keep frontend port `5173` for this local setup: the backend CORS origin is fixed to `http://127.0.0.1:5173`. The Vite development proxy also targets backend port `3001`.

## Install and run locally

From the repository root:

```bash
npm install
npm run dev
```

This starts both development servers:

- Frontend: http://127.0.0.1:5173
- Backend: http://127.0.0.1:3001
- Backend health check: http://127.0.0.1:3001/api/health

To run the servers separately, use `npm run dev:api` and `npm run dev:web` in separate terminals.

`npm run build` compiles both workspaces. `npm run start:api` runs the compiled backend. `npm run start:web` runs Vite's build preview; its default preview port differs from the configured frontend origin. For a local preview matching OAuth and CORS, run `npm run start:web -- --port 5173` alongside the backend and open http://127.0.0.1:5173.

## How it works

1. Open the frontend and sign in with Spotify, granting the requested permissions.
2. The app loads the first page of liked songs, fetches playlists and their tracks, and builds the membership index.
3. Browse songs and their playlist memberships. Select playlists for a song, then submit an addition or removal.
4. Load more songs in the default view. Choosing another sort order or the no-playlist filter loads the remaining liked-song pages before showing the full result.
5. Sign out to destroy the session and clear its index.

## Current limitations

- Sessions, tokens, and playlist indexes are stored in backend memory. There is no database or persistent application storage; restarting the backend requires signing in again.
- Membership results cover only playlists and tracks the app can retrieve. Playlist reads returning HTTP 403 are skipped; local files and non-track items are excluded. The no-playlist filter means no membership found in this index.
- Listed playlists are not prefiltered by edit permission. Spotify can reject additions or removals.
- Changes made outside the app are not synchronized automatically. Reload the page to rebuild the index.
- Indexing and full-library loading can take time for large libraries and can fail due to Spotify access restrictions or rate limits.
- The interface currently uses Portuguese. This setup is intended for local development; it uses in-memory sessions and cookies configured for local HTTP.
