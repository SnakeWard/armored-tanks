import { assetMaxHp } from "./geom";
import type { Asset, AssetKind, Biome, Spawn, TankMap, Vec } from "./types";

const KEY = "armored-tanks-maps-v1";

let seq = 1;
function uid(prefix: string) {
  seq += 1;
  return `${prefix}-${seq}`;
}

function asset(kind: AssetKind, x: number, y: number, yaw = 0, variant = 0): Asset {
  const maxHp = assetMaxHp(kind);
  return { id: uid(kind), kind, x, y, yaw, variant, hp: maxHp, maxHp, fallYaw: 0 };
}

function line(points: Vec[], width: number) {
  return { id: uid("line"), points, width };
}

function mapBase(
  id: string,
  name: string,
  biome: Biome,
  size: TankMap["size"],
  spawns: [Spawn, Spawn],
): TankMap {
  return {
    version: 1,
    id,
    name,
    biome,
    size,
    assets: [],
    rivers: [],
    roads: [],
    crossings: [],
    spawns,
    rev: 1,
    builtin: true,
  };
}

export function blankMap(): TankMap {
  return {
    version: 1,
    id: `user-${Date.now()}`,
    name: "Untitled yard",
    biome: "forest",
    size: 128,
    assets: [],
    rivers: [],
    roads: [line([{ x: 0, y: -50 }, { x: 0, y: 50 }], 8)],
    crossings: [],
    spawns: [
      { x: 0, y: -42, yaw: 0 },
      { x: 0, y: 42, yaw: 180 },
    ],
    rev: 1,
  };
}

function crossroads(): TankMap {
  const m = mapBase("crossroads", "Three-way crossing", "forest", 128, [
    { x: 0, y: -52, yaw: 0 },
    { x: 0, y: 52, yaw: 180 },
  ]);
  m.roads = [
    line([{ x: 0, y: -60 }, { x: 0, y: 60 }], 10),
    line([{ x: -50, y: 0 }, { x: 50, y: 0 }], 8),
  ];
  m.assets = [
    asset("building", 18, -16, 0, 0),
    asset("building", -18, 12, 8, 1),
    asset("building", 20, 28, -6, 2),
    asset("building", -22, -30, 4, 1),
    asset("fence", 14, 4, 90, 0),
    asset("fence", -14, -6, 90, 1),
    asset("rock", -46, 24, 0, 0),
    asset("rock", -50, -18, 20, 1),
    asset("rock", 48, -34, 0, 2),
  ];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 3; col++) {
      const x = 34 + col * 7;
      const y = -28 + row * 8;
      if (Math.abs(y) < 6) continue;
      m.assets.push(asset("tree", x, y, 0, (row + col) % 3));
    }
  }
  m.assets.push(asset("tree", -32, 40, 0, 1), asset("tree", -28, -44, 0, 2), asset("tree", 8, 38, 0, 0));
  m.rivers = [line([{ x: -58, y: -20 }, { x: -38, y: -8 }, { x: -40, y: 36 }], 7)];
  m.crossings = [{ id: uid("bridge"), x: -40, y: 8, kind: "bridge", radius: 7 }];
  return m;
}

function quarry(): TankMap {
  const m = mapBase("quarry", "Quarry and village", "desert", 128, [
    { x: -8, y: -50, yaw: 0 },
    { x: 6, y: 48, yaw: 180 },
  ]);
  m.roads = [line([{ x: -8, y: -58 }, { x: -8, y: -8 }, { x: 6, y: 20 }, { x: 6, y: 58 }], 9)];
  const ring = [
    [-24, -8],
    [-18, 10],
    [-6, 16],
    [14, 12],
    [22, -2],
    [16, -16],
    [0, -20],
    [-16, -18],
  ];
  ring.forEach(([x, y], i) => m.assets.push(asset("rock", x, y, i * 12, i % 3)));
  m.assets.push(
    asset("building", -22, 36, 0, 0),
    asset("building", 4, 34, 10, 1),
    asset("building", 24, 40, -8, 2),
    asset("building", 28, 22, 0, 0),
    asset("fence", -4, 26, 90, 0),
    asset("tree", -40, 20, 0, 0),
    asset("tree", -36, 30, 0, 1),
    asset("tree", 40, -28, 0, 2),
    asset("tree", 44, -16, 0, 0),
  );
  return m;
}

function siberia(): TankMap {
  const m = mapBase("siberia", "Siberian lane", "snow", 128, [
    { x: 0, y: -50, yaw: 0 },
    { x: 0, y: 50, yaw: 180 },
  ]);
  m.roads = [line([{ x: 0, y: -60 }, { x: 4, y: 0 }, { x: 0, y: 60 }], 8)];
  for (let i = 0; i < 14; i++) {
    m.assets.push(asset("tree", -26 - (i % 3) * 4, -48 + i * 7, 0, i % 3));
    m.assets.push(asset("tree", 28 + (i % 4) * 3, -44 + i * 6.5, 0, (i + 1) % 3));
  }
  m.assets.push(asset("rock", -14, 8, 0, 0), asset("rock", 16, -12, 0, 1), asset("building", 22, 30, 5, 2));
  m.rivers = [line([{ x: -20, y: 18 }, { x: 24, y: 22 }], 8)];
  m.crossings = [{ id: uid("ford"), x: 2, y: 20, kind: "ford", radius: 7 }];
  return m;
}

function bridgeLine(): TankMap {
  const m = mapBase("bridge-line", "Bridge line", "urban", 72, [
    { x: 0, y: -26, yaw: 0 },
    { x: 0, y: 26, yaw: 180 },
  ]);
  m.roads = [line([{ x: 0, y: -34 }, { x: 0, y: 34 }], 7)];
  m.rivers = [line([{ x: -40, y: 0 }, { x: 40, y: 0 }], 10)];
  m.crossings = [{ id: uid("bridge"), x: 0, y: 0, kind: "bridge", radius: 8 }];
  m.assets = [
    asset("building", -22, -14, 0, 0),
    asset("building", 22, 14, 0, 1),
    asset("tree", -28, 18, 0, 2),
    asset("tree", 28, -18, 0, 1),
  ];
  return m;
}

export const BUILTINS: TankMap[] = [crossroads(), quarry(), siberia(), bridgeLine()];

export function cloneMap(map: TankMap): TankMap {
  const copy = structuredClone(map) as TankMap;
  copy.builtin = false;
  copy.rev = (copy.rev || 1) + 1;
  return copy;
}

export function bump(map: TankMap) {
  map.rev += 1;
  return map;
}

export function loadUserMaps(): TankMap[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { maps?: TankMap[] };
    return (parsed.maps ?? []).filter(isMap).map((m) => ({ ...m, builtin: false }));
  } catch {
    return [];
  }
}

export function saveUserMaps(maps: TankMap[]) {
  localStorage.setItem(KEY, JSON.stringify({ version: 1, maps }));
}

export function upsertUserMap(map: TankMap) {
  const stored = cloneMap(map);
  stored.builtin = false;
  if (!stored.id.startsWith("user-")) stored.id = `user-${Date.now()}`;
  const all = loadUserMaps().filter((m) => m.id !== stored.id);
  all.unshift(stored);
  saveUserMaps(all.slice(0, 24));
  return stored;
}

export function deleteUserMap(id: string) {
  saveUserMaps(loadUserMaps().filter((m) => m.id !== id));
}

function isVec(v: unknown): v is Vec {
  return !!v && typeof v === "object" && typeof (v as Vec).x === "number" && typeof (v as Vec).y === "number";
}

export function isMap(v: unknown): v is TankMap {
  if (!v || typeof v !== "object") return false;
  const m = v as TankMap;
  return (
    typeof m.id === "string" &&
    typeof m.name === "string" &&
    (m.size === 72 || m.size === 128 || m.size === 192) &&
    Array.isArray(m.assets) &&
    Array.isArray(m.spawns) &&
    m.spawns.length === 2 &&
    isVec(m.spawns[0]) &&
    isVec(m.spawns[1])
  );
}

export function sanitizeImport(raw: string): TankMap | null {
  try {
    const parsed = JSON.parse(raw) as TankMap;
    if (!isMap(parsed)) return null;
    parsed.version = 1;
    parsed.builtin = false;
    parsed.rivers ??= [];
    parsed.roads ??= [];
    parsed.crossings ??= [];
    parsed.assets ??= [];
    parsed.rev = (parsed.rev || 0) + 1;
    if (!parsed.id.startsWith("user-")) parsed.id = `user-${Date.now()}`;
    return parsed;
  } catch {
    return null;
  }
}

export function allMaps(user: TankMap[]) {
  return [...BUILTINS, ...user];
}

export function findMap(id: string, user: TankMap[]) {
  return allMaps(user).find((m) => m.id === id) ?? BUILTINS[0];
}
