/**
 * 3D Italian charm bracelet viewer (Three.js r159, core build only).
 *
 * Design notes
 * - The model is centred on the bracelet, so every rotation pivots on the wrist.
 *   (The old viewer spun the whole hand around the middle of the forearm, which
 *   swung the fingers into the camera and warped them into a cone.)
 * - Drag left/right = turn the arm, drag up/down = roll the wrist around its own
 *   axis so every side of the bracelet can be inspected.
 * - Double-click / double-tap a link to fly in on it; double-click empty space
 *   (or press R / the reset button) to return.
 * - Silver is lit by a procedural studio environment, link bodies are bevelled,
 *   charm photos are drawn un-tonemapped so they keep their true colours.
 */
const B3D = {
  TAU: Math.PI * 2,
  LINK_W: 0.42,          // 9 mm link at the model's scale
  WRIST: { y: 1.30, z: 0.95 },
  PATH: { y: 1.40, z: 1.05 },
  FOV: 22,               // narrow lens: far less perspective distortion
  BASE_YAW: 0.38,       // three-quarter view by default
  ELEVATION: 0.2,
  MAX_YAW: 0.9,
  SHIFT_X: 0.35,         // links sit at x = -0.35; shift so the bracelet is at the origin
};

class Bracelet3D {
  static isSupported() {
    try {
      if (typeof THREE === 'undefined') return false;
      const c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
    } catch (e) {
      return false;
    }
  }

  constructor(container, options = {}) {
    this.ready = false;
    this._ready = false;
    this.container = container;
    this.onSelect = options.onSelect || (() => {});
    this.autoRotate = options.autoRotate !== false;

    if (!Bracelet3D.isSupported()) {
      container.innerHTML = '<p class="bracelet-3d-error">3D preview unavailable on this device.</p>';
      return;
    }

    this.linkMeshes = [];
    this.charmIds = [];
    this.selectedIndex = null;
    this.hoverIndex = -1;
    this.textureCache = new Map();
    this.faceMats = new Map();
    this.geoCache = new Map();
    this.textureLoader = new THREE.TextureLoader();

    // View state. "current" values chase "target" values with damping.
    this.yaw = 0; this.tYaw = 0;
    this.roll = 0; this.tRoll = 0;
    this.dist = 12; this.tDist = 12;
    this.vYaw = 0; this.vRoll = 0;        // drag inertia
    this._idle = 0;
    this._lastInteraction = -1e9;
    this._userZoomed = false;
    this._minDist = 4.5;
    this._maxDist = 34;

    this.isDragging = false;
    this.dragMoved = false;
    this.activePointers = new Map();
    this.pinchDistance = null;
    this._lastClickIdx = -2;
    this._lastClickTime = 0;
    this._buildToken = 0;
    this._visible = true;
    this._layout = null;

    try {
      this._initRenderer();
      this._initMaterials();
      this._initScene();
      this._createHand();
      this._initControls();
      this._bindEvents();
    } catch (err) {
      console.error('3D preview failed to start', err);
      this.destroy();
      container.innerHTML = '<p class="bracelet-3d-error">3D preview unavailable on this device.</p>';
      return;
    }

    this.ready = true;
    this._ready = true;
    this._animate = this._animate.bind(this);
    this._raf = requestAnimationFrame(this._animate);
  }

  /* ------------------------------------------------------------------ setup */

  _initRenderer() {
    const w = Math.max(this.container.clientWidth, 320);
    const h = Math.max(this.container.clientHeight, 320);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const el = this.renderer.domElement;
    el.className = 'bracelet-3d-canvas';
    el.tabIndex = 0;
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', '3D bracelet preview. Drag to turn, scroll to zoom, double-click a link to focus on it. Arrow keys select links.');
    this.container.appendChild(el);
    if (getComputedStyle(this.container).position === 'static') this.container.style.position = 'relative';
  }

  _initMaterials() {
    this.silverMat = new THREE.MeshStandardMaterial({ color: 0xdde1e8, metalness: 0.9, roughness: 0.3, envMapIntensity: 1.0 });
    this.silverBezelMat = new THREE.MeshStandardMaterial({ color: 0xbfc5ce, metalness: 0.95, roughness: 0.24, envMapIntensity: 0.9 });
    this.skinMat = new THREE.MeshStandardMaterial({ color: 0xc99578, roughness: 0.78, metalness: 0, envMapIntensity: 0.35 });
    this.nailMat = new THREE.MeshStandardMaterial({ color: 0xe8c9b9, roughness: 0.46, metalness: 0, envMapIntensity: 0.5 });
    this.haloMat = new THREE.MeshBasicMaterial({
      color: 0xc4846a, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, toneMapped: false,
    });
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(B3D.FOV, 1, 0.1, 120);

    this._buildEnvironment();

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xc8bfb0, 0.35));

    const key = new THREE.DirectionalLight(0xffffff, 1.0);
    key.position.set(5, 10, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    const sc = key.shadow.camera;
    sc.left = -5; sc.right = 5; sc.top = 5; sc.bottom = -5; sc.near = 2; sc.far = 32;
    key.shadow.bias = -0.0005;
    key.shadow.normalBias = 0.03;
    key.shadow.radius = 4;
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0xf0f4ff, 0.45);
    fill.position.set(-6, 4, 5);
    this.scene.add(fill);

    const rim = new THREE.DirectionalLight(0xffe9dc, 0.55);
    rim.position.set(-4, 3, -7);
    this.scene.add(rim);

    // rig (turns the arm) -> rollPivot (rolls the wrist) -> content (centres the bracelet)
    this.rig = new THREE.Group();
    this.rollPivot = new THREE.Group();
    this.content = new THREE.Group();
    this.content.position.x = B3D.SHIFT_X;
    this.handGroup = new THREE.Group();
    this.linksGroup = new THREE.Group();
    this.content.add(this.handGroup, this.linksGroup);
    this.rollPivot.add(this.content);
    this.rig.add(this.rollPivot);
    this.scene.add(this.rig);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.clock = new THREE.Clock();
  }

  /** Procedural studio lighting so the silver has something to reflect. */
  _buildEnvironment() {
    try {
      const envScene = new THREE.Scene();

      const domeGeo = new THREE.SphereGeometry(30, 32, 16);
      const pos = domeGeo.attributes.position;
      const colors = new Float32Array(pos.count * 3);
      const top = new THREE.Color(0xfffaf3);
      const mid = new THREE.Color(0xd6cec3);
      const bot = new THREE.Color(0x6f655c);
      const tmp = new THREE.Color();
      for (let i = 0; i < pos.count; i++) {
        const t = pos.getY(i) / 30;
        if (t >= 0) tmp.copy(mid).lerp(top, Math.pow(t, 0.7));
        else tmp.copy(mid).lerp(bot, Math.pow(-t, 0.8));
        colors.set([tmp.r, tmp.g, tmp.b], i * 3);
      }
      domeGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      envScene.add(new THREE.Mesh(domeGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));

      const panel = (w, h, p, intensity) => {
        const m = new THREE.Mesh(
          new THREE.PlaneGeometry(w, h),
          new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1).multiplyScalar(intensity), side: THREE.DoubleSide })
        );
        m.position.set(p[0], p[1], p[2]);
        m.lookAt(0, 0, 0);
        envScene.add(m);
      };
      panel(18, 7, [0, 16, 7], 6);      // overhead softbox
      panel(5, 16, [-15, 2, 5], 4);     // left strip
      panel(5, 16, [15, 3, 1], 3);      // right strip
      panel(16, 3, [0, -5, 13], 1.1);   // low warm bounce

      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const rt = pmrem.fromScene(envScene, 0.02);
      this.envTarget = rt;
      this.scene.environment = rt.texture;
      pmrem.dispose();
      envScene.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
    } catch (err) {
      console.warn('Environment lighting unavailable; using plain lights', err);
      this.scene.add(new THREE.AmbientLight(0xffffff, 0.9));
      this.silverMat.metalness = 0.25; this.silverMat.roughness = 0.4;
      this.silverBezelMat.metalness = 0.3; this.silverBezelMat.roughness = 0.35;
    }
  }

  /* ----------------------------------------------------------- wrist + hand */

  _createHand() {
    const { y: wristY, z: wristZ } = B3D.WRIST;
    const skin = this.skinMat;
    const nail = this.nailMat;

    // Softly tapered forearm, palm and fingers: a sizing reference, not a scan of anyone's hand.
    const sections = [
      [-4.75, 0.55, 0.38], [-4.55, 1.05, 0.72], [-4.2, 1.36, 0.92], [-3.2, 1.34, 0.91],
      [-2.3, 1.28, 0.89], [-1.4, 1.26, 0.90], [-0.7, wristY, wristZ], [0.0, 1.32, 0.96],
      [0.55, 1.42, 0.94], [1.0, 1.44, 0.82], [1.35, 1.34, 0.68],
    ];
    const around = 48;
    const vertices = [];
    const indices = [];
    sections.forEach(([x, ry, rz]) => {
      for (let j = 0; j < around; j++) {
        const a = (j / around) * B3D.TAU;
        vertices.push(x, ry * Math.cos(a), rz * Math.sin(a));
      }
    });
    for (let i = 0; i < sections.length - 1; i++) {
      for (let j = 0; j < around; j++) {
        const a = i * around + j;
        const b = i * around + ((j + 1) % around);
        const c = (i + 1) * around + ((j + 1) % around);
        const d = (i + 1) * around + j;
        indices.push(a, b, c, a, c, d);
      }
    }
    const armGeo = new THREE.BufferGeometry();
    armGeo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    armGeo.setIndex(indices);
    armGeo.computeVertexNormals();
    const arm = new THREE.Mesh(armGeo, skin);
    arm.receiveShadow = true;
    this.handGroup.add(arm);

    // Close the open end of the forearm so it never looks hollow when turned.
    const capGeo = new THREE.CircleGeometry(1, around);
    capGeo.rotateY(-Math.PI / 2);
    const cap = new THREE.Mesh(capGeo, skin);
    cap.position.x = sections[0][0];
    cap.scale.set(1, sections[0][1], sections[0][2]);
    this.handGroup.add(cap);

    const sphere = new THREE.SphereGeometry(1, 28, 20);
    const ellipsoid = (p, s, mat, rz = 0) => {
      const m = new THREE.Mesh(sphere, mat);
      m.position.set(p[0], p[1], p[2]);
      m.scale.set(s[0], s[1], s[2]);
      m.rotation.z = rz;
      m.receiveShadow = true;
      this.handGroup.add(m);
      return m;
    };

    ellipsoid([2.00, 0, 0.08], [1.50, 1.22, 0.48], skin, -0.04);
    [
      { y: -0.98, end: 6.45, width: 0.35, tilt: -0.035 },
      { y: -0.33, end: 7.08, width: 0.37, tilt: -0.015 },
      { y: 0.34, end: 7.00, width: 0.37, tilt: 0.015 },
      { y: 0.98, end: 6.48, width: 0.35, tilt: 0.045 },
    ].forEach((f) => {
      const startX = 2.55;
      const length = f.end - startX;
      ellipsoid([startX + length * 0.52, f.y, 0.08], [length * 0.58, f.width, 0.15], skin, f.tilt);
      ellipsoid([startX + length * 0.38, f.y, 0.20], [0.28, f.width * 0.76, 0.07], skin);
      ellipsoid([f.end - 0.17, f.y, 0.215], [0.22, f.width * 0.48, 0.035], nail, f.tilt);
    });
    ellipsoid([1.48, -1.08, 0.08], [0.75, 0.36, 0.17], skin, -0.62);
    ellipsoid([1.92, -1.48, 0.12], [0.63, 0.31, 0.16], skin, -0.58);
    ellipsoid([2.38, -1.79, 0.19], [0.24, 0.18, 0.045], nail, -0.55);
  }

  /* ---------------------------------------------------------------- bracelet */

  setBracelet(charmIds) {
    if (!this._ready) return;
    this.charmIds = [...charmIds];
    const token = ++this._buildToken;
    const unique = [...new Set(charmIds)];
    const missing = unique.filter((id) => !this._hasTexture(id));
    if (!missing.length) {
      this._buildBracelet(this.charmIds);
      return;
    }
    // Keep showing the previous design until the new photos are ready (no blank flash).
    Promise.all(missing.map((id) => this._loadTexturePromise(id)))
      .catch(() => {})
      .then(() => { if (token === this._buildToken) this._buildBracelet(this.charmIds); });
  }

  _hasTexture(id) {
    const t = this.textureCache.get(id);
    return !!(t && t.image && t.image.width);
  }

  _loadTexturePromise(charmId) {
    return new Promise((resolve) => {
      const url = assetUrl(getCharmImageUrl(charmId));
      const fallback = assetUrl(getCharmImageUrl('blank-silver'));
      const done = (tex) => {
        tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;
        this.textureCache.set(charmId, tex);
        this.faceMats.delete(charmId);
        resolve(tex);
      };
      this.textureLoader.load(url, done, undefined, () => {
        this.textureLoader.load(fallback, done, undefined, () => {
          this.textureCache.set(charmId, new THREE.Texture());
          resolve(null);
        });
      });
    });
  }

  _faceMat(charmId) {
    let m = this.faceMats.get(charmId);
    if (!m) {
      const tex = this.textureCache.get(charmId) || this.textureCache.get('blank-silver') || null;
      // toneMapped:false keeps the product photography's real colours.
      m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.04, toneMapped: false });
      this.faceMats.set(charmId, m);
    }
    return m;
  }

  _cached(key, make) {
    let g = this.geoCache.get(key);
    if (!g) { g = make(); this.geoCache.set(key, g); }
    return g;
  }

  _roundedRect(w, h, r, path) {
    const s = path || new THREE.Shape();
    const x = -w / 2; const y = -h / 2;
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y);
    s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r);
    s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h);
    s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r);
    s.quadraticCurveTo(x, y, x + r, y);
    return s;
  }

  _bodyGeo(size, depth, bevel) {
    return this._cached(`body:${size}:${depth}:${bevel}`, () => {
      const inner = size * 0.98 - bevel * 2;
      const g = new THREE.ExtrudeGeometry(this._roundedRect(inner, inner, 0.035), {
        depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 6,
      });
      g.translate(0, 0, -depth / 2);
      return g;
    });
  }

  _faceGeo(size, dangling) {
    return this._cached(`face:${size}:${dangling}`, () =>
      new THREE.PlaneGeometry(size * 0.94, size * (dangling ? 1.02 : 0.94)));
  }

  _haloGeo(size) {
    return this._cached(`halo:${size}`, () => {
      const outer = this._roundedRect(size * 1.2, size * 1.2, 0.07);
      outer.holes.push(this._roundedRect(size * 1.04, size * 1.04, 0.05, new THREE.Path()));
      return new THREE.ShapeGeometry(outer, 8);
    });
  }

  _pinGeo(size) {
    return this._cached(`pin:${size}`, () => {
      const g = new THREE.CylinderGeometry(0.03, 0.03, size * 0.86, 12);
      g.rotateZ(Math.PI / 2); // axis along the arm
      return g;
    });
  }

  _createLink(charm, index, linkW) {
    const group = new THREE.Group();
    group.userData = { index, charmId: charm.id, type: 'link', lift: 0, hover: 0, sel: 0, normal: new THREE.Vector3(0, 0, 1) };

    const size = charm.dangling ? linkW * 1.06 : linkW;
    const depth = 0.14;
    const bevel = 0.025;
    const front = depth / 2 + bevel;

    const body = new THREE.Mesh(this._bodyGeo(size, depth, bevel), this.silverMat);
    body.castShadow = true;
    body.name = 'linkBody';
    group.add(body);

    const face = new THREE.Mesh(this._faceGeo(size, !!charm.dangling), this._faceMat(charm.id));
    face.position.z = front + 0.003;
    face.name = 'charmFace';
    group.add(face);

    // Hinge pins join neighbouring links; each link owns the one on its +y side.
    const pinSides = index === 0 ? [-1, 1] : [1];
    pinSides.forEach((side) => {
      const pin = new THREE.Mesh(this._pinGeo(size), this.silverBezelMat);
      pin.position.set(0, side * size / 2, -0.005);
      pin.castShadow = true;
      group.add(pin);
    });

    const halo = new THREE.Mesh(this._haloGeo(size), this.haloMat);
    halo.position.z = front + 0.012;
    halo.renderOrder = 10;
    halo.visible = false;
    halo.name = 'selectRing';
    halo.raycast = () => {};
    group.add(halo);

    return group;
  }

  _clearLinks() {
    while (this.linksGroup.children.length) this.linksGroup.remove(this.linksGroup.children[0]);
    this.linkMeshes = [];
    // Geometry and materials are cached and shared, so there is nothing to dispose per link.
  }

  _buildBracelet(charmIds) {
    this._clearLinks();

    const linkW = B3D.LINK_W;
    const { y: pathY0, z: pathZ0 } = B3D.PATH;
    const circumference = (a, b) => Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
    const fullLinkCount = Math.max(1, Math.round(circumference(pathY0, pathZ0) / linkW));
    this.container.dataset.minimumLinks = String(fullLinkCount);

    const n = Math.max(charmIds.length, 1);
    // A design with more links than the wrist needs becomes a looser, larger loop
    // instead of links overlapping each other.
    const loose = Math.max(1, n / fullLinkCount);
    const pathY = pathY0 * loose;
    const pathZ = pathZ0 * loose;
    const angleStep = B3D.TAU / Math.max(n, fullLinkCount);
    const visibleArc = Math.min(angleStep * n, B3D.TAU);
    const startAngle = -visibleArc / 2 + angleStep / 2;

    this._layout = { n, linkW, fullLinkCount };

    charmIds.forEach((id, i) => {
      const charm = (typeof CHARM_MAP !== 'undefined' && CHARM_MAP[id]) || CHARMS[0];
      const angle = startAngle + angleStep * i;
      const y = pathY * Math.sin(angle);
      const z = pathZ * Math.cos(angle);
      const tangent = new THREE.Vector3(0, pathY * Math.cos(angle), -pathZ * Math.sin(angle)).normalize();
      const normal = new THREE.Vector3(0, Math.sin(angle) / pathY, Math.cos(angle) / pathZ).normalize();
      const link = this._createLink(charm, i, linkW);

      link.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), tangent, normal));
      link.position.set(-B3D.SHIFT_X, y, z);
      Object.assign(link.userData, {
        basePosition: link.position.clone(),
        baseQuaternion: link.quaternion.clone(),
        baseAngle: angle,
        normal,
        dangling: !!charm.dangling,
        phase: i * 1.7,
      });
      this.linksGroup.add(link);
      this.linkMeshes.push(link);
    });

    if (this.selectedIndex !== null && this.selectedIndex >= this.linkMeshes.length) this.selectedIndex = null;
    this.hoverIndex = -1;
    this._fitView(false);
    this.setSelectedIndex(this.selectedIndex);
  }

  /* -------------------------------------------------------------- selection */

  setSelectedIndex(index, opts = {}) {
    this.selectedIndex = index;
    this.linkMeshes.forEach((m, i) => {
      const halo = m.getObjectByName('selectRing');
      if (halo) halo.visible = i === index;
    });
    if (index !== null && opts.reveal !== false) this._revealLink(index, false);
  }

  /** If the link is on the far side of the wrist, roll the arm so it faces the camera. */
  _revealLink(index, force) {
    const m = this.linkMeshes[index];
    if (!m) return;
    const a = m.userData.baseAngle - this.tRoll;
    if (force || Math.cos(a) < 0.3) {
      this.tRoll += this._wrapPi(m.userData.baseAngle - this.tRoll);
      this.vRoll = 0;
    }
  }

  _wrapPi(x) { return x - B3D.TAU * Math.round(x / B3D.TAU); }

  focusLink(index) {
    const m = this.linkMeshes[index];
    if (!m) return;
    this._lastInteraction = performance.now();
    this._revealLink(index, true);
    this.tYaw = -B3D.BASE_YAW * 0.85;
    this.tDist = THREE.MathUtils.clamp(this._fitDistance() * 0.42, this._minDist, this._maxDist);
    this._userZoomed = true;
    this.vYaw = 0;
  }

  resetView() {
    this._lastInteraction = performance.now();
    // Drop whole turns so the wrist takes the short way back, not a long unwind.
    this.roll = this._wrapPi(this.roll);
    this.tRoll = 0;
    this.tYaw = 0;
    this.vYaw = 0; this.vRoll = 0;
    this._userZoomed = false;
    this.tDist = this._fitDistance();
  }

  /* ------------------------------------------------------------------ view */

  _fitDistance() {
    const half = Math.tan(THREE.MathUtils.degToRad(B3D.FOV / 2));
    const aspect = this.camera.aspect || 1;
    // Arm length shown across the frame: tighter on narrow (phone) screens so the links stay readable.
    const spanH = aspect < 1.3 ? 4.6 : aspect < 1.9 ? 6.6 : 8.6;
    const spanV = 5.5;   // wrist diameter plus breathing room
    return Math.max(spanH / (2 * half * aspect), spanV / (2 * half));
  }

  _fitView(snap) {
    if (this._userZoomed) return;
    this.tDist = this._fitDistance();
    if (snap) this.dist = this.tDist;
  }

  resize() {
    if (!this.renderer) return;
    const w = Math.max(this.container.clientWidth, 1);
    const h = Math.max(this.container.clientHeight, 1);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    const first = !this._sized;
    this._sized = true;
    this._fitView(first);
  }

  /* ------------------------------------------------------------ interaction */

  _initControls() {
    const wrap = document.createElement('div');
    wrap.className = 'b3d-tools';
    const icons = {
      reset: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>',
      motion: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/></svg>',
      snap: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
    };
    const mk = (cls, label, svg, fn) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'b3d-tool ' + cls;
      b.title = label;
      b.setAttribute('aria-label', label);
      b.innerHTML = svg;
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(b); });
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      wrap.appendChild(b);
      return b;
    };
    mk('b3d-reset', 'Reset view', icons.reset, () => this.resetView());
    this.motionBtn = mk('b3d-motion', 'Gentle motion on/off', icons.motion, (b) => {
      this.autoRotate = !this.autoRotate;
      b.setAttribute('aria-pressed', String(this.autoRotate));
    });
    this.motionBtn.setAttribute('aria-pressed', String(this.autoRotate));
    mk('b3d-snap', 'Save a picture of this view', icons.snap, () => this.snapshot());
    this.container.appendChild(wrap);
    this.toolsEl = wrap;

    const hint = document.createElement('div');
    hint.className = 'b3d-hint';
    hint.textContent = 'Drag to turn · scroll to zoom · double-click a link';
    this.container.appendChild(hint);
    this.hintEl = hint;
  }

  _bindEvents() {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => this._onPointerDown(e));
    el.addEventListener('pointermove', (e) => this._onPointerMove(e));
    el.addEventListener('pointerup', (e) => this._onPointerUp(e));
    el.addEventListener('pointercancel', (e) => this._onPointerUp(e));
    el.addEventListener('pointerleave', () => this._setHover(-1));
    el.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
    el.addEventListener('click', (e) => this._onClick(e));
    el.addEventListener('keydown', (e) => this._onKey(e));
    el.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this._ctxLost = true; });
    el.addEventListener('webglcontextrestored', () => {
      this._ctxLost = false;
      this._buildEnvironment();
      this.setBracelet(this.charmIds);
    });

    this._resizeObserver = new ResizeObserver(() => this.resize());
    this._resizeObserver.observe(this.container);
    if ('IntersectionObserver' in window) {
      this._io = new IntersectionObserver((entries) => { this._visible = entries[entries.length - 1].isIntersecting; });
      this._io.observe(this.container);
    }
    this.resize();
  }

  _touch() {
    this._lastInteraction = performance.now();
    if (this.hintEl && !this._hintHidden) {
      this._hintHidden = true;
      this.hintEl.classList.add('is-hidden');
    }
  }

  _onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    this._touch();
    this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.renderer.domElement.setPointerCapture?.(e.pointerId);
    this.vYaw = 0; this.vRoll = 0;
    if (this.activePointers.size >= 2) {
      this.isDragging = false;
      this.pinchDistance = this._getPinchDistance();
      this.dragMoved = true;
      return;
    }
    this.isDragging = true;
    this.dragMoved = false;
    this.dragStartX = this.lastX = e.clientX;
    this.dragStartY = this.lastY = e.clientY;
    this.renderer.domElement.classList.add('is-dragging');
  }

  _onPointerMove(e) {
    if (this.activePointers.has(e.pointerId)) {
      this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    if (this.activePointers.size >= 2) {
      const d = this._getPinchDistance();
      if (this.pinchDistance && d > 0) this._zoom(this.pinchDistance / d);
      this.pinchDistance = d;
      this.dragMoved = true;
      this._touch();
      return;
    }
    if (!this.isDragging) {
      if (e.pointerType === 'mouse') this._hoverAt(e);
      return;
    }
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    if (Math.hypot(e.clientX - this.dragStartX, e.clientY - this.dragStartY) > 5) this.dragMoved = true;
    if (this.dragMoved) {
      const dyaw = dx * 0.006;
      const droll = dy * 0.0065;
      this.tYaw = THREE.MathUtils.clamp(this.tYaw + dyaw, -B3D.MAX_YAW - B3D.BASE_YAW, B3D.MAX_YAW - B3D.BASE_YAW);
      this.tRoll += droll;
      this.vYaw = dyaw; this.vRoll = droll;
      this._touch();
    }
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  }

  _onPointerUp(e) {
    this.activePointers.delete(e.pointerId);
    this.isDragging = false;
    this.renderer.domElement.classList.remove('is-dragging');
    if (this.activePointers.size < 2) this.pinchDistance = null;
  }

  _getPinchDistance() {
    const p = [...this.activePointers.values()];
    return p.length < 2 ? 0 : Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
  }

  _onWheel(e) {
    e.preventDefault();
    this._touch();
    this._zoom(Math.exp(e.deltaY * 0.0012));
  }

  _zoom(factor) {
    this._userZoomed = true;
    this.tDist = THREE.MathUtils.clamp(this.tDist * factor, this._minDist, Math.max(this._maxDist, this._fitDistance() * 1.6));
  }

  _pick(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.linkMeshes, true);
    if (!hits.length) return -1;
    let obj = hits[0].object;
    while (obj.parent && obj.userData.type !== 'link') obj = obj.parent;
    return obj.userData.type === 'link' ? obj.userData.index : -1;
  }

  _hoverAt(e) {
    if (this._hoverQueued) return;
    this._hoverQueued = true;
    requestAnimationFrame(() => {
      this._hoverQueued = false;
      if (!this.renderer) return;
      this._setHover(this._pick(e));
    });
  }

  _setHover(i) {
    if (i === this.hoverIndex) return;
    this.hoverIndex = i;
    this.renderer.domElement.style.cursor = i >= 0 ? 'pointer' : '';
  }

  _onClick(e) {
    if (this.dragMoved) { this.dragMoved = false; return; }
    this._touch();
    const idx = this._pick(e);
    const now = performance.now();
    const isDouble = now - this._lastClickTime < 340 && idx === this._lastClickIdx;
    this._lastClickIdx = idx;
    this._lastClickTime = now;

    if (isDouble) {
      this._lastClickTime = 0;
      if (idx < 0) { this.resetView(); return; }
      if (this.selectedIndex !== idx) { this.setSelectedIndex(idx, { reveal: false }); this.onSelect(idx); }
      this.focusLink(idx);
      return;
    }
    if (idx < 0) return;
    const next = this.selectedIndex === idx ? null : idx;
    this.setSelectedIndex(next, { reveal: false });
    this.onSelect(next);
  }

  _onKey(e) {
    const n = this.linkMeshes.length;
    if (!n) return;
    const go = (i) => { this.setSelectedIndex(i); this.onSelect(i); this._touch(); e.preventDefault(); };
    switch (e.key) {
      case 'ArrowRight': case 'ArrowDown': go(this.selectedIndex === null ? 0 : (this.selectedIndex + 1) % n); break;
      case 'ArrowLeft': case 'ArrowUp': go(this.selectedIndex === null ? n - 1 : (this.selectedIndex - 1 + n) % n); break;
      case 'Escape': this.setSelectedIndex(null); this.onSelect(null); e.preventDefault(); break;
      case 'r': case 'R': case 'Home': this.resetView(); e.preventDefault(); break;
      case 'Enter': if (this.selectedIndex !== null) { this.focusLink(this.selectedIndex); e.preventDefault(); } break;
      case '+': case '=': this._zoom(0.85); e.preventDefault(); break;
      case '-': this._zoom(1.18); e.preventDefault(); break;
      default:
    }
  }

  /** Save the current view as a PNG on the page's warm background. */
  snapshot() {
    if (!this.renderer) return;
    this._render();
    const src = this.renderer.domElement;
    const c = document.createElement('canvas');
    c.width = src.width; c.height = src.height;
    const g = c.getContext('2d');
    g.fillStyle = '#ede8e0';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(src, 0, 0);
    c.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'kasyas-bracelet.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }, 'image/png');
  }

  /* ------------------------------------------------------------------ frame */

  _render() {
    this.renderer.render(this.scene, this.camera);
  }

  _animate() {
    this._raf = requestAnimationFrame(this._animate);
    if (!this.renderer || this._ctxLost) return;
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (!this._visible || document.hidden) return;
    const now = performance.now();
    const t = now * 0.001;

    // Drag inertia
    if (!this.isDragging && (Math.abs(this.vYaw) > 1e-4 || Math.abs(this.vRoll) > 1e-4)) {
      this.tYaw = THREE.MathUtils.clamp(this.tYaw + this.vYaw, -B3D.MAX_YAW - B3D.BASE_YAW, B3D.MAX_YAW - B3D.BASE_YAW);
      this.tRoll += this.vRoll;
      const decay = Math.exp(-dt * 4);
      this.vYaw *= decay; this.vRoll *= decay;
    }

    // Damped approach to the target view
    const k = 1 - Math.exp(-dt * 9);
    this.yaw += (this.tYaw - this.yaw) * k;
    this.roll += (this.tRoll - this.roll) * k;
    this.dist += (this.tDist - this.dist) * (1 - Math.exp(-dt * 7));

    // Gentle idle sway: pauses while you interact or have a link selected.
    const idleOn = this.autoRotate && !this.isDragging && this.selectedIndex === null && (now - this._lastInteraction > 2500);
    this._idle += ((idleOn ? 1 : 0) - this._idle) * (1 - Math.exp(-dt * 1.6));
    const idleYaw = Math.sin(t * 0.45) * 0.3 * this._idle;
    const idleRoll = Math.sin(t * 0.31 + 1.2) * 0.2 * this._idle;

    this.rig.rotation.y = THREE.MathUtils.clamp(B3D.BASE_YAW + this.yaw + idleYaw, -B3D.MAX_YAW, B3D.MAX_YAW);
    this.rollPivot.rotation.x = this.roll + idleRoll;

    const el = B3D.ELEVATION;
    this.camera.position.set(0, this.dist * Math.sin(el), this.dist * Math.cos(el));
    this.camera.lookAt(0, 0, 0);

    // Per-link lift / hover / selection / dangle swing
    const pulse = 0.78 + 0.22 * Math.sin(t * 4);
    this.haloMat.opacity = pulse;
    const kl = 1 - Math.exp(-dt * 14);
    const q = this._q || (this._q = new THREE.Quaternion());
    const axisZ = this._axisZ || (this._axisZ = new THREE.Vector3(0, 0, 1));
    for (let i = 0; i < this.linkMeshes.length; i++) {
      const m = this.linkMeshes[i];
      const u = m.userData;
      const selT = i === this.selectedIndex ? 1 : 0;
      const hovT = i === this.hoverIndex ? 1 : 0;
      u.sel += (selT - u.sel) * kl;
      u.hover += (hovT - u.hover) * kl;
      const lift = u.sel * 0.14 + u.hover * 0.05;
      m.position.copy(u.basePosition).addScaledVector(u.normal, lift);
      m.scale.setScalar(1 + u.sel * 0.08 + u.hover * 0.03);
      m.quaternion.copy(u.baseQuaternion);
      if (u.dangling) {
        q.setFromAxisAngle(axisZ, Math.sin(t * 2.5 + u.phase) * 0.035);
        m.quaternion.multiply(q);
      }
    }

    this._render();
  }

  destroy() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    this._resizeObserver?.disconnect();
    this._io?.disconnect();
    this._buildToken++;
    this.textureCache?.forEach((tex) => tex.dispose());
    this.textureCache?.clear();
    this.geoCache?.forEach((g) => g.dispose());
    this.faceMats?.forEach((m) => m.dispose());
    [this.silverMat, this.silverBezelMat, this.skinMat, this.nailMat, this.haloMat].forEach((m) => m?.dispose());
    this.envTarget?.dispose();
    this.handGroup?.traverse((o) => o.geometry?.dispose?.());
    this.renderer?.dispose();
    this.renderer = null;
    this._ready = false;
    this.ready = false;
    this.container.innerHTML = '';
  }
}

window.Bracelet3D = Bracelet3D;
