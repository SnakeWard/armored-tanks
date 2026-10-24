import * as T from "three";
import { BIOMES } from "./catalog";
import { footprint } from "./geom";
import type { Asset, Hull, TankMap } from "./types";

export type DrawTank = {
  x: number;
  y: number;
  yaw: number;
  turret: number;
  hull: Hull;
  alive: boolean;
  flash: number;
  hurt: number;
};

const _desired = new T.Vector3();
const _look = new T.Vector3();
const _ndc = new T.Vector2();
const _ray = new T.Raycaster();
const _plane = new T.Plane(new T.Vector3(0, 1, 0), 0);
const _hit = new T.Vector3();

export class YardView {
  readonly renderer: T.WebGLRenderer;
  readonly scene = new T.Scene();
  readonly persp = new T.PerspectiveCamera(46, 1, 0.15, 520);
  readonly ortho = new T.OrthographicCamera(-1, 1, 1, -1, 0.1, 800);
  private sun: T.DirectionalLight;
  private ground: T.Mesh;
  private yard: T.Mesh;
  private props = new T.Group();
  private propById = new Map<string, T.Object3D>();
  private player: T.Group;
  private enemy: T.Group;
  private shots: T.InstancedMesh;
  private dummy = new T.Object3D();
  private spawnA: T.Mesh;
  private spawnB: T.Mesh;
  private groundTex: T.CanvasTexture | null = null;
  private mapRev = -1;
  private mode: "chase" | "overhead" = "chase";
  private camReady = false;
  private shake = 0;
  private sized = { w: 0, h: 0 };
  private shared: {
    trunk: T.MeshStandardMaterial;
    canopy: T.MeshStandardMaterial;
    wall: T.MeshStandardMaterial;
    roof: T.MeshStandardMaterial;
    rock: T.MeshStandardMaterial;
    fence: T.MeshStandardMaterial;
  };
  private geos: T.BufferGeometry[];

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFShadowMap;
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    const hemi = new T.HemisphereLight(0xd5ddd4, 0x3a3328, 0.78);
    this.scene.add(hemi);
    this.sun = new T.DirectionalLight(0xfff0d2, 1.45);
    this.sun.position.set(-48, 92, 36);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.near = 8;
    this.sun.shadow.camera.far = 240;
    const sc = this.sun.shadow.camera;
    sc.left = -70;
    sc.right = 70;
    sc.top = 70;
    sc.bottom = -70;
    this.scene.add(this.sun, this.sun.target);

    this.shared = {
      trunk: new T.MeshStandardMaterial({ color: 0x5a4636, roughness: 0.9 }),
      canopy: new T.MeshStandardMaterial({ color: 0x2f4a32, roughness: 1 }),
      wall: new T.MeshStandardMaterial({ color: 0x8a7d68, roughness: 0.92 }),
      roof: new T.MeshStandardMaterial({ color: 0x5c564e, roughness: 0.85 }),
      rock: new T.MeshStandardMaterial({ color: 0x6e6a60, roughness: 0.95 }),
      fence: new T.MeshStandardMaterial({ color: 0x8d8a82, roughness: 0.8 }),
    };

    const trunk = new T.CylinderGeometry(0.16, 0.28, 1.7, 6);
    const canopy = new T.ConeGeometry(1.45, 2.6, 7);
    canopy.translate(0, 2.15, 0);
    const box = new T.BoxGeometry(1, 1, 1);
    const rock = new T.DodecahedronGeometry(1, 0);
    const barrel = new T.CylinderGeometry(1, 1, 1, 10);
    barrel.rotateX(Math.PI / 2);
    const flashGeo = new T.SphereGeometry(0.22, 6, 6);
    this.trunkGeo = trunk;
    this.canopyGeo = canopy;
    this.boxGeo = box;
    this.rockGeo = rock;
    this.barrelGeo = barrel;
    this.flashGeo = flashGeo;
    this.geos = [trunk, canopy, box, rock, barrel, flashGeo];

    const gmat = new T.MeshStandardMaterial({ color: 0x5c684c, roughness: 1 });
    this.ground = new T.Mesh(new T.PlaneGeometry(1, 1), gmat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
    this.yard = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshStandardMaterial({ color: 0x232820, roughness: 1 }));
    this.yard.rotation.x = -Math.PI / 2;
    this.yard.position.y = -0.04;
    this.scene.add(this.yard);

    this.scene.add(this.props);
    this.player = this.makeTank(0x6a7344);
    this.enemy = this.makeTank(0x6a6a4e);
    this.scene.add(this.player, this.enemy);

    const shotGeo = new T.SphereGeometry(0.16, 6, 6);
    this.geos.push(shotGeo);
    this.shots = new T.InstancedMesh(
      shotGeo,
      new T.MeshStandardMaterial({ color: 0xf2d7a4, emissive: 0xf2d7a4, emissiveIntensity: 0.7, roughness: 0.4 }),
      16,
    );
    this.shots.count = 0;
    this.shots.frustumCulled = false;
    this.scene.add(this.shots);

    const ring = new T.RingGeometry(1.4, 1.7, 20);
    ring.rotateX(-Math.PI / 2);
    this.geos.push(ring);
    this.spawnA = new T.Mesh(ring, new T.MeshBasicMaterial({ color: 0xc4a35a, side: T.DoubleSide }));
    this.spawnB = new T.Mesh(ring, new T.MeshBasicMaterial({ color: 0xa33b2b, side: T.DoubleSide }));
    this.spawnA.position.y = 0.05;
    this.spawnB.position.y = 0.05;
    this.scene.add(this.spawnA, this.spawnB);
    this.ortho.up.set(0, 0, -1);
  }

  private boxGeo: T.BufferGeometry;
  private barrelGeo: T.BufferGeometry;
  private trunkGeo: T.BufferGeometry;
  private canopyGeo: T.BufferGeometry;
  private rockGeo: T.BufferGeometry;
  private flashGeo: T.BufferGeometry;

  private makeTank(color: number) {
    const hullMat = new T.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.16 });
    const dark = new T.MeshStandardMaterial({ color: 0x1a1c16, roughness: 0.88 });
    const gun = new T.MeshStandardMaterial({ color: 0x2a2c26, metalness: 0.45, roughness: 0.42 });
    const group = new T.Group();
    const hull = new T.Mesh(this.boxGeo, hullMat);
    hull.castShadow = true;
    hull.receiveShadow = true;
    const turret = new T.Group();
    const tub = new T.Mesh(this.boxGeo, hullMat);
    tub.castShadow = true;
    const barrel = new T.Mesh(this.barrelGeo, gun);
    barrel.castShadow = true;
    const flash = new T.Mesh(this.flashGeo, new T.MeshBasicMaterial({ color: 0xffe2a8 }));
    turret.add(tub, barrel, flash);
    const trackL = new T.Mesh(this.boxGeo, dark);
    const trackR = new T.Mesh(this.boxGeo, dark);
    group.add(hull, trackL, trackR, turret);
    group.userData = { hull, turret, tub, barrel, flash, trackL, trackR, hullMat };
    return group;
  }

  private paint(map: TankMap) {
    const c = document.createElement("canvas");
    c.width = c.height = 1024;
    const g = c.getContext("2d");
    if (!g) return;
    const biome = BIOMES[map.biome];
    const size = map.size;
    const half = size / 2;
    const pt = (x: number, y: number) => [((x + half) / size) * 1024, ((half - y) / size) * 1024] as const;
    g.fillStyle = biome.ground;
    g.fillRect(0, 0, 1024, 1024);
    for (let i = 0; i < 1800; i++) {
      const x = Math.random() * 1024;
      const y = Math.random() * 1024;
      g.fillStyle = i % 2 ? "rgba(20,24,16,0.08)" : "rgba(255,244,220,0.05)";
      g.fillRect(x, y, 3 + (i % 5), 2);
    }
    const stroke = (points: { x: number; y: number }[], width: number, color: string) => {
      if (points.length < 2) return;
      g.strokeStyle = color;
      g.lineWidth = (width / size) * 1024;
      g.lineCap = "round";
      g.lineJoin = "round";
      g.beginPath();
      points.forEach((p, i) => {
        const [px, py] = pt(p.x, p.y);
        if (i) g.lineTo(px, py);
        else g.moveTo(px, py);
      });
      g.stroke();
    };
    for (const r of map.roads) stroke(r.points, r.width, biome.road);
    for (const r of map.rivers) stroke(r.points, r.width + 1.2, biome.water);
    for (const c of map.crossings) {
      const [px, py] = pt(c.x, c.y);
      const rad = (c.radius / size) * 1024;
      g.fillStyle = c.kind === "bridge" ? biome.road : "#8a7044";
      g.beginPath();
      g.ellipse(px, py, rad * 0.85, rad * 0.55, 0, 0, Math.PI * 2);
      g.fill();
    }
    const tex = new T.CanvasTexture(c);
    tex.colorSpace = T.SRGBColorSpace;
    tex.anisotropy = 4;
    if (this.groundTex) this.groundTex.dispose();
    this.groundTex = tex;
    (this.ground.material as T.MeshStandardMaterial).map = tex;
    (this.ground.material as T.MeshStandardMaterial).color.set(biome.ground);
    (this.ground.material as T.MeshStandardMaterial).needsUpdate = true;
    this.shared.canopy.color.set(biome.tree);
    this.shared.wall.color.set(biome.wall);
    this.shared.rock.color.set(biome.rock);
    this.renderer.setClearColor(biome.sky);
    this.scene.fog = new T.Fog(new T.Color(biome.sky).getHex(), 55, Math.max(150, map.size * 1.15));
  }

  setMap(map: TankMap) {
    if (map.rev === this.mapRev && this.propById.size === map.assets.length) {
      this.syncProps(map);
      return;
    }
    this.mapRev = map.rev;
    this.paint(map);
    this.ground.scale.set(map.size, map.size, 1);
    this.yard.scale.set(map.size + 160, map.size + 160, 1);
    const span = map.size * 0.62;
    const sc = this.sun.shadow.camera;
    sc.left = -span;
    sc.right = span;
    sc.top = span;
    sc.bottom = -span;
    sc.updateProjectionMatrix();
    for (const obj of this.propById.values()) this.props.remove(obj);
    this.propById.clear();
    for (const a of map.assets) {
      const obj = this.buildProp(a);
      this.props.add(obj);
      this.propById.set(a.id, obj);
    }
    this.placeSpawn(this.spawnA, map.spawns[0].x, map.spawns[0].y);
    this.placeSpawn(this.spawnB, map.spawns[1].x, map.spawns[1].y);
    this.syncProps(map);
    this.layoutOrtho(map.size);
  }

  private placeSpawn(mesh: T.Mesh, x: number, y: number) {
    mesh.position.x = x;
    mesh.position.z = -y;
  }

  private buildProp(a: Asset) {
    const g = new T.Group();
    const fp = footprint(a);
    if (a.kind === "tree") {
      g.add(new T.Mesh(this.trunkGeo, this.shared.trunk), new T.Mesh(this.canopyGeo, this.shared.canopy));
    } else if (a.kind === "rock") {
      const m = new T.Mesh(this.rockGeo, this.shared.rock);
      m.scale.set(fp.hx, 1.3 + (a.variant % 3) * 0.25, fp.hy);
      m.position.y = 0.7;
      m.castShadow = true;
      g.add(m);
    } else if (a.kind === "fence") {
      const m = new T.Mesh(this.boxGeo, this.shared.fence);
      m.scale.set(fp.hx * 2, 1.1, fp.hy * 2);
      m.position.y = 0.55;
      m.castShadow = true;
      g.add(m);
    } else {
      const wall = new T.Mesh(this.boxGeo, this.shared.wall);
      wall.scale.set(fp.hx * 2, 3.1, fp.hy * 2);
      wall.position.y = 1.55;
      wall.castShadow = true;
      wall.receiveShadow = true;
      const roof = new T.Mesh(this.boxGeo, this.shared.roof);
      roof.scale.set(fp.hx * 2.15, 0.45, fp.hy * 2.15);
      roof.position.y = 3.25;
      roof.castShadow = true;
      g.add(wall, roof);
    }
    g.traverse((o) => {
      const m = o as T.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    return g;
  }

  private syncProps(map: TankMap) {
    for (const a of map.assets) {
      const obj = this.propById.get(a.id);
      if (!obj) continue;
      obj.position.set(a.x, 0, -a.y);
      obj.rotation.set(0, (a.yaw * Math.PI) / 180, 0);
      if (a.kind === "tree" && a.hp <= 0) obj.rotation.z = 1.15;
      if (a.kind === "fence") obj.visible = a.hp > 0;
      if (a.kind === "building") obj.scale.y = a.hp <= 0 ? 0.28 : 1;
    }
    this.spawnA.visible = this.mode === "overhead";
    this.spawnB.visible = this.mode === "overhead";
  }

  private fitTank(group: T.Group, d: DrawTank) {
    const u = group.userData as {
      hull: T.Mesh;
      turret: T.Group;
      tub: T.Mesh;
      barrel: T.Mesh;
      flash: T.Mesh;
      trackL: T.Mesh;
      trackR: T.Mesh;
      hullMat: T.MeshStandardMaterial;
    };
    const { hull } = d;
    const bodyH = Math.max(0.7, hull.height * 0.42);
    u.hull.scale.set(hull.width * 0.78, bodyH, hull.length * 0.86);
    u.hull.position.set(0, bodyH * 0.5, 0);
    u.trackL.scale.set(hull.width * 0.16, bodyH * 0.55, hull.length);
    u.trackR.scale.set(hull.width * 0.16, bodyH * 0.55, hull.length);
    u.trackL.position.set(-hull.width * 0.46, bodyH * 0.28, 0);
    u.trackR.position.set(hull.width * 0.46, bodyH * 0.28, 0);
    const casemate = hull.klass === "casemate";
    u.tub.scale.set(hull.width * (casemate ? 0.7 : 0.5), bodyH * (casemate ? 0.55 : 0.72), hull.length * (casemate ? 0.48 : 0.34));
    u.tub.position.set(0, bodyH * 0.55, casemate ? hull.length * 0.08 : 0);
    u.turret.position.set(0, bodyH, 0);
    u.barrel.scale.set(0.07, 0.07, hull.gun);
    u.barrel.position.set(0, bodyH * 0.15, hull.length * (casemate ? 0.22 : 0.12) + hull.gun * 0.5);
    u.flash.position.set(0, bodyH * 0.15, u.barrel.position.z + hull.gun * 0.5);
    u.flash.visible = d.flash > 0;
    u.hullMat.color.setHex(hull.camo);
    u.hullMat.emissive.setHex(d.hurt > 0 ? 0x7a2418 : 0x000000);
    u.hullMat.emissiveIntensity = d.hurt > 0 ? 0.7 : 0;
    const delta = Math.atan2(Math.sin(d.turret - d.yaw), Math.cos(d.turret - d.yaw));
    u.turret.rotation.y = delta;
  }

  placeTank(which: "player" | "enemy", d: DrawTank | null) {
    const group = which === "player" ? this.player : this.enemy;
    if (!d || !d.alive) {
      group.visible = false;
      return;
    }
    group.visible = true;
    const wx = d.x;
    const wz = -d.y;
    group.position.set(wx, 0, wz);
    _look.set(wx - Math.sin(d.yaw), 0, wz - Math.cos(d.yaw));
    group.lookAt(_look);
    this.fitTank(group, d);
  }

  drawShots(list: { x: number; y: number }[]) {
    const n = Math.min(list.length, 16);
    this.shots.count = n;
    for (let i = 0; i < n; i++) {
      this.dummy.position.set(list[i].x, 0.9, -list[i].y);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      this.shots.setMatrixAt(i, this.dummy.matrix);
    }
    this.shots.instanceMatrix.needsUpdate = true;
  }

  kick() {
    this.shake = 0.35;
  }

  setMode(mode: "chase" | "overhead", size: number) {
    this.mode = mode;
    this.spawnA.visible = mode === "overhead";
    this.spawnB.visible = mode === "overhead";
    if (mode === "overhead") {
      this.scene.fog = null;
      this.layoutOrtho(size);
    }
  }

  private layoutOrtho(size: number) {
    const aspect = this.sized.w && this.sized.h ? this.sized.w / this.sized.h : 1;
    const half = size * 0.52;
    if (aspect >= 1) {
      this.ortho.top = half;
      this.ortho.bottom = -half;
      this.ortho.left = -half * aspect;
      this.ortho.right = half * aspect;
    } else {
      this.ortho.left = -half;
      this.ortho.right = half;
      this.ortho.top = half / aspect;
      this.ortho.bottom = -half / aspect;
    }
    this.ortho.position.set(0, 180, 0);
    this.ortho.lookAt(0, 0, 0);
    this.ortho.updateProjectionMatrix();
  }

  chase(x: number, y: number, yaw: number, dt: number) {
    const wx = x;
    const wz = -y;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    _desired.set(wx - fx * 16, 7.4, wz - fz * 16);
    if (!this.camReady) {
      this.persp.position.copy(_desired);
      this.camReady = true;
    }
    const k = 1 - Math.exp(-4.5 * Math.max(dt, 0.001));
    this.persp.position.lerp(_desired, k);
    this.shake = Math.max(0, this.shake - dt * 1.6);
    if (this.shake > 0) {
      this.persp.position.x += (Math.random() - 0.5) * this.shake;
      this.persp.position.y += (Math.random() - 0.5) * this.shake * 0.35;
    }
    _look.set(wx + fx * 8, 1.15, wz + fz * 8);
    this.persp.lookAt(_look);
  }

  pick(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    _ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const cam = this.mode === "overhead" ? this.ortho : this.persp;
    _ray.setFromCamera(_ndc, cam);
    if (!_ray.ray.intersectPlane(_plane, _hit)) return null;
    return { x: _hit.x, y: -_hit.z };
  }

  render() {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    if (w !== this.sized.w || h !== this.sized.h) {
      this.sized = { w, h };
      this.renderer.setSize(w, h, false);
      this.persp.aspect = w / h;
      this.persp.updateProjectionMatrix();
      if (this.mode === "overhead") this.layoutOrtho(this.ground.scale.x || 128);
    }
    this.renderer.render(this.scene, this.mode === "overhead" ? this.ortho : this.persp);
  }

  dispose() {
    this.renderer.dispose();
    this.groundTex?.dispose();
    this.geos.forEach((g) => g.dispose());
    this.scene.traverse((o) => {
      const m = o as T.Mesh;
      if (m.isMesh) {
        const mat = m.material as T.Material | T.Material[];
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      }
    });
  }
}
