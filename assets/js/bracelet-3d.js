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
    this.rotateX = 0;
    this.rotateY = 0;
    this.targetRotateX = 0;
    this.targetRotateY = 0;
    this.isDragging = false;
    this.dragMoved = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.lastPointerX = 0;
    this.lastPointerY = 0;
    this._layout = null;
    this._ready = false;
    this._building = false;

    this._initMaterials();
    this._init();
    this._ready = true;
  }

  _initMaterials() {
    // Keep enough diffuse response for bright silver without an environment map.
    this.silverMat = new THREE.MeshStandardMaterial({
      color: 0xdce1e8,
      metalness: 0.18,
      roughness: 0.42,
    });
    this.silverBezelMat = new THREE.MeshStandardMaterial({
      color: 0xc8ced8,
      metalness: 0.22,
      roughness: 0.36,
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
    this.camera.position.set(0, 0.45, 9);
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
    el.addEventListener('pointercancel', () => { this.isDragging = false; });
    el.addEventListener('click', (e) => this._onClick(e));

    this._resizeObserver = new ResizeObserver(() => this.resize());
    this._resizeObserver.observe(this.container);
    this._animate();
  }

  _ellipsePoint(angle, rx, ry) {
    return {
      x: rx * Math.cos(angle),
      y: ry * Math.sin(angle),
      z: 0.025 * Math.sin(angle * 2),
    };
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

    const n = Math.max(charmIds.length, 1);
    const linkW = 0.82;
    const circumference = Math.max(n * linkW * 0.96, linkW * 2.6);
    const rx = circumference / 5.7;
    const ry = rx * 0.91;

    this._layout = { n, rx, ry, linkW };

    charmIds.forEach((id, i) => {
      const charm = CHARM_MAP[id] || CHARMS[0];
      const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
      const pt = this._ellipsePoint(angle, rx, ry);
      const linkGroup = this._createLink(charm, i, linkW);
      const tangent = Math.atan2(ry * Math.cos(angle), -rx * Math.sin(angle));

      linkGroup.position.set(pt.x, pt.y, pt.z);
      // Keep every charm face toward the viewer and upright so the full design is legible.
      linkGroup.rotation.z = tangent * 0.08;
      linkGroup.userData.baseAngle = angle;
      linkGroup.userData.baseRotationZ = linkGroup.rotation.z;
      linkGroup.userData.baseZ = pt.z;

      this.braceletGroup.add(linkGroup);
      this.linkMeshes.push(linkGroup);
    });

    this.braceletGroup.rotation.set(0.2, 0, 0);
    this.braceletGroup.position.set(0, 0, 0);
    this.braceletGroup.scale.setScalar(1.25);

    const verticalSpan = (ry * 2 + linkW) * 1.25;
    const horizontalSpan = (rx * 2 + linkW) * 1.25;
    const verticalDistance = verticalSpan / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 0.82);
    const horizontalDistance = horizontalSpan / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * this.camera.aspect * 0.82);
    this.camera.position.set(0, 1.7, Math.max(7, verticalDistance, horizontalDistance));
    this.camera.lookAt(0, 0, 0);
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

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(size * 0.98, size * 0.98, depth),
      this.silverMat
    );
    body.name = 'linkBody';
    group.add(body);

    const hookGeo = new THREE.TorusGeometry(0.062, 0.018, 10, 20);
    [-1, 1].forEach((side) => {
      const hook = new THREE.Mesh(hookGeo, this.silverBezelMat);
      hook.rotation.y = Math.PI / 2;
      // Alternate connector planes so neighboring links read as interlocked.
      hook.rotation.z = index % 2 === 0 ? 0 : Math.PI / 2;
      hook.position.set(side * (size / 2 + 0.035), 0, depth * 0.12);
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
    if (e.button !== undefined && e.button !== 0) return;
    this.isDragging = true;
    this.dragMoved = false;
    this.dragStartX = this.lastPointerX = e.clientX;
    this.dragStartY = this.lastPointerY = e.clientY;
    this.renderer.domElement.setPointerCapture?.(e.pointerId);
  }

  _onPointerMove(e) {
    if (!this.isDragging) return;
    const dx = e.clientX - this.lastPointerX;
    const dy = e.clientY - this.lastPointerY;
    if (Math.hypot(e.clientX - this.dragStartX, e.clientY - this.dragStartY) > 5) {
      this.dragMoved = true;
    }
    this.targetRotateY += dx * 0.008;
    this.targetRotateX = THREE.MathUtils.clamp(this.targetRotateX + dy * 0.008, -0.75, 0.75);
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
  }

  _onClick(e) {
    if (this.dragMoved) {
      this.dragMoved = false;
      return;
    }
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

    if (this.autoRotate && !this.isDragging) this.targetRotateY += dt * 0.08;
    this.rotateX += (this.targetRotateX - this.rotateX) * 0.07;
    this.rotateY += (this.targetRotateY - this.rotateY) * 0.07;

    if (this.braceletGroup && this._layout) {
      // Orbit around both axes so the view has real depth, not only a flat spin.
      this.braceletGroup.rotation.x = 0.2 + this.rotateX;
      this.braceletGroup.rotation.y = this.rotateY;

      this.linkMeshes.forEach((mesh, i) => {
        const flex = Math.sin(t * 2.2 + i * 0.6) * 0.012;
        mesh.position.z = mesh.userData.baseZ + flex;

        const charm = CHARM_MAP[this.charmIds[i]];
        const swing = charm?.dangling ? Math.sin(t * 2.5 + i) * 0.06 : 0;
        mesh.rotation.z = mesh.userData.baseRotationZ + swing;
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
