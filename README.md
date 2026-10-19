# Party Demo

A minimal realtime collaborative drawing canvas application built with Cloudflare PartyServer, Cloudflare Workers, Vite, and HTML5 Canvas.

## Prerequisites

- Node.js (v18+)
- npm

## Getting Started

1. Install dependencies:

```bash
npm install
```

2. Start the local development server:

```bash
npm run dev
```

3. Open `http://localhost:5173` in multiple browser tabs or windows to test real-time collaboration.

## Scripts

- `npm run dev`: Start local development server with Vite and Cloudflare Workers runtime.
- `npm run build`: Type-check and build client and worker assets (`tsc && vite build`).
- `npm run preview`: Preview the production build locally.
- `npm run deploy`: Build and deploy the worker to Cloudflare using Wrangler.
