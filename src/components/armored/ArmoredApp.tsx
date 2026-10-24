import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { BIOME_IDS, BIOMES, HULLS, NATIONS } from "@/armored/catalog";
import { assetMaxHp, hypot, reportMap } from "@/armored/geom";
import {
  BUILTINS,
  blankMap,
  cloneMap,
  deleteUserMap,
  findMap,
  loadUserMaps,
  sanitizeImport,
  upsertUserMap,
} from "@/armored/maps";
import type { AssetKind, Biome, TankMap } from "@/armored/types";
import type { Snap, TouchState } from "@/armored/session";

type Screen = "garage" | "range" | "editor";
type Tool =
  | "select"
  | "tree"
  | "building"
  | "rock"
  | "fence"
  | "river"
  | "road"
  | "ford"
  | "bridge"
  | "spawnA"
  | "spawnB"
  | "erase";

const TOOLS: { id: Tool; label: string }[] = [
  { id: "select", label: "Select" },
  { id: "tree", label: "Tree" },
  { id: "building", label: "Building" },
  { id: "rock", label: "Rock" },
  { id: "fence", label: "Fence" },
  { id: "river", label: "River" },
  { id: "road", label: "Road" },
  { id: "ford", label: "Ford" },
  { id: "bridge", label: "Bridge" },
  { id: "spawnA", label: "Spawn A" },
  { id: "spawnB", label: "Spawn B" },
  { id: "erase", label: "Erase" },
];

const SCORE_KEY = "armored-tanks-scores-v1";

function facing(yaw: number) {
  const deg = (((yaw * 180) / Math.PI) % 360 + 360) % 360;
  return ["N", "NW", "W", "SW", "S", "SE", "E", "NE"][Math.round(deg / 45) % 8];
}

function clampYard(map: TankMap, x: number, y: number) {
  const h = map.size * 0.5 - 1.2;
  return { x: Math.max(-h, Math.min(h, x)), y: Math.max(-h, Math.min(h, y)) };
}

function finishLines(map: TankMap) {
  const next = structuredClone(map);
  let changed = false;
  for (const key of ["rivers", "roads"] as const) {
    next[key] = next[key]
      .map((line) => {
        if (line.id !== "__draft") return line;
        changed = true;
        if (line.points.length < 2) return null;
        return { ...line, id: `${key}-${Date.now()}` };
      })
      .filter((line): line is NonNullable<typeof line> => !!line);
  }
  if (changed) next.rev += 1;
  return next;
}

function nearestId(map: TankMap, x: number, y: number) {
  let best: { id: string; d: number } | null = null;
  for (const a of map.assets) {
    const d = hypot(a.x - x, a.y - y);
    if (d < 5 && (!best || d < best.d)) best = { id: a.id, d };
  }
  for (const c of map.crossings) {
    const d = hypot(c.x - x, c.y - y);
    if (d < 6 && (!best || d < best.d)) best = { id: c.id, d };
  }
  map.spawns.forEach((s, i) => {
    const d = hypot(s.x - x, s.y - y);
    const id = i === 0 ? "spawn-a" : "spawn-b";
    if (d < 6 && (!best || d < best.d)) best = { id, d };
  });
  return best?.id ?? null;
}

const emptySnap: Snap = {
  hp: 1,
  maxHp: 1,
  reload: 0,
  reloadMax: 1,
  speed: 0,
  surface: "Firm ground",
  message: "",
  yaw: 0,
  enemyHp: 0,
  enemyMax: 0,
  enemyName: "",
  over: "",
  name: "",
  x: 0,
  y: 0,
};

export function ArmoredApp({ initialScreen = "garage" }: { initialScreen?: Screen }) {
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [nation, setNation] = useState<(typeof NATIONS)[number]["id"]>("usa");
  const [hullId, setHullId] = useState("m4a3-sherman");
  const [mapId, setMapId] = useState(BUILTINS[0].id);
  const [duel, setDuel] = useState(true);
  const [user, setUser] = useState<TankMap[]>([]);
  const [draft, setDraft] = useState<TankMap>(() => cloneMap(BUILTINS[0]));
  const [tool, setTool] = useState<Tool>("select");
  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [paused, setPaused] = useState(false);
  const [snap, setSnap] = useState<Snap>(emptySnap);
  const [boot, setBoot] = useState(0);
  const [wins, setWins] = useState<Record<string, number>>({});
  const [touchUi, setTouchUi] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const miniRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef(draft);
  const toolRef = useRef(tool);
  const dragRef = useRef<string | null>(null);
  const pausedRef = useRef(false);
  const touchRef = useRef<TouchState>({ throttle: 0, steer: 0, aimX: 0, aimY: 0, aimOn: false, fire: false });
  const runRef = useRef({ map: cloneMap(BUILTINS[0]), hullId: "m4a3-sherman", duel: true });
  const scored = useRef("");
  draftRef.current = draft;
  toolRef.current = tool;
  pausedRef.current = paused;

  const hull = HULLS.find((h) => h.id === hullId) ?? HULLS[1];
  const maps = useMemo(() => [...BUILTINS, ...user], [user]);
  const report = useMemo(() => reportMap(draft), [draft]);

  useEffect(() => {
    setUser(loadUserMaps());
    try {
      setWins(JSON.parse(localStorage.getItem(SCORE_KEY) || "{}") as Record<string, number>);
    } catch {
      setWins({});
    }
    const mq = window.matchMedia("(pointer: coarse), (max-width: 820px)");
    const apply = () => setTouchUi(mq.matches);
    apply();
    mq.addEventListener?.("change", apply);
    if (window.__armoredArm) begin();
    return () => mq.removeEventListener?.("change", apply);
    // begin is stable enough for the arm flag on first paint
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (screen === "garage") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let stop = () => {};
    let cancel = false;
    const bootMap = runRef.current;
    void import("@/armored/session").then(({ startSession }) => {
      if (cancel) return;
      stop = startSession({
        canvas,
        minimap: miniRef.current,
        kind: screen === "editor" ? "edit" : "play",
        map: screen === "editor" ? draftRef.current : bootMap.map,
        hullId: bootMap.hullId,
        duel: bootMap.duel,
        getMap: () => draftRef.current,
        getPaused: () => pausedRef.current,
        getTouch: () => touchRef.current,
        onTogglePause: () => setPaused((p) => !p),
        onFrame: (next) => setSnap(next),
        onEdit: (x, y, phase) => editAt(x, y, phase),
      });
    });
    return () => {
      cancel = true;
      stop();
    };
    // editAt reads refs; restart only when the screen or a fresh range boot changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, boot]);

  useEffect(() => {
    if (snap.over !== "win") return;
    const token = `${boot}:${runRef.current.hullId}`;
    if (scored.current === token) return;
    scored.current = token;
    const id = runRef.current.hullId;
    setWins((prev) => {
      const next = { ...prev, [id]: (prev[id] ?? 0) + 1 };
      localStorage.setItem(SCORE_KEY, JSON.stringify(next));
      return next;
    });
  }, [snap.over, boot]);

  function begin() {
    const map = findMap(mapId, user);
    runRef.current = { map: cloneMap(map), hullId, duel };
    setPaused(false);
    setSnap(emptySnap);
    setScreen("range");
    setBoot((n) => n + 1);
  }

  function openEditor(from?: TankMap) {
    const source = from ?? findMap(mapId, user);
    setDraft(cloneMap(source));
    setSelected(null);
    setNote("");
    setScreen("editor");
  }

  function editAt(x0: number, y0: number, phase: "down" | "move") {
    const currentTool = toolRef.current;
    setDraft((map) => {
      const spot = clampYard(map, x0, y0);
      const x = spot.x;
      const y = spot.y;
      if (currentTool === "select") {
        if (phase === "down") {
          dragRef.current = nearestId(map, x, y);
          setSelected(dragRef.current);
          return map;
        }
        const id = dragRef.current;
        if (!id) return map;
        const next = structuredClone(map);
        const asset = next.assets.find((a) => a.id === id);
        if (asset) {
          asset.x = x;
          asset.y = y;
        }
        const cross = next.crossings.find((c) => c.id === id);
        if (cross) {
          cross.x = x;
          cross.y = y;
        }
        if (id === "spawn-a" || id === "spawn-b") {
          const i = id === "spawn-a" ? 0 : 1;
          next.spawns[i] = { ...next.spawns[i], x, y };
        }
        next.rev += 1;
        return next;
      }
      if (phase !== "down") return map;
      const next = structuredClone(map);
      if (currentTool === "erase") {
        const id = nearestId(next, x, y);
        next.assets = next.assets.filter((a) => a.id !== id);
        next.crossings = next.crossings.filter((c) => c.id !== id);
        next.rev += 1;
        return next;
      }
      if (currentTool === "spawnA" || currentTool === "spawnB") {
        const i = currentTool === "spawnA" ? 0 : 1;
        next.spawns[i] = { ...next.spawns[i], x, y };
        next.rev += 1;
        return next;
      }
      if (currentTool === "ford" || currentTool === "bridge") {
        next.crossings.push({
          id: `cross-${Date.now()}`,
          x,
          y,
          kind: currentTool,
          radius: currentTool === "bridge" ? 8 : 7,
        });
        next.rev += 1;
        return next;
      }
      if (currentTool === "river" || currentTool === "road") {
        const key = currentTool === "river" ? "rivers" : "roads";
        let line = next[key].find((p) => p.id === "__draft");
        if (!line) {
          line = { id: "__draft", points: [], width: currentTool === "river" ? 8 : 7 };
          next[key].push(line);
        }
        line.points.push({ x, y });
        next.rev += 1;
        return next;
      }
      if (next.assets.length >= 140) return map;
      const kind = currentTool as AssetKind;
      const maxHp = assetMaxHp(kind);
      next.assets.push({
        id: `a-${Date.now()}-${next.assets.length}`,
        kind,
        x,
        y,
        yaw: kind === "fence" ? 90 : 0,
        variant: next.assets.length % 3,
        hp: maxHp,
        maxHp,
        fallYaw: 0,
      });
      next.rev += 1;
      return next;
    });
  }

  function chooseTool(next: Tool) {
    setDraft((m) => finishLines(m));
    setTool(next);
  }

  function saveDraft() {
    const cleaned = finishLines(draft);
    const stored = upsertUserMap(cleaned);
    setDraft(stored);
    setUser(loadUserMaps());
    setMapId(stored.id);
    setNote("Saved in this browser.");
  }

  function testDrive() {
    if (!report.ok) return;
    const cleaned = finishLines(draft);
    setDraft(cleaned);
    runRef.current = { map: cloneMap(cleaned), hullId, duel: true };
    setPaused(false);
    setSnap(emptySnap);
    setScreen("range");
    setBoot((n) => n + 1);
  }

  function exportDraft() {
    const blob = new Blob([JSON.stringify(finishLines(draft), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${draft.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function importDraft(file: File) {
    const parsed = sanitizeImport(await file.text());
    if (!parsed) {
      setNote("That file is not an Armored Tanks yard.");
      return;
    }
    const stored = upsertUserMap(parsed);
    setUser(loadUserMaps());
    setDraft(stored);
    setNote("Imported.");
  }

  const reloadPct = snap.reloadMax ? Math.max(0, 1 - snap.reload / snap.reloadMax) : 1;

  return (
    <main className="min-h-dvh bg-bg text-fg">
      {screen === "garage" ? (
        <div className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-6 pb-16 sm:px-6">
          <header className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs tracking-[0.22em] text-muted uppercase">Field manual</p>
              <h1 className="font-display text-5xl leading-none font-medium tracking-wide text-fg sm:text-6xl">
                Armored Tanks
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted">
                Chase-view range built on the RING LAW yard: cover that stops tracks, shells, or sight, and
                rivers that only a ford or a bridge will cross.
              </p>
            </div>
            <div className="flex gap-2">
              <button type="button" className={ghost} onClick={() => openEditor()}>
                Level editor
              </button>
              <button type="button" data-start className={primary} onClick={() => begin()}>
                Start
              </button>
            </div>
          </header>

          <section className="grid gap-6 lg:grid-cols-[220px_1fr]">
            <div className="flex gap-2 lg:flex-col">
              {NATIONS.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => setNation(n.id)}
                  className={`min-h-11 flex-1 rounded-md border px-3 py-2 text-left ${nation === n.id ? "border-accent bg-surface-2" : "border-line bg-surface"}`}
                >
                  <span className="block font-display text-lg tracking-wide">{n.name}</span>
                  <span className="hidden text-xs text-muted lg:block">{n.blurb}</span>
                </button>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {HULLS.filter((h) => h.nation === nation).map((h) => (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => setHullId(h.id)}
                  className={`rounded-md border p-4 text-left ${hullId === h.id ? "border-accent bg-surface-2" : "border-line bg-surface"}`}
                >
                  <span className="font-display text-2xl tracking-wide">{h.name}</span>
                  <span className="mt-1 block text-xs tracking-widest text-muted uppercase">{h.klass}</span>
                  <span className="mt-3 block text-sm leading-relaxed text-muted">{h.note}</span>
                  <span className="mt-3 block font-mono text-xs text-fg">
                    {h.speed} m/s · pen {h.pen} · armor {h.armorHull}/{h.armorTurret}
                    {(wins[h.id] ?? 0) > 0 ? ` · ${wins[h.id]} wins` : ""}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="grid gap-4 rounded-md border border-line bg-surface p-4 md:grid-cols-[1fr_auto] md:items-end">
            <label className="block text-sm">
              <span className="text-muted">Yard</span>
              <select
                className="mt-1 min-h-11 w-full rounded-md border border-line bg-bg px-3"
                value={mapId}
                onChange={(e) => setMapId(e.target.value)}
              >
                {maps.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} · {BIOMES[m.biome].label} · {m.size} m{m.builtin ? "" : " · yours"}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={duel ? primary : ghost} onClick={() => setDuel(true)}>
                Duel
              </button>
              <button type="button" className={!duel ? primary : ghost} onClick={() => setDuel(false)}>
                Free drive
              </button>
            </div>
          </section>

          <p className="text-sm text-muted">
            {hull.name} on {findMap(mapId, user).name}. W and S are throttle. A turns left, D turns right. Mouse
            aims the gun. Click or Space fires. Esc pauses.
          </p>
        </div>
      ) : null}

      {screen !== "garage" ? (
        <div className={`flex h-dvh flex-col ${screen === "editor" ? "md:flex-row" : ""}`}>
          {screen === "editor" ? (
            <aside className="z-10 max-h-[48dvh] overflow-y-auto border-b border-line bg-surface px-4 py-3 md:max-h-none md:w-80 md:shrink-0 md:border-r md:border-b-0">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display text-2xl tracking-wide">Level editor</h2>
                <button type="button" className={ghost} onClick={() => setScreen("garage")}>
                  Garage
                </button>
              </div>
              <label className="mt-3 block text-sm">
                <span className="text-muted">Name</span>
                <input
                  className="mt-1 min-h-11 w-full rounded-md border border-line bg-bg px-3"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value, rev: draft.rev + 1 })}
                />
              </label>
              <div className="mt-3 flex flex-wrap gap-2">
                {BIOME_IDS.map((id) => (
                  <button
                    key={id}
                    type="button"
                    className={draft.biome === id ? primary : ghost}
                    onClick={() => setDraft({ ...draft, biome: id as Biome, rev: draft.rev + 1 })}
                  >
                    {BIOMES[id].label}
                  </button>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                {([72, 128, 192] as const).map((size) => (
                  <button
                    key={size}
                    type="button"
                    className={draft.size === size ? primary : ghost}
                    onClick={() => {
                      const h = size * 0.5 - 4;
                      const clampS = (s: TankMap["spawns"][number]) => ({
                        ...s,
                        x: Math.max(-h, Math.min(h, s.x)),
                        y: Math.max(-h, Math.min(h, s.y)),
                      });
                      setDraft({
                        ...draft,
                        size,
                        spawns: [clampS(draft.spawns[0]), clampS(draft.spawns[1])],
                        rev: draft.rev + 1,
                      });
                    }}
                  >
                    {size} m
                  </button>
                ))}
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {TOOLS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`${tool === item.id ? primary : ghost} px-2`}
                    onClick={() => chooseTool(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <p className="mt-3 text-xs leading-relaxed text-muted">
                Click the yard to place. Rivers and roads keep taking points until you switch tools. Water stops
                tracks only. Fords are slow. Bridges are full speed. A map is playable when both spawns are dry
                and a hull can path between them.
              </p>
              <ul className={`mt-2 text-sm ${report.ok ? "text-fg" : "text-danger"}`}>
                {report.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              {selected ? (
                <div className="mt-3 flex gap-2">
                  <button type="button" className={ghost} onClick={() => rotateSelected(-15)}>
                    Rotate left
                  </button>
                  <button type="button" className={ghost} onClick={() => rotateSelected(15)}>
                    Rotate right
                  </button>
                </div>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" className={primary} onClick={saveDraft}>
                  Save
                </button>
                <button type="button" className={ghost} disabled={!report.ok} onClick={testDrive}>
                  Test drive
                </button>
                <button type="button" className={ghost} onClick={exportDraft}>
                  Export
                </button>
                <button type="button" className={ghost} onClick={() => fileRef.current?.click()}>
                  Import
                </button>
                {!draft.builtin && draft.id.startsWith("user-") ? (
                  <button
                    type="button"
                    className={ghost}
                    onClick={() => {
                      deleteUserMap(draft.id);
                      setUser(loadUserMaps());
                      setNote("Removed from this browser.");
                    }}
                  >
                    Delete
                  </button>
                ) : null}
              </div>
              {note ? <p className="mt-2 text-sm text-muted">{note}</p> : null}
              <input
                ref={fileRef}
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void importDraft(file);
                  e.target.value = "";
                }}
              />
            </aside>
          ) : null}

          <div className="relative min-h-0 flex-1">
            <canvas ref={canvasRef} className="absolute inset-0 h-full w-full touch-none" />
            {screen === "range" ? (
              <>
                <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-3 sm:p-4">
                  <div className="rounded-md border border-line bg-bg/80 px-3 py-2 backdrop-blur-sm">
                    <p className="font-display text-xl leading-none tracking-wide">{snap.name || hull.name}</p>
                    <p className="mt-1 text-xs text-muted">
                      {facing(snap.yaw)} · {Math.round(snap.speed * 3.6)} km/h · {snap.surface}
                    </p>
                  </div>
                  <div className="flex items-start gap-2">
                    <canvas ref={miniRef} width={160} height={160} className="h-24 w-24 rounded-md border border-line" />
                    <button type="button" className={`${ghost} pointer-events-auto`} onClick={() => setPaused(true)}>
                      Pause
                    </button>
                  </div>
                </div>
                <p className="pointer-events-none absolute inset-x-0 top-20 text-center text-sm text-fg sm:top-16">
                  {snap.message}
                </p>
                <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4">
                  <div className="w-40">
                    <div className="mb-1 flex justify-between text-xs text-muted">
                      <span>Hull</span>
                      <span className="tabular-nums">
                        {Math.ceil(snap.hp)}/{snap.maxHp}
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-sm bg-surface-2">
                      <div className="h-full bg-accent" style={{ width: `${Math.max(0, (snap.hp / snap.maxHp) * 100)}%` }} />
                    </div>
                    <div className="mt-2 mb-1 text-xs text-muted">Gun</div>
                    <div className="h-1.5 overflow-hidden rounded-sm bg-surface-2">
                      <div className="h-full bg-fg" style={{ width: `${reloadPct * 100}%` }} />
                    </div>
                  </div>
                  {snap.enemyName ? (
                    <div className="w-40 text-right">
                      <div className="mb-1 text-xs text-muted">{snap.enemyName}</div>
                      <div className="h-2 overflow-hidden rounded-sm bg-surface-2">
                        <div
                          className="ml-auto h-full bg-danger"
                          style={{ width: `${Math.max(0, (snap.enemyHp / Math.max(1, snap.enemyMax)) * 100)}%` }}
                        />
                      </div>
                    </div>
                  ) : (
                    <span />
                  )}
                </div>
                {touchUi ? (
                  <div className="absolute inset-x-0 bottom-24 flex items-end justify-between px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
                    <Stick
                      label="Drive"
                      onChange={(x, y, active) => {
                        touchRef.current.steer = active ? x : 0;
                        touchRef.current.throttle = active ? y : 0;
                      }}
                    />
                    <button
                      type="button"
                      className={`${primary} h-16 w-16 rounded-full`}
                      onPointerDown={() => {
                        touchRef.current.fire = true;
                      }}
                      onPointerUp={() => {
                        touchRef.current.fire = false;
                      }}
                      onPointerLeave={() => {
                        touchRef.current.fire = false;
                      }}
                    >
                      Fire
                    </button>
                    <Stick
                      label="Aim"
                      onChange={(x, y, active) => {
                        touchRef.current.aimX = x;
                        touchRef.current.aimY = y;
                        touchRef.current.aimOn = active && (Math.abs(x) > 0.15 || Math.abs(y) > 0.15);
                      }}
                    />
                  </div>
                ) : null}
                {paused || snap.over ? (
                  <div className="absolute inset-0 grid place-items-center bg-bg/70 p-4">
                    <div className="at-modal w-full max-w-sm rounded-md border border-line bg-surface p-5">
                      <h2 className="font-display text-3xl tracking-wide">
                        {snap.over === "win" ? "Yard clear" : snap.over === "loss" ? "Hull lost" : "Paused"}
                      </h2>
                      <p className="mt-2 text-sm text-muted">{snap.message || "A turns left. D turns right."}</p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {snap.over ? (
                          <button
                            type="button"
                            className={primary}
                            onClick={() => {
                              setPaused(false);
                              setBoot((n) => n + 1);
                            }}
                          >
                            Rematch
                          </button>
                        ) : (
                          <button type="button" className={primary} onClick={() => setPaused(false)}>
                            Resume
                          </button>
                        )}
                        <button
                          type="button"
                          className={ghost}
                          onClick={() => {
                            setPaused(false);
                            setScreen("garage");
                          }}
                        >
                          Garage
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </main>
  );

  function rotateSelected(deg: number) {
    if (!selected) return;
    setDraft((map) => {
      const next = structuredClone(map);
      const asset = next.assets.find((a) => a.id === selected);
      if (!asset) return map;
      asset.yaw = (asset.yaw + deg + 360) % 360;
      next.rev += 1;
      return next;
    });
  }
}

function Stick({
  label,
  onChange,
}: {
  label: string;
  onChange: (x: number, y: number, active: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const dx = (e.clientX - (r.left + r.width / 2)) / (r.width * 0.38);
    const dy = (e.clientY - (r.top + r.height / 2)) / (r.height * 0.38);
    onChange(Math.max(-1, Math.min(1, dx)), Math.max(-1, Math.min(1, -dy)), true);
  };
  return (
    <div
      ref={ref}
      role="presentation"
      aria-label={label}
      className="relative grid h-28 w-28 touch-none place-items-center rounded-full border border-line bg-surface/85 text-xs text-muted"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        move(e);
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) move(e);
      }}
      onPointerUp={() => onChange(0, 0, false)}
      onPointerCancel={() => onChange(0, 0, false)}
    >
      {label}
    </div>
  );
}

const primary =
  "inline-flex min-h-11 items-center justify-center rounded-md bg-accent px-4 text-sm font-semibold text-accent-fg";
const ghost =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-line bg-surface-2 px-3 text-sm text-fg disabled:opacity-40";
