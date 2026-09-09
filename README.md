# Spotify Organizer

Aplicativo web para ajudar o usuário a organizar suas músicas curtidas do Spotify em playlists.

## Stack

- Frontend: React + TypeScript + Vite
- Backend: Node.js + Express + TypeScript
- Estrutura: monorepo com workspaces em `apps/web` e `apps/api`

## Requisitos

- Node.js 18+
- npm 9+

## Instalação

```bash
npm install
```

## Executar em desenvolvimento

```bash
npm run dev
```

Isso inicia simultaneamente:

- Backend em http://localhost:3001
- Frontend em http://localhost:5173

## Scripts disponíveis

```bash
npm run dev
npm run dev:api
npm run dev:web
npm run build
npm run start:api
npm run start:web
```

## Variáveis de ambiente

Copie o arquivo `.env.example` para `.env` e ajuste conforme necessário.

```bash
cp .env.example .env
```

## Estrutura do projeto

```text
apps/
  api/
  web/
```

## Observação

Esta etapa inicial contém apenas a estrutura base e a verificação de compilação e inicialização do projeto. Nenhuma integração com Spotify, OAuth ou funcionalidade de negócio foi implementada.
