/**
 * Two ways to serve a world, detected at boot:
 *
 *   api     the FastAPI backend is up (dev, and uploads)
 *   static  no backend at all, just files under /worlds/<id>/
 *
 * The static mode is what gets submitted: judges should not need a server
 * running to try the piece. scripts/export_static.py produces that layout.
 */
// Relative on purpose: a static build may be served from a subdirectory
// (GitHub Pages does exactly that), where a leading slash points at the
// domain root and misses everything.
const STATIC_ROOT = 'worlds';

let mode = null;

async function detect() {
  if (mode) return mode;
  try {
    const response = await fetch('/api/worlds', { method: 'GET' });
    mode = response.ok ? 'api' : 'static';
  } catch {
    mode = 'static';
  }
  return mode;
}

export function currentMode() {
  return mode;
}

/** Base URL the stems and .glb files hang off, for a given world. */
export function cacheUrl(worldId) {
  return mode === 'api' ? `/cache/${worldId}/` : `${STATIC_ROOT}/${worldId}/`;
}

export async function listWorlds() {
  if ((await detect()) === 'api') {
    const response = await fetch('/api/worlds');
    if (!response.ok) throw new Error(`listWorlds: ${response.status}`);
    return response.json();
  }
  const response = await fetch(`${STATIC_ROOT}/index.json`);
  if (!response.ok) throw new Error('no worlds/index.json in this static build');
  return response.json();
}

export async function getWorld(worldId) {
  const url = (await detect()) === 'api'
    ? `/api/worlds/${worldId}`
    : `${STATIC_ROOT}/${worldId}/world.json`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`getWorld ${worldId}: ${response.status}`);
  return response.json();
}

export async function getStatus(worldId) {
  if ((await detect()) !== 'api') throw new Error('status needs the backend');
  const response = await fetch(`/api/worlds/${worldId}/status`);
  if (!response.ok) throw new Error(`getStatus ${worldId}: ${response.status}`);
  return response.json();
}

export async function createWorld(file, title, dedication) {
  if ((await detect()) !== 'api') throw new Error('uploads need the backend');
  const body = new FormData();
  body.append('file', file);
  body.append('title', title ?? '');
  body.append('dedication', dedication ?? '');
  const response = await fetch('/api/worlds', { method: 'POST', body });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

/** ?world=<id> wins; otherwise open the newest world available. */
export async function resolveWorldId() {
  await detect();
  const requested = new URLSearchParams(location.search).get('world');
  if (requested) return requested;
  const worlds = await listWorlds();
  if (!worlds.length) throw new Error('no worlds built yet - run scripts/build_world.py');
  return worlds[0].id;
}
