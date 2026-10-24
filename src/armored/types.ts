export type Nation = "usa" | "ussr" | "germany";
export type Klass = "light" | "medium" | "heavy" | "casemate";
export type Biome = "forest" | "desert" | "snow" | "jungle" | "urban";
export type AssetKind = "tree" | "building" | "rock" | "fence";

export type Vec = { x: number; y: number };

/** Metres. +x east, +y north. yaw on a spawn is degrees, 0 = north. */
export type Asset = {
  id: string;
  kind: AssetKind;
  x: number;
  y: number;
  yaw: number;
  variant: number;
  hp: number;
  maxHp: number;
  fallYaw: number;
};

export type Polyline = { id: string; points: Vec[]; width: number };
export type Crossing = { id: string; x: number; y: number; kind: "ford" | "bridge"; radius: number };
export type Spawn = { x: number; y: number; yaw: number };

export type TankMap = {
  version: 1;
  id: string;
  name: string;
  biome: Biome;
  size: 72 | 128 | 192;
  assets: Asset[];
  rivers: Polyline[];
  roads: Polyline[];
  crossings: Crossing[];
  spawns: [Spawn, Spawn];
  rev: number;
  builtin?: boolean;
};

export type Hull = {
  id: string;
  name: string;
  nation: Nation;
  klass: Klass;
  hp: number;
  speed: number;
  reverse: number;
  accel: number;
  turn: number;
  turret: number;
  reload: number;
  damage: number;
  pen: number;
  armorHull: number;
  armorTurret: number;
  length: number;
  width: number;
  height: number;
  gun: number;
  camo: number;
  note: string;
};

export type Shot = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ttl: number;
  team: 0 | 1;
  dmg: number;
  pen: number;
  on: boolean;
};

export type Tank = {
  x: number;
  y: number;
  yaw: number;
  turret: number;
  speed: number;
  hp: number;
  reload: number;
  alive: boolean;
  hurt: number;
  flash: number;
};

export type SimEvent =
  | { kind: "fire"; team: 0 | 1; x: number; y: number }
  | { kind: "hit"; x: number; y: number; bounce: boolean }
  | { kind: "kill"; team: 0 | 1 };

export type Report = { ok: boolean; reasons: string[] };
