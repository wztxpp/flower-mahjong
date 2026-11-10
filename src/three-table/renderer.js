// 取自Three demo的实体圆角牌、木桌、灯光及Orbit视角；不导入demo的洗牌/摸打/声音。
// Rounded tiles, wooden table, lighting and orbit views derive from the Three demo; no demo rules, actions or audio are imported.
// 角色使用目录批准原画的浅曲面2.5D，静态展示；摸牌角色动画仍暂停，不冒称完整3D骨骼。
// Actors use approved catalog art on shallow 2.5D surfaces, remaining static; character draw motion stays paused, never claiming full 3D rigs.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { MAHJONG_PHOTO_URL, PHOTO_FACE_CROPS } from '../mahjong-photo-faces.js';
import { MAHJONG_WAN_URL, createWanDisplayAtlas, paintWanFace } from '../mahjong-wan-faces.js';
import { realisticCharacterView } from '../realistic-character-catalog.js';
import { TABLE_ZONES, tileGrid } from './adapter.js';
import { createSceneLifetime } from './lifecycle.js';
import { REALISTIC_FLIGHT_DURATION_MS, REALISTIC_FLIGHT_STAGGER_MS } from '../realistic-presentation.js';

const SURFACE_Y = 1.32;
const FLOOR_Y = -7.48;
const SEAT_RADIUS = 13.8;

// 每个实例独占GPU资源；任何加载失败只降级素材，WebGL失败由父级切回经典。
// Each instance owns its GPU resources. Asset errors degrade art; WebGL failure asks the parent for classic mode.
export function createThreeTableRenderer(host, { onFailure, onArtError = () => {}, reducedMotion = false } = {}) {
  const lifetime = createSceneLifetime();
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  const ownGeometry = (value) => { geometries.add(value); return value; };
  const ownMaterial = (value) => { materials.add(value); return value; };
  const ownTexture = (value) => { textures.add(value); return value; };
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  lifetime.add(() => { renderer.dispose(); renderer.forceContextLoss?.(); renderer.domElement.remove(); });
  lifetime.add(() => {
    for (const resource of [...geometries, ...materials, ...textures]) resource.dispose();
  });
  try {
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    host.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('aria-label', 'Three.js 三维麻将桌，操作使用下方原手牌');
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#182f29');
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 240);
    const controls = new OrbitControls(camera, renderer.domElement);
    lifetime.add(() => controls.dispose());
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 12;
    controls.maxDistance = 130;
    controls.maxPolarAngle = 1.4;
    controls.target.set(0, 1, 0);
    scene.add(new THREE.HemisphereLight('#fff1d0', '#243a30', 2.1));
    const light = new THREE.DirectionalLight('#ffebc6', 3.4);
    light.position.set(-4, 18, 7);
    light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024);
    Object.assign(light.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20 });
    light.shadow.normalBias = 0.025;
    scene.add(light);
    lifetime.add(() => light.shadow.dispose());
    const fill = new THREE.DirectionalLight('#aacbc3', 1.1);
    fill.position.set(8, 6, -8);
    scene.add(fill);

    // 稳定共享几何/材质，状态刷新只替换实例，避免每次轮询重建纹理。
    // Share stable geometry/materials; polling replaces instances, not texture caches.
    const bodyGeometry = ownGeometry(new RoundedBoxGeometry(0.48, 0.69, 0.28, 3, 0.045));
    const backGeometry = ownGeometry(new RoundedBoxGeometry(0.462, 0.672, 0.1, 3, 0.037));
    const faceGeometry = ownGeometry(new THREE.PlaneGeometry(0.41, 0.625));
    const cream = ownMaterial(new THREE.MeshStandardMaterial({ color: '#efe9d3', roughness: 0.29 }));
    const green = ownMaterial(new THREE.MeshStandardMaterial({ color: '#225c49', roughness: 0.3 }));
    const wood = ownMaterial(new THREE.MeshStandardMaterial({ color: '#75502f', roughness: 0.44 }));
    const darkWood = ownMaterial(new THREE.MeshStandardMaterial({ color: '#352a20', roughness: 0.58 }));
    const feltMaterial = ownMaterial(new THREE.MeshStandardMaterial({ color: '#316a5c', roughness: 0.93 }));
    function box(width, height, depth, radius, material) {
      const mesh = new THREE.Mesh(ownGeometry(new RoundedBoxGeometry(width, height, depth, 3, radius)), material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      return mesh;
    }
    const table = box(18.9, 0.65, 18.9, 0.35, wood);
    table.position.y = 0.9;
    scene.add(table);
    const felt = box(17.86, 0.07, 17.86, 0.18, feltMaterial);
    felt.position.y = 1.285;
    scene.add(felt);
    const room = new THREE.Group();
    scene.add(room);
    for (const x of [-7.8, 7.8]) for (const z of [-7.8, 7.8]) {
      const leg = box(0.85, 0.6 - FLOOR_Y, 0.85, 0.12, darkWood);
      leg.position.set(x, (0.6 + FLOOR_Y) / 2, z);
      room.add(leg);
    }
    const floor = new THREE.Mesh(ownGeometry(new THREE.PlaneGeometry(150, 150)), ownMaterial(new THREE.MeshStandardMaterial({ color: '#203a31', roughness: 1 })));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = FLOOR_Y;
    floor.receiveShadow = true;
    room.add(floor);
    const actors = new THREE.Group();
    room.add(actors);
    const tileLayer = new THREE.Group();
    scene.add(tileLayer);
    const flightLayer = new THREE.Group();
    scene.add(flightLayer);
    let animations = [];
    let model = null;
    let currentView = 'player';
    let focus = false;
    let previousView = null;
    let actorKey = '';
    let actorViews = [];
    let actorGeneration = 0;
    let actorResources = new Set();
    let photoImage = null;
    let wanAtlas = null;
    const faceCache = new Map();

    // 无图时显示明确的牌名，不能用相似假图掩盖加载失败；成功后原地更新缓存。
    // Missing art uses explicit tile names, never approximate artwork; successful loads repaint cached textures.
    function paintFace(tile, canvas) {
      const context = canvas.getContext('2d');
      context.fillStyle = '#fff7e6';
      context.fillRect(0, 0, canvas.width, canvas.height);
      if (tile >= 18 && paintWanFace(context, canvas.width, canvas.height, { suit: 'wan', rank: tile - 17 }, wanAtlas)) return;
      const crop = PHOTO_FACE_CROPS[tile];
      if (crop && photoImage) {
        context.drawImage(photoImage, ...crop, 0, 0, canvas.width, canvas.height);
        return;
      }
      context.fillStyle = tile < 9 ? '#13583e' : tile < 18 ? '#213c73' : '#a72d28';
      context.font = 'bold 54px serif';
      context.textAlign = 'center';
      context.fillText(`${tile % 9 + 1}`, 90, 100);
      context.fillText(tile < 9 ? '条' : tile < 18 ? '筒' : '万', 90, 180);
    }
    function repaintFaces() {
      for (const [tile, material] of faceCache) {
        paintFace(tile, material.map.image);
        material.map.needsUpdate = true;
      }
    }
    function loadImage(url, accept) {
      const image = new Image();
      image.onload = () => {
        if (lifetime.disposed) return;
        try { accept(image); repaintFaces(); }
        catch { onArtError('部分牌面原图未载入，已显示牌名'); }
      };
      image.onerror = () => { if (!lifetime.disposed) onArtError('部分牌面原图未载入，已显示牌名'); };
      lifetime.add(() => { image.onload = null; image.onerror = null; });
      image.src = url;
    }
    loadImage(MAHJONG_PHOTO_URL, (image) => { photoImage = image; });
    loadImage(MAHJONG_WAN_URL, (image) => { wanAtlas = createWanDisplayAtlas(image, () => document.createElement('canvas')); });
    function tileObject(tile) {
      const group = new THREE.Group();
      const body = new THREE.Mesh(bodyGeometry, cream);
      body.castShadow = true;
      body.receiveShadow = true;
      group.add(body);
      const back = new THREE.Mesh(backGeometry, green);
      back.position.z = -0.125;
      group.add(back);
      if (!tile.hidden && Number.isInteger(tile.tile)) {
        if (!faceCache.has(tile.tile)) {
          const canvas = document.createElement('canvas');
          canvas.width = 180;
          canvas.height = 240;
          paintFace(tile.tile, canvas);
          const texture = ownTexture(new THREE.CanvasTexture(canvas));
          texture.colorSpace = THREE.SRGBColorSpace;
          faceCache.set(tile.tile, ownMaterial(new THREE.MeshStandardMaterial({ map: texture, roughness: 0.46 })));
        }
        const face = new THREE.Mesh(faceGeometry, faceCache.get(tile.tile));
        face.position.z = 0.141;
        group.add(face);
      }
      return group;
    }

    // 角色缓存按真实身份/座位变更重建，不跟每次牌局轮询重载；只有已批准完整原图被使用。
    // Rebuild actors only on identity/seat changes, not every poll; use approved full-source art only.
    function rebuildActors(characterForPlayer) {
      const key = JSON.stringify(model.seats.map((seat) => [seat.seat, seat.rotation, characterForPlayer(seat.seat)?.id]));
      if (key === actorKey) return;
      actorKey = key;
      const generation = ++actorGeneration;
      // 换身份/换桌立即释放旧角色资源，晚到纹理按代次拒收。
      // Release old actor resources on identity/room changes; reject late textures by generation.
      for (const resource of actorResources) {
        resource.dispose();
        geometries.delete(resource);
        materials.delete(resource);
        textures.delete(resource);
      }
      actorResources = new Set();
      actors.clear();
      actorViews = [];
      for (const seat of model.seats) {
        const character = characterForPlayer(seat.seat);
        const group = new THREE.Group();
        group.rotation.y = -seat.rotation * Math.PI / 180;
        actors.add(group);
        const chair = box(7.5, 1.14, 6, 0.3, darkWood);
        chair.position.set(0, -1.77, SEAT_RADIUS);
        group.add(chair);
        actorResources.add(chair.geometry);
        const chairBack = box(7.5, 6, 0.84, 0.3, wood);
        chairBack.position.set(0, 1.2, SEAT_RADIUS + 2.55);
        group.add(chairBack);
        actorResources.add(chairBack.geometry);
        const variants = {};
        actorViews.push({ group, variants });
        for (const name of ['front', 'left', 'right']) {
        const figure = realisticCharacterView(character?.id, name)?.figure;
        if (!figure?.approved || !figure.contentBounds || !figure.seatAnchor) continue;
        const [left, top, width, height] = figure.contentBounds;
        const [anchorX, anchorY] = figure.seatAnchor;
        const [sourceWidth, sourceHeight] = figure.sourceSize;
        const scale = 8.04 / (anchorY - top);
        const geometry = ownGeometry(new THREE.PlaneGeometry(1, 1, 24, 36));
        actorResources.add(geometry);
        const position = geometry.attributes.position;
        const uv = geometry.attributes.uv;
        for (let index = 0; index < position.count; index++) {
          const px = left + uv.getX(index) * width;
          const py = top + (1 - uv.getY(index)) * height;
          const x = (px - anchorX) * scale;
          const lower = THREE.MathUtils.clamp((py - anchorY) / (top + height - anchorY), 0, 1);
          const y = py < anchorY ? -1.2 + (anchorY - py) * scale : -1.2 - lower * 6.15;
          position.setXYZ(index, x, y, 0.33 + 0.39 * Math.exp(-x * x / 5.4) + 0.84 * Math.sin(Math.min(lower * 2, 1) * Math.PI / 2));
          uv.setXY(index, px / sourceWidth, 1 - py / sourceHeight);
        }
        geometry.computeVertexNormals();
        const material = ownMaterial(new THREE.MeshBasicMaterial({ transparent: true, alphaTest: 0.5, side: THREE.FrontSide, toneMapped: false }));
        actorResources.add(material);
        const actor = new THREE.Mesh(geometry, material);
        actor.visible = false;
        actor.position.z = SEAT_RADIUS;
        actor.rotation.y = Math.PI + ({ front: 0, left: -Math.PI / 4, right: Math.PI / 4 }[name]);
        actor.name = `${character.id} · 原画2.5D`;
        group.add(actor);
        variants[name] = actor;
        new THREE.TextureLoader().load(figure.url, (texture) => {
          if (lifetime.disposed || generation !== actorGeneration) { texture.dispose(); return; }
          texture.colorSpace = THREE.SRGBColorSpace;
          material.map = ownTexture(texture);
          actorResources.add(texture);
          material.needsUpdate = true;
          actor.userData.loaded = true;
        }, undefined, () => { if (!lifetime.disposed) onArtError('部分角色原画未载入'); });
        }
      }
    }

    // 三维牌是只读投影，真正选牌/换牌/动作仍走原DOM与服务端白名单。
    // Three tiles are read-only; real tile selection/exchange/actions remain in the original DOM and server allowlist.
    function update(nextModel, characterForPlayer, hasPrivateControls) {
      model = nextModel;
      tileLayer.clear();
      for (const seat of model.seats) {
        const group = new THREE.Group();
        group.rotation.y = -seat.rotation * Math.PI / 180;
        tileLayer.add(group);
        const zones = { hand: seat.hand, discards: seat.discards, melds: seat.melds.flatMap((meld) => meld.tiles), wins: seat.wins, personalRadishes: seat.personalRadishes };
        for (const [zone, tiles] of Object.entries(zones)) {
          if (zone === 'hand' && seat.isSelf && hasPrivateControls) continue;
          const layout = tileGrid(tiles.length, TABLE_ZONES[zone]);
          tiles.forEach((tile, index) => {
            const mesh = tileObject(tile);
            const point = layout[index];
            mesh.scale.setScalar(point.scale);
            const standing = zone === 'hand' && tile.hidden;
            mesh.rotation.x = standing ? 0 : -Math.PI / 2;
            mesh.position.set(point.x, SURFACE_Y + (standing ? 0.345 : 0.14) * point.scale + 0.04, point.z);
            mesh.userData = { seat: seat.seat, zone, index, virtual: tile.virtual === true };
            group.add(mesh);
          });
        }
      }
      tileGrid(model.radishes.length, TABLE_ZONES.radishes).forEach((point, index) => {
        const mesh = tileObject(model.radishes[index]);
        mesh.rotation.x = -Math.PI / 2;
        mesh.scale.setScalar(point.scale);
        mesh.position.set(point.x, SURFACE_Y + 0.14 * point.scale + 0.04, point.z);
        tileLayer.add(mesh);
      });
      rebuildActors(characterForPlayer);
    }

    // 已获得FIFO播放权的公开事件才产生短飞牌；摸牌身份永远隐藏，也不驱动角色肢体。
    // Only public FIFO-owned events produce short flights; draws always conceal identity and never animate actor limbs.
    function present(events) {
      animations = [];
      flightLayer.clear();
      if (reducedMotion || document.hidden || !model) return;
      const allowed = new Set(['draw', 'discard', 'peng', 'mingGang', 'anGang', 'buGang', 'addGang', 'hu']);
      events.filter((event) => allowed.has(event.type)).forEach((event, index) => {
        const seat = model.seats.find((entry) => entry.seat === event.seat);
        if (!seat) return;
        const mesh = tileObject({ tile: event.tile, hidden: event.hidden || event.type === 'draw' });
        mesh.rotation.x = -Math.PI / 2;
        const angle = -seat.rotation * Math.PI / 180;
        const to = new THREE.Vector3(0, SURFACE_Y + 0.25, event.type === 'discard' ? 4 : 7).applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
        const from = event.type === 'discard' ? new THREE.Vector3(0, SURFACE_Y + 0.5, 8).applyAxisAngle(new THREE.Vector3(0, 1, 0), angle) : new THREE.Vector3(0, SURFACE_Y + 0.5, 0);
        mesh.visible = false;
        flightLayer.add(mesh);
        animations.push({ mesh, from, to, at: performance.now() + index * REALISTIC_FLIGHT_STAGGER_MS });
      });
    }

    // 视角只动相机；专注模式保存完整相机状态，退出和Escape精确恢复。
    // Views move only the camera. Focus saves full camera state and restores it on exit/Escape.
    function setView(name) {
      currentView = name;
      const directions = { player: [0, 14, 23], top: [0, 28, 0.1], left: [-23, 12, 0], right: [23, 12, 0], north: [0, 14, -23], orbit: [20, 16, 22], focus: [0, 25, 23] };
      const direction = new THREE.Vector3(...(directions[name] || directions.player)).normalize();
      const target = new THREE.Vector3(0, 0, 0);
      const bounds = focus ? new THREE.Box3(new THREE.Vector3(-9.55, 0, -9.55), new THREE.Vector3(9.55, 2, 9.55)) : new THREE.Box3(new THREE.Vector3(-18, FLOOR_Y, -18), new THREE.Vector3(18, 8, 18));
      const vertical = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      const horizontal = vertical * camera.aspect;
      const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), direction).normalize();
      const up = new THREE.Vector3().crossVectors(direction, right).normalize();
      let distance = 0;
      for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
        const point = new THREE.Vector3(x, y, z);
        distance = Math.max(distance, Math.abs(point.dot(right)) * 1.08 / horizontal + point.dot(direction), Math.abs(point.dot(up)) * 1.1 / vertical + point.dot(direction));
      }
      camera.position.copy(direction.multiplyScalar(distance).add(target));
      controls.target.copy(target);
      controls.autoRotate = name === 'orbit' && !reducedMotion;
      camera.lookAt(target);
      controls.update();
    }
    function setFocus(enabled) {
      if (focus === enabled) return;
      if (enabled) previousView = { name: currentView, position: camera.position.clone(), target: controls.target.clone(), autoRotate: controls.autoRotate };
      focus = enabled;
      room.visible = !enabled;
      controls.enabled = !enabled;
      if (enabled) setView('focus');
      else if (previousView) {
        currentView = previousView.name;
        camera.position.copy(previousView.position);
        controls.target.copy(previousView.target);
        controls.autoRotate = previousView.autoRotate;
        camera.lookAt(controls.target);
        previousView = null;
      }
    }
    function resize() {
      const { width, height } = host.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      setView(currentView);
    }
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    lifetime.add(() => observer.disconnect());
    function contextLost(event) { event.preventDefault(); onFailure?.(); }
    renderer.domElement.addEventListener('webglcontextlost', contextLost);
    lifetime.add(() => renderer.domElement.removeEventListener('webglcontextlost', contextLost));
    let animationFrame;
    let lastTime = performance.now();
    function frame(now) {
      if (lifetime.disposed) return;
      if (!document.hidden) {
        controls.update(Math.min((now - lastTime) / 1000, 0.06));
        // 仅按相机切换原画视角；背面无批准素材就不绘制脸，不镜像、不伪造骨骼。
        // Switch source views only by camera angle; absent rear art draws no face, never mirrored art or invented rigs.
        scene.updateMatrixWorld();
        for (const { group, variants } of actorViews) {
          const localCamera = group.worldToLocal(camera.position.clone());
          const angle = Math.atan2(-localCamera.x, SEAT_RADIUS - localCamera.z);
          const name = Math.abs(angle) > Math.PI * 0.66 ? 'rear' : angle > 0.38 ? 'right' : angle < -0.38 ? 'left' : 'front';
          for (const [variant, actor] of Object.entries(variants)) actor.visible = variant === name && actor.userData.loaded === true;
        }
        animations = animations.filter((animation) => {
          const progress = (now - animation.at) / REALISTIC_FLIGHT_DURATION_MS;
          if (progress < 0) return true;
          if (progress >= 1) { flightLayer.remove(animation.mesh); return false; }
          animation.mesh.visible = true;
          animation.mesh.position.lerpVectors(animation.from, animation.to, progress * progress * (3 - 2 * progress));
          animation.mesh.position.y += Math.sin(progress * Math.PI) * 0.7;
          return true;
        });
        try { renderer.render(scene, camera); }
        catch {
          lifetime.dispose();
          onFailure?.();
          return;
        }
      } else { animations = []; flightLayer.clear(); }
      lastTime = now;
      animationFrame = requestAnimationFrame(frame);
    }
    lifetime.add(() => cancelAnimationFrame(animationFrame));
    resize();
    animationFrame = requestAnimationFrame(frame);
    return { update, present, setView, setFocus, resize,
      setSkin(color) { feltMaterial.color.set(color); },
      setReducedMotion(value) { reducedMotion = value; if (value) { present([]); controls.autoRotate = false; } },
      dispose: () => lifetime.dispose(),
    };
  } catch (error) {
    // 部分初始化失败也释放已分配资源，避免反复切换累积WebGL上下文。
    // Partial setup failures release allocated resources, avoiding context accumulation on repeated switches.
    lifetime.dispose();
    throw error;
  }
}
