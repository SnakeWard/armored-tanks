import { COVER, HULL_BY_ID, rivalFor } from "./catalog";
import {
  blocker,
  clamp,
  forward,
  hypot,
  inBounds,
  overlapsAsset,
  sightBlocked,
  surfaceAt,
  waterAt,
  wrap,
  yawTo,
} from "./geom";
import type { Asset, Hull, Shot, SimEvent, Tank, TankMap } from "./types";

export type Drive = { throttle: number; steer: number; fire: boolean; aim: { x: number; y: number } | null };

const SHOTS = 16;

function makeTank(x: number, y: number, yawDeg: number, hp: number): Tank {
  const yaw = (yawDeg * Math.PI) / 180;
  return { x, y, yaw, turret: yaw, speed: 0, hp, reload: 0.4, alive: true, hurt: 0, flash: 0 };
}

export class Sim {
  map: TankMap;
  player: Tank;
  enemy: Tank | null;
  readonly playerHull: Hull;
  readonly enemyHull: Hull | null;
  shots: Shot[];
  events: SimEvent[] = [];
  time = 0;
  message: string;
  surface = "Firm ground";
  over: "" | "win" | "loss" = "";
  duel: boolean;

  constructor(map: TankMap, hullId: string, duel: boolean) {
    this.map = map;
    this.playerHull = HULL_BY_ID[hullId] ?? HULL_BY_ID["m4a3-sherman"];
    this.duel = duel;
    const s0 = map.spawns[0];
    const s1 = map.spawns[1];
    this.player = makeTank(s0.x, s0.y, s0.yaw, this.playerHull.hp);
    if (duel) {
      this.enemyHull = rivalFor(this.playerHull.id);
      this.enemy = makeTank(s1.x, s1.y, s1.yaw, this.enemyHull.hp);
      this.message = `${this.enemyHull.name} holds the far spawn.`;
    } else {
      this.enemyHull = null;
      this.enemy = null;
      this.message = "Free drive. The yard is yours.";
    }
    this.shots = Array.from({ length: SHOTS }, () => ({
      x: 0, y: 0, vx: 0, vy: 0, ttl: 0, team: 0 as const, dmg: 0, pen: 0, on: false,
    }));
  }

  private radius(hull: Hull) {
    return hull.width * 0.46;
  }

  private moveTank(tank: Tank, hull: Hull, throttle: number, steer: number, dt: number) {
    const surf = surfaceAt(this.map, tank.x, tank.y);
    if (tank === this.player) this.surface = surf.name;
    const top = throttle >= 0 ? hull.speed : hull.reverse;
    const want = throttle * top * surf.factor;
    const rate = want > tank.speed ? hull.accel : hull.accel + 8;
    tank.speed += clamp(want - tank.speed, -rate * dt, hull.accel * dt);
    if (Math.abs(tank.speed) < 0.04 && Math.abs(throttle) < 0.05) tank.speed = 0;
    const factor = Math.max(0.72, Math.min(1, Math.abs(tank.speed) / 6));
    const reverse = tank.speed >= 0 ? 1 : -1;
    tank.yaw += steer * ((hull.turn * Math.PI) / 180) * factor * reverse * dt;
    const f = forward(tank.yaw);
    const dx = f.x * tank.speed * dt;
    const dy = f.y * tank.speed * dt;
    const r = this.radius(hull);
    const movedX = this.slide(tank, dx, 0, r);
    const movedY = this.slide(tank, 0, dy, r);
    if (!movedX && !movedY && (Math.abs(dx) > 0 || Math.abs(dy) > 0)) tank.speed = 0;
    const h = this.map.size * 0.5 - r;
    tank.x = clamp(tank.x, -h, h);
    tank.y = clamp(tank.y, -h, h);
  }

  private slide(tank: Tank, dx: number, dy: number, r: number) {
    if (dx === 0 && dy === 0) return true;
    const nx = tank.x + dx;
    const ny = tank.y + dy;
    if (!inBounds(this.map, nx, ny, r * 0.2)) return false;
    const hit = blocker(this.map, nx, ny, r);
    if (!hit) {
      tank.x = nx;
      tank.y = ny;
      return true;
    }
    if (hit !== "water" && COVER[hit.kind].ram && Math.abs(tank.speed) >= 2.4) {
      this.damageAsset(hit, Math.abs(tank.speed) * 7, tank.yaw);
      tank.speed *= 0.62;
      if (hit.hp <= 0) {
        tank.x = nx;
        tank.y = ny;
        return true;
      }
    }
    return false;
  }

  private damageAsset(a: Asset, amount: number, yaw: number) {
    if (a.kind === "rock" || a.hp <= 0) {
      if (a.kind === "rock") this.message = "Rock stops it.";
      return;
    }
    a.hp = Math.max(0, a.hp - amount);
    if (a.hp === 0) {
      a.fallYaw = yaw;
      this.message =
        a.kind === "tree"
          ? "Tree down. The crown still hides a hull."
          : a.kind === "building"
            ? "Building breached. Rubble is slow."
            : "Fence is open.";
    }
  }

  private aimTurret(tank: Tank, hull: Hull, desired: number, dt: number) {
    const diff = wrap(desired - tank.turret);
    const max = ((hull.turret * Math.PI) / 180) * dt;
    tank.turret += clamp(diff, -max, max);
  }

  private fire(tank: Tank, hull: Hull, team: 0 | 1) {
    if (tank.reload > 0 || !tank.alive || this.over) return;
    const slot = this.shots.find((s) => !s.on);
    if (!slot) return;
    const f = forward(tank.turret);
    const muzzle = hull.length * 0.55 + hull.gun * 0.15;
    slot.on = true;
    slot.x = tank.x + f.x * muzzle;
    slot.y = tank.y + f.y * muzzle;
    slot.vx = f.x * 92;
    slot.vy = f.y * 92;
    slot.ttl = 1.35;
    slot.team = team;
    slot.dmg = hull.damage;
    slot.pen = hull.pen;
    tank.reload = hull.reload;
    tank.flash = 0.07;
    this.events.push({ kind: "fire", team, x: slot.x, y: slot.y });
  }

  private armorOf(hull: Hull) {
    return (hull.armorHull + hull.armorTurret) * 0.5;
  }

  private hurtTank(tank: Tank, hull: Hull, shot: Shot) {
    const armor = this.armorOf(hull);
    tank.hurt = 0.18;
    if (shot.pen < armor * 0.82) {
      this.message = "Bounce.";
      this.events.push({ kind: "hit", x: tank.x, y: tank.y, bounce: true });
      return;
    }
    const full = shot.pen > armor * 1.12;
    tank.hp = Math.max(0, tank.hp - (full ? shot.dmg : shot.dmg * 0.5));
    this.events.push({ kind: "hit", x: tank.x, y: tank.y, bounce: false });
    if (tank.hp <= 0) {
      tank.alive = false;
      tank.speed = 0;
      this.events.push({ kind: "kill", team: shot.team });
      if (tank === this.player) {
        this.over = "loss";
        this.message = "Hull lost.";
      } else {
        this.over = "win";
        this.message = `${hull.name} is burning.`;
      }
    } else {
      this.message = full ? "Penetration." : "Partial pen. Half damage.";
    }
  }

  private stepShots(dt: number) {
    for (const s of this.shots) {
      if (!s.on) continue;
      const dist = hypot(s.vx, s.vy) * dt;
      const n = Math.max(1, Math.ceil(dist / 0.7));
      let dead = false;
      for (let i = 0; i < n && !dead; i++) {
        s.x += (s.vx * dt) / n;
        s.y += (s.vy * dt) / n;
        if (waterAt(this.map, s.x, s.y) === "water") {
          /* shells ignore water */
        }
        for (const a of this.map.assets) {
          if (!COVER[a.kind].stopsShells || a.hp <= 0) {
            if (a.kind === "fence" && a.hp > 0 && overlapsAsset(a, s.x, s.y, 0.15)) this.damageAsset(a, 24, 0);
            continue;
          }
          if (overlapsAsset(a, s.x, s.y, 0.15)) {
            this.damageAsset(a, s.dmg * 0.45, Math.atan2(-s.vx, s.vy));
            this.events.push({ kind: "hit", x: s.x, y: s.y, bounce: false });
            dead = true;
            break;
          }
        }
        if (dead) break;
        const foe = s.team === 0 ? this.enemy : this.player;
        const foeHull = s.team === 0 ? this.enemyHull : this.playerHull;
        if (foe && foe.alive && foeHull && hypot(foe.x - s.x, foe.y - s.y) < this.radius(foeHull) + 0.35) {
          this.hurtTank(foe, foeHull, s);
          dead = true;
        }
      }
      s.ttl -= dt;
      if (dead || s.ttl <= 0 || !inBounds(this.map, s.x, s.y, -4)) s.on = false;
    }
  }

  private driveAI(dt: number) {
    const e = this.enemy;
    const hull = this.enemyHull;
    if (!e || !hull || !e.alive || this.over) return;
    const desired = yawTo(e.x, e.y, this.player.x, this.player.y);
    const diff = wrap(desired - e.yaw);
    const steer = clamp(diff * 1.6, -1, 1);
    const range = hypot(this.player.x - e.x, this.player.y - e.y);
    const see = e.alive && this.player.alive && !sightBlocked(this.map, e.x, e.y, this.player.x, this.player.y);
    let throttle = 0.85;
    if (see && range < 28 && Math.abs(diff) < 0.4) throttle = 0.15;
    if (Math.abs(diff) > 1.4) throttle = 0.45;
    if (range < 12) throttle = -0.35;
    this.moveTank(e, hull, throttle, steer, dt);
    this.aimTurret(e, hull, see ? desired : e.yaw, dt);
    if (see && range < 78 && Math.abs(wrap(desired - e.turret)) < 0.12) this.fire(e, hull, 1);
  }

  step(dt: number, drive: Drive) {
    this.events.length = 0;
    const stepDt = clamp(dt, 0, 0.05);
    this.time += stepDt;
    this.player.reload = Math.max(0, this.player.reload - stepDt);
    this.player.hurt = Math.max(0, this.player.hurt - stepDt);
    this.player.flash = Math.max(0, this.player.flash - stepDt);
    if (this.enemy) {
      this.enemy.reload = Math.max(0, this.enemy.reload - stepDt);
      this.enemy.hurt = Math.max(0, this.enemy.hurt - stepDt);
      this.enemy.flash = Math.max(0, this.enemy.flash - stepDt);
    }
    if (this.player.alive && !this.over) {
      this.moveTank(this.player, this.playerHull, drive.throttle, drive.steer, stepDt);
      const aim = drive.aim
        ? yawTo(this.player.x, this.player.y, drive.aim.x, drive.aim.y)
        : this.player.yaw;
      this.aimTurret(this.player, this.playerHull, aim, stepDt);
      if (drive.fire) this.fire(this.player, this.playerHull, 0);
    }
    this.driveAI(stepDt);
    this.stepShots(stepDt);
  }
}
