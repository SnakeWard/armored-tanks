import { COVER } from "./catalog";
import type { Asset, AssetKind, Report, TankMap, Vec } from "./types";

export function wrap(a: number) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

export function hypot(x: number, y: number) {
  return Math.hypot(x, y);
}

/** Map-space forward. yaw 0 = north. Positive yaw turns toward west (screen-left in chase). */
export function forward(yaw: number) {
  return { x: -Math.sin(yaw), y: Math.cos(yaw) };
}

export function yawTo(x: number, y: number, tx: number, ty: number) {
  return Math.atan2(-(tx - x), ty - y);
}

export function footprint(a: Pick<Asset, "kind" | "variant">) {
  switch (a.kind) {
    case "tree":
      return { hx: 0.75, hy: 0.75 };
    case "rock":
      return { hx: 2.15, hy: 1.85 };
    case "fence":
      return { hx: 0.32, hy: 3.3 };
    default: {
      const v = a.variant % 3;
      return { hx: 3.2 + v * 0.45, hy: 4.1 + (a.variant % 2) * 0.6 };
    }
  }
}

export function toLocal(a: Pick<Asset, "x" | "y" | "yaw">, x: number, y: number) {
  const th = (a.yaw * Math.PI) / 180;
  const c = Math.cos(th);
  const s = Math.sin(th);
  const dx = x - a.x;
  const dy = y - a.y;
  return { lat: dx * c - dy * s, lon: dx * s + dy * c };
}

export function overlapsAsset(a: Asset, x: number, y: number, radius: number) {
  if (a.hp <= 0 && a.kind !== "rock") return false;
  const { hx, hy } = footprint(a);
  const { lat, lon } = toLocal(a, x, y);
  return Math.abs(lat) < hx + radius && Math.abs(lon) < hy + radius;
}

export function distToPoly(x: number, y: number, pts: Vec[]) {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const l2 = abx * abx + aby * aby || 1;
    const t = clamp(((x - a.x) * abx + (y - a.y) * aby) / l2, 0, 1);
    best = Math.min(best, hypot(x - (a.x + abx * t), y - (a.y + aby * t)));
  }
  return best;
}

export function waterAt(map: TankMap, x: number, y: number): "dry" | "ford" | "bridge" | "water" {
  let wet = false;
  for (const r of map.rivers) {
    if (r.points.length < 2) continue;
    if (distToPoly(x, y, r.points) <= r.width * 0.5) {
      wet = true;
      break;
    }
  }
  if (!wet) return "dry";
  for (const c of map.crossings) {
    if (hypot(c.x - x, c.y - y) <= c.radius) return c.kind;
  }
  return "water";
}

export function canopy(a: Asset): Vec {
  return {
    x: a.x + -Math.sin(a.fallYaw) * 3.2,
    y: a.y + Math.cos(a.fallYaw) * 3.2,
  };
}

export function surfaceAt(map: TankMap, x: number, y: number) {
  const w = waterAt(map, x, y);
  if (w === "ford") return { name: "Ford", factor: 0.55 };
  if (w === "bridge") return { name: "Bridge", factor: 1 };
  if (w === "water") return { name: "Water", factor: 0 };
  for (const a of map.assets) {
    if (a.kind === "building" && a.hp <= 0 && overlapsAsset({ ...a, hp: 1 }, x, y, 0))
      return { name: "Rubble", factor: 0.62 };
    if (a.kind === "tree" && a.hp <= 0) {
      const c = canopy(a);
      if (hypot(x - c.x, y - c.y) < 2.8) return { name: "Fallen timber", factor: 0.7 };
    }
  }
  return { name: "Firm ground", factor: 1 };
}

export function blocker(map: TankMap, x: number, y: number, radius: number) {
  if (waterAt(map, x, y) === "water") return "water" as const;
  for (const a of map.assets) {
    if (!COVER[a.kind].stopsTracks) continue;
    if (overlapsAsset(a, x, y, radius)) return a;
  }
  return null;
}

export function sightBlocked(map: TankMap, ax: number, ay: number, bx: number, by: number) {
  const steps = Math.max(2, Math.ceil(hypot(bx - ax, by - ay) / 1.4));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t;
    for (const a of map.assets) {
      if (a.kind === "rock" || (a.hp > 0 && (a.kind === "building" || a.kind === "tree"))) {
        if (overlapsAsset(a.hp > 0 ? a : { ...a, hp: 1 }, x, y, 0.2)) return true;
      }
      if (a.kind === "tree" && a.hp <= 0) {
        const c = canopy(a);
        if (hypot(x - c.x, y - c.y) < 2.4) return true;
      }
    }
  }
  return false;
}

export function inBounds(map: TankMap, x: number, y: number, pad = 1.5) {
  const h = map.size * 0.5 - pad;
  return Math.abs(x) <= h && Math.abs(y) <= h;
}

const RADIUS = 1.7;

export function reportMap(map: TankMap): Report {
  const reasons: string[] = [];
  const [a, b] = map.spawns;
  const checkSpawn = (s: { x: number; y: number }, label: string) => {
    if (!inBounds(map, s.x, s.y, 3)) reasons.push(`${label} is outside the yard.`);
    else if (blocker(map, s.x, s.y, RADIUS)) reasons.push(`${label} is in cover or water.`);
  };
  checkSpawn(a, "Spawn A");
  checkSpawn(b, "Spawn B");
  if (reasons.length) return { ok: false, reasons };

  const step = 2;
  const half = map.size * 0.5 - 2;
  const cols = Math.ceil((half * 2) / step);
  const key = (ix: number, iy: number) => iy * cols + ix;
  const toX = (ix: number) => -half + ix * step + step * 0.5;
  const toY = (iy: number) => -half + iy * step + step * 0.5;
  const cell = (x: number, y: number) => ({
    ix: clamp(Math.floor((x + half) / step), 0, cols - 1),
    iy: clamp(Math.floor((y + half) / step), 0, cols - 1),
  });
  const open = (ix: number, iy: number) => {
    const x = toX(ix);
    const y = toY(iy);
    return !blocker(map, x, y, RADIUS * 0.85);
  };
  const start = cell(a.x, a.y);
  const goal = cell(b.x, b.y);
  if (!open(start.ix, start.iy) || !open(goal.ix, goal.iy)) {
    reasons.push("A hull-wide path cannot leave one of the spawns.");
    return { ok: false, reasons };
  }
  const seen = new Uint8Array(cols * cols);
  const qx = [start.ix];
  const qy = [start.iy];
  seen[key(start.ix, start.iy)] = 1;
  for (let q = 0; q < qx.length; q++) {
    const ix = qx[q];
    const iy = qy[q];
    if (ix === goal.ix && iy === goal.iy) return { ok: true, reasons: ["Path is clear. Both spawns are dry and open."] };
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = ix + dx;
      const ny = iy + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= cols) continue;
      const k = key(nx, ny);
      if (seen[k] || !open(nx, ny)) continue;
      seen[k] = 1;
      qx.push(nx);
      qy.push(ny);
    }
  }
  reasons.push("No hull-wide path between spawns. Water needs a ford or a bridge.");
  return { ok: false, reasons };
}

export function assetMaxHp(kind: AssetKind) {
  return COVER[kind].hp;
}
