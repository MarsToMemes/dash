// Starts Next.js on a port that is actually free — never on a reserved one.
//
//   node scripts/serve.mjs dev     (npm run dev)
//   node scripts/serve.mjs start   (npm start)
//
// Port 3000 is reserved for the Patrick Pons site. Defaults can be changed with
// PORT (preferred port) and DASH_RESERVED_PORTS (comma-separated).

import { spawn } from "node:child_process";
import net from "node:net";

const mode = process.argv[2] === "start" ? "start" : "dev";
const preferred = Number(process.env.PORT) || 4100;
const reserved = new Set(
  (process.env.DASH_RESERVED_PORTS ?? "3000")
    .split(",")
    .map((p) => Number(p.trim()))
    .filter(Boolean),
);

/** Something already answers on this port (any local interface)? */
function answers(port, host) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    socket.setTimeout(400);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

/** Can we bind it ourselves? */
function bindable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen({ port }, () => server.close(() => resolve(true)));
  });
}

async function isFree(port) {
  if (reserved.has(port)) return false;
  const [v4, v6] = await Promise.all([answers(port, "127.0.0.1"), answers(port, "::1")]);
  if (v4 || v6) return false;
  return bindable(port);
}

let port = preferred;
for (let tries = 0; tries < 50 && !(await isFree(port)); tries++) {
  console.log(`[dash] port ${port} ${reserved.has(port) ? "is reserved" : "is already in use"} — trying ${port + 1}`);
  port++;
}
if (!(await isFree(port))) {
  console.error(`[dash] no free port found between ${preferred} and ${port}. Set PORT to another value.`);
  process.exit(1);
}

console.log(`[dash] starting on http://localhost:${port}`);
const child = spawn("npx", ["next", mode, "-p", String(port)], { stdio: "inherit", env: { ...process.env, PORT: String(port) } });
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
