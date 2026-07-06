/**
 * 3D Italian charm bracelet — interlocked links with HD charm textures
 */
class Bracelet3D {
  constructor(container, options = {}) {
    if (typeof THREE === 'undefined') {
      console.error('Three.js failed to load');
      container.innerHTML = '<p class="bracelet-3d-error">3D preview unavailable — please refresh the page.</p>';
      return;
    }

    this.container = container;
    this.onSelect = options.onSelect || (() => {});
    this.autoRotate = options.autoRotate !== false;
    this.linkMeshes = [];
    this.selectedIndex = null;
    this.charmIds = [];
    this.textureCache = new Map();
    this.textureLoader = new THREE.TextureLoader();
    this.rotateY = 0;
    this.targetRotateY = 0;
    this.isDragging = false;
    this.lastPointerX = 0;
    this._layout = null;
    this._ready = false;
    this._building = false;

    this._initMaterials();
    this._init();
    this._ready = true;
  }

  _initMaterials() {
    this.silverMat = new THREE.MeshStandardMaterial({
      color: 0xe4e8ee,
      metalness: 0.88,
      roughness: 0.3,
    });
    this.silverBezelMat = new THREE.MeshStandardMaterial({
      color: 0xc8ced8,
      metalness: 0.9,
      roughness: 0.25,
    });
    this.selectMat = new THREE.MeshBasicMaterial({
      color: 0xc4846a,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
  }

  _init() {
    const w = Math.max(this.container.clientWidth, 320);
    const h = Math.max(this.container.clientHeight, 320);

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(32, w / h, 0.1, 100);
    this.camera.position.set(0, 2.4, 11);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    if (THREE.SRGBColorSpace) this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.35;
    this.renderer.domElement.className = 'bracelet-3d-canvas';
    this.container.appendChild(this.renderer.domElement);

    this.scene.add(new THREE.AmbientLight(0xffffff, 1.05));
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xc8bfb0, 0.55));

    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(5, 10, 8);
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0xf0f4ff, 0.5);
    fill.position.set(-6, 4, 5);
    this.scene.add(fill);

    this.braceletGroup = new THREE.Group();
    this.scene.add(this.braceletGroup);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.clock = new THREE.Clock();

    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => this._onPointerDown(e));
    el.addEventListener('pointermove', (e) => this._onPointerMove(e));
    el.addEventListener('pointerup', () => { this.isDragging = false; });
    el.addEventListener('pointerleave', () => { this.isDragging = false; });
    el.addEventListener('click', (e) => this._onClick(e));

    this._resizeObserver = new ResizeObserver(() => this.resize());
    this._resizeObserver.observe(this.container);
    this._animate();
  }

  _ellipsePoint(angle, rx, rz) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return { x: rx * c, z: rz * s, nx: c / rx, nz: s / rz };
  }

  setBracelet(charmIds) {
    if (!this._ready) return;
    this.charmIds = [...charmIds];
    this._clearGroup(this.braceletGroup);
    this.linkMeshes = [];
    this._building = true;

    const unique = [...new Set(charmIds)];
    Promise.all(unique.map((id) => this._loadTexturePromise(id)))
      .then(() => {
        if (this._building) this._buildBracelet(charmIds);
      })
      .catch(() => {
        if (this._building) this._buildBracelet(charmIds);
      });
  }

  _buildBracelet(charmIds) {
    this._clearGroup(this.braceletGroup);
    this.linkMeshes = [];

    const n = charmIds.length;
    const linkW = 0.82;
    const overlap = 0.96;
    const radius = n <= 1 ? 2.2 : (linkW * overlap) / (2 * Math.sin(Math.PI / n));
    const rx = radius * 1.12;
    const rz = radius * 0.88;

    this._layout = { n, rx, rz };

    charmIds.forEach((id, i) => {
      const charm = CHARM_MAP[id] || CHARMS[0];
      const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
      const pt = this._ellipsePoint(angle, rx, rz);
      const len = Math.hypot(pt.nx, pt.nz) || 1;
      const nx = pt.nx / len;
      const nz = pt.nz / len;

      const linkGroup = this._createLink(charm, i, linkW);
      linkGroup.position.set(pt.x, 0, pt.z);
      linkGroup.lookAt(pt.x + nx * 5, 0, pt.z + nz * 5);
      linkGroup.userData.baseAngle = angle;

      this.braceletGroup.add(linkGroup);
      this.linkMeshes.push(linkGroup);
    });

    this.braceletGroup.rotation.x = 0.22;
    this.braceletGroup.position.y = 0.1;
    this.braceletGroup.scale.setScalar(1.26);
    this.setSelectedIndex(this.selectedIndex);
    this._building = false;
  }

  _loadTexturePromise(charmId) {
    if (this.textureCache.has(charmId)) {
      const cached = this.textureCache.get(charmId);
      if (cached.image?.width) return Promise.resolve(cached);
    }

    return new Promise((resolve) => {
      const url = assetUrl(getCharmImageUrl(charmId));
      const fallback = assetUrl(getCharmImageUrl('blank-silver'));

      const done = (tex) => {
        tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
        if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;
        this.textureCache.set(charmId, tex);
        resolve(tex);
      };

      this.textureLoader.load(url, done, undefined, () => {
        this.textureLoader.load(fallback, done, undefined, () => {
          const blank = new THREE.Texture();
          this.textureCache.set(charmId, blank);
          resolve(blank);
        });
      });
    });
  }

  _clearGroup(group) {
    while (group.children.length) {
      const child = group.children[0];
      group.remove(child);
      child.traverse?.((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material && obj.material.map && !this.textureCache.has(obj.userData?.charmId)) {
          /* keep shared textures */
        }
        if (obj.material
          && obj.material !== this.silverMat
          && obj.material !== this.silverBezelMat
          && obj.material !== this.selectMat
          && !obj.material.map) {
          obj.material.dispose();
        }
      });
    }
  }

  _createSideWall(w, h, d, x, y, z) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this.silverBezelMat);
    m.position.set(x, y, z);
    return m;
  }

  _createLink(charm, index, linkW) {
    const group = new THREE.Group();
    group.userData = { index, charmId: charm.id, type: 'link' };

    const size = charm.dangling ? linkW * 1.06 : linkW;
    const depth = 0.16;
    const tex = this.textureCache.get(charm.id) || this.textureCache.get('blank-silver');

    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(size * 0.94, size * (charm.dangling ? 1.02 : 0.94)),
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        alphaTest: 0.04,
        depthWrite: true,
      })
    );
    face.position.z = depth / 2 + 0.02;
    face.name = 'charmFace';
    group.add(face);

    const back = new THREE.Mesh(
      new THREE.PlaneGeometry(size * 0.9, size * 0.9),
      this.silverMat
    );
    back.position.z = -depth / 2 - 0.01;
    group.add(back);

    const t = 0.035;
    group.add(this._createSideWall(size, t, depth, 0, size / 2, 0));
    group.add(this._createSideWall(size, t, depth, 0, -size / 2, 0));
    group.add(this._createSideWall(t, size, depth, -size / 2, 0, 0));
    group.add(this._createSideWall(t, size, depth, size / 2, 0, 0));

    const hookGeo = new THREE.TorusGeometry(0.042, 0.012, 8, 12, Math.PI * 0.95);
    [-1, 1].forEach((side) => {
      const hook = new THREE.Mesh(hookGeo, this.silverBezelMat);
      hook.rotation.y = Math.PI / 2;
      hook.position.set(side * (size / 2 + 0.03), 0, depth * 0.1);
      group.add(hook);
    });

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(size * 0.5, 0.02, 8, 40),
      this.selectMat
    );
    ring.position.z = depth / 2 + 0.06;
    ring.name = 'selectRing';
    ring.visible = false;
    group.add(ring);

    return group;
  }

  setSelectedIndex(index) {
    this.selectedIndex = index;
    this.linkMeshes.forEach((mesh, i) => {
      const ring = mesh.getObjectByName('selectRing');
      const sel = i === index;
      if (ring) ring.visible = sel;
      mesh.scale.setScalar(sel ? 1.12 : 1);
    });
  }

  _onPointerDown(e) {
    this.isDragging = true;
    this.lastPointerX = e.clientX;
  }

  _onPointerMove(e) {
    if (!this.isDragging) return;
    this.targetRotateY += (e.clientX - this.lastPointerX) * 0.011;
    this.lastPointerX = e.clientX;
  }

  _onClick(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.linkMeshes, true);
    if (!hits.length) return;
    let obj = hits[0].object;
    while (obj.parent && obj.userData.type !== 'link') obj = obj.parent;
    if (obj.userData.type === 'link') {
      const idx = obj.userData.index;
      const next = this.selectedIndex === idx ? null : idx;
      this.setSelectedIndex(next);
      this.onSelect(next);
    }
  }

  resize() {
    if (!this.renderer) return;
    const w = Math.max(this.container.clientWidth, 1);
    const h = Math.max(this.container.clientHeight, 1);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  _animate() {
    requestAnimationFrame(() => this._animate());
    if (!this.renderer) return;
    const dt = this.clock.getDelta();
    const t = performance.now() * 0.001;

    if (this.autoRotate && !this.isDragging) this.targetRotateY += dt * 0.26;
    this.rotateY += (this.targetRotateY - this.rotateY) * 0.07;

    if (this.braceletGroup && this._layout) {
      const { rx, rz } = this._layout;

      this.linkMeshes.forEach((mesh, i) => {
        const angle = mesh.userData.baseAngle + this.rotateY;
        const pt = this._ellipsePoint(angle, rx, rz);
        const len = Math.hypot(pt.nx, pt.nz) || 1;
        const nx = pt.nx / len;
        const nz = pt.nz / len;
        const flex = Math.sin(t * 2.2 + i * 0.6) * 0.02;

        mesh.position.set(pt.x + nx * flex, flex * 0.3, pt.z + nz * flex);
        mesh.lookAt(pt.x + nx * 5, flex * 0.3, pt.z + nz * 5);

        const charm = CHARM_MAP[this.charmIds[i]];
        if (charm?.dangling) {
          mesh.rotation.z = Math.sin(t * 2.5 + i) * 0.06;
        } else {
          mesh.rotation.z = 0;
        }
      });
    }

    this.renderer.render(this.scene, this.camera);
  }

  destroy() {
    this._building = false;
    this._resizeObserver?.disconnect();
    this.textureCache.forEach((tex) => tex.dispose());
    this.textureCache.clear();
    this.silverMat?.dispose();
    this.silverBezelMat?.dispose();
    this.selectMat?.dispose();
    this.renderer?.dispose();
    this.container.innerHTML = '';
  }
}

window.Bracelet3D = Bracelet3D;
