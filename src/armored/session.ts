import { AudioBus } from "./audio";
import { Sim, type Drive } from "./sim";
import type { TankMap } from "./types";
import { YardView, type DrawTank } from "./view";

export type TouchState = {
  throttle: number;
  steer: number;
  aimX: number;
  aimY: number;
  aimOn: boolean;
  fire: boolean;
};

export type Snap = {
  hp: number;
  maxHp: number;
  reload: number;
  reloadMax: number;
  speed: number;
  surface: string;
  message: string;
  yaw: number;
  enemyHp: number;
  enemyMax: number;
  enemyName: string;
  over: "" | "win" | "loss";
  name: string;
  x: number;
  y: number;
};

export type SessionOpts = {
  canvas: HTMLCanvasElement;
  minimap?: HTMLCanvasElement | null;
  kind: "play" | "edit";
  map: TankMap;
  hullId: string;
  duel: boolean;
  getMap?: () => TankMap;
  onEdit?: (x: number, y: number, phase: "down" | "move") => void;
  onFrame?: (snap: Snap) => void;
  getTouch?: () => TouchState;
  getPaused?: () => boolean;
  onTogglePause?: () => void;
};

type Probe = {
  getYaw: () => number;
  getSpeed: () => number;
  setKeys: (codes: string[]) => void;
  seed?: (speed: number, yaw: number) => void;
};

declare global {
  interface Window {
    __armoredBind?: (p: Probe) => void;
    __armoredUnbind?: () => void;
    __armoredArm?: boolean;
  }
}

const ZERO_TOUCH: TouchState = { throttle: 0, steer: 0, aimX: 0, aimY: 0, aimOn: false, fire: false };

function dead(v: number) {
  return Math.abs(v) < 0.18 ? 0 : v;
}

function drawMini(canvas: HTMLCanvasElement, sim: Sim) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const map = sim.map;
  const half = map.size / 2;
  const px = (x: number, y: number) => [((x + half) / map.size) * w, ((half - y) / map.size) * w] as const;
  ctx.clearRect(0, 0, w, w);
  ctx.fillStyle = "#12140f";
  ctx.fillRect(0, 0, w, w);
  ctx.strokeStyle = "#3d5c66";
  ctx.lineWidth = 2;
  for (const r of map.rivers) {
    if (r.points.length < 2) continue;
    ctx.beginPath();
    r.points.forEach((p, i) => {
      const [x, y] = px(p.x, p.y);
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });
    ctx.stroke();
  }
  ctx.fillStyle = "#8a7d68";
  for (const a of map.assets) {
    if (a.hp <= 0 && a.kind !== "rock") continue;
    const [x, y] = px(a.x, a.y);
    ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
  }
  const dot = (x: number, y: number, color: string) => {
    const [sx, sy] = px(x, y);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(sx, sy, 3.2, 0, Math.PI * 2);
    ctx.fill();
  };
  dot(sim.player.x, sim.player.y, "#c4a35a");
  if (sim.enemy?.alive) dot(sim.enemy.x, sim.enemy.y, "#a33b2b");
}

export function startSession(opts: SessionOpts) {
  const view = new YardView(opts.canvas);
  const audio = new AudioBus();
  const held = new Set<string>();
  let override: Set<string> | null = null;
  let mouseFire = false;
  let aim: { x: number; y: number } | null = null;
  let dragging = false;
  let raf = 0;
  let deadSession = false;
  let uiAcc = 0;

  const play = opts.kind === "play";
  const sim = play ? new Sim(structuredClone(opts.map), opts.hullId, opts.duel) : null;
  if (sim) {
    view.setMode("chase", sim.map.size);
    view.setMap(sim.map);
  } else if (opts.getMap) {
    const map = opts.getMap();
    view.setMode("overhead", map.size);
    view.setMap(map);
  }

  const onKeyDown = (e: KeyboardEvent) => {
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
    if (e.code === "Escape") {
      opts.onTogglePause?.();
      return;
    }
    held.add(e.code);
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
  };
  const onKeyUp = (e: KeyboardEvent) => held.delete(e.code);
  const clear = () => held.clear();

  const onPointerDown = (e: PointerEvent) => {
    audio.unlock();
    const p = view.pick(e.clientX, e.clientY);
    if (!p) return;
    if (!play) {
      dragging = true;
      opts.onEdit?.(p.x, p.y, "down");
      return;
    }
    aim = p;
    mouseFire = true;
  };
  const onPointerMove = (e: PointerEvent) => {
    const p = view.pick(e.clientX, e.clientY);
    if (!p) return;
    if (!play) {
      if (dragging) opts.onEdit?.(p.x, p.y, "move");
      return;
    }
    aim = p;
  };
  const onPointerUp = () => {
    mouseFire = false;
    dragging = false;
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", clear);
  opts.canvas.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  opts.canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  const pressed = (code: string) => (override ?? held).has(code);

  const readDrive = (): Drive => {
    let throttle = (pressed("KeyW") || pressed("ArrowUp") ? 1 : 0) - (pressed("KeyS") || pressed("ArrowDown") ? 1 : 0);
    let steer = (pressed("KeyA") || pressed("ArrowLeft") ? 1 : 0) - (pressed("KeyD") || pressed("ArrowRight") ? 1 : 0);
    const touch = opts.getTouch?.() ?? ZERO_TOUCH;
    let padFire = false;
    if (!override) {
      if (Math.abs(touch.throttle) > 0.08 || Math.abs(touch.steer) > 0.08) {
        throttle = touch.throttle;
        steer = -touch.steer;
      }
      const pads = navigator.getGamepads?.();
      const gp = pads ? pads[0] : null;
      if (gp) {
        const sx = dead(gp.axes[0] ?? 0);
        const sy = dead(gp.axes[1] ?? 0);
        if (sx || sy) {
          steer = -sx;
          throttle = -sy;
        }
        padFire = !!(gp.buttons[7]?.pressed || gp.buttons[0]?.pressed);
      }
    }
    let aimPoint = aim;
    if (!override && touch.aimOn && sim) {
      const yaw = sim.player.yaw;
      const fx = -Math.sin(yaw);
      const fy = Math.cos(yaw);
      const rx = Math.cos(yaw);
      const ry = Math.sin(yaw);
      aimPoint = {
        x: sim.player.x + (fx * touch.aimY + rx * touch.aimX) * 36,
        y: sim.player.y + (fy * touch.aimY + ry * touch.aimX) * 36,
      };
    }
    const fire = pressed("Space") || mouseFire || padFire || (!override && touch.fire);
    return {
      throttle: Math.max(-1, Math.min(1, throttle)),
      steer: Math.max(-1, Math.min(1, steer)),
      fire,
      aim: aimPoint,
    };
  };

  if (sim) {
    const probe: Probe = {
      getYaw: () => sim.player.yaw,
      getSpeed: () => sim.player.speed,
      setKeys: (codes) => {
        override = codes.length ? new Set(codes) : null;
      },
      seed: (speed, yaw) => {
        sim.player.speed = speed;
        sim.player.yaw = yaw;
        sim.player.turret = yaw;
      },
    };
    window.__armoredBind?.(probe);
  }

  let last = performance.now();
  let acc = 0;
  const tick = (now: number) => {
    if (deadSession) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!sim) {
      const map = opts.getMap?.() ?? opts.map;
      view.setMode("overhead", map.size);
      view.setMap(map);
      view.render();
      raf = requestAnimationFrame(tick);
      return;
    }
    const paused = opts.getPaused?.() ?? false;
    if (!paused && !sim.over) {
      acc += dt;
      let n = 0;
      const drive = readDrive();
      while (acc >= 1 / 60 && n < 8) {
        sim.step(1 / 60, drive);
        for (const ev of sim.events) {
          if (ev.kind === "fire" && ev.team === 0) audio.fire();
          if (ev.kind === "hit") {
            audio.hit(ev.bounce);
            if (!ev.bounce) view.kick();
          }
          if (ev.kind === "kill") audio.boom();
        }
        acc -= 1 / 60;
        n += 1;
      }
    }
    view.setMode("chase", sim.map.size);
    view.setMap(sim.map);
    const draw = (tank: Sim["player"], hull: NonNullable<Sim["playerHull"]>): DrawTank => ({
      x: tank.x,
      y: tank.y,
      yaw: tank.yaw,
      turret: tank.turret,
      hull,
      alive: true,
      flash: tank.flash,
      hurt: tank.alive ? tank.hurt : 0.4,
    });
    view.placeTank("player", draw(sim.player, sim.playerHull));
    view.placeTank("enemy", sim.enemy && sim.enemyHull ? draw(sim.enemy, sim.enemyHull) : null);
    view.drawShots(sim.shots.filter((s) => s.on));
    view.chase(sim.player.x, sim.player.y, sim.player.yaw, dt);
    view.render();
    if (opts.minimap) drawMini(opts.minimap, sim);
    uiAcc += dt;
    if (uiAcc > 0.08 || sim.over) {
      uiAcc = 0;
      opts.onFrame?.({
        hp: sim.player.hp,
        maxHp: sim.playerHull.hp,
        reload: sim.player.reload,
        reloadMax: sim.playerHull.reload,
        speed: sim.player.speed,
        surface: sim.surface,
        message: sim.message,
        yaw: sim.player.yaw,
        enemyHp: sim.enemy?.hp ?? 0,
        enemyMax: sim.enemyHull?.hp ?? 0,
        enemyName: sim.enemyHull?.name ?? "",
        over: sim.over,
        name: sim.playerHull.name,
        x: sim.player.x,
        y: sim.player.y,
      });
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return () => {
    deadSession = true;
    cancelAnimationFrame(raf);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", clear);
    opts.canvas.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    if (sim) window.__armoredUnbind?.();
    view.dispose();
  };
}
