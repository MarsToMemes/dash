# Notes for agents working on this repo

- **Never run anything on port 3000** — it is reserved for the Patrick Pons site on Rémi's machine.
  Always check that a port is free before starting a server. `npm run dev` / `npm start`
  go through `scripts/serve.mjs`, which does this (default 4100, reserved list in `DASH_RESERVED_PORTS`).
- Next.js 16 (Turbopack) + Tailwind 4 + Motion. Read `node_modules/next/dist/docs/` before relying on
  older Next.js conventions.
- Checks: `npm run lint` (typecheck) and `npm test` (node:test on `lib/`).
