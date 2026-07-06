/**
 * 3D Italian charm bracelet — interlocked modular links (Nomination-style)
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
    this.textureLoader.setCrossOrigin('anonymous');
    this.rotateY = 0;
    this.targetRotateY = 0;
    this.isDragging = false;
    this.lastPointerX = 0;
    this._layout = null;
    this._ready = false;

    this._initMaterials();
    this._init();
    this._ready = true;
  }

  _initMaterials() {
    this.silverMat = new THREE.MeshStandardMaterial({
      color: 0xd4dae2,
      metalness: 0.92,
      roughness: 0.22,
    });
    this.silverBezelMat = new THREE.MeshStandardMaterial({
      color: 0xa8b0bc,
      metalness: 0.95,
      roughness: 0.18,
    });
    this.selectMat = new THREE.MeshBasicMaterial({
      color: 0xc4846a,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
    });
  }

  _init() {
    const w = Math.max(this.container.clientWidth, 320);
    const h = Math.max(this.container.clientHeight, 320);

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(34, w / h, 0.1, 100);
    this.camera.position.set(0, 1.8, 10.5);
    this.camera.lookAt(0, 0.1, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    if (THREE.SRGBColorSpace) this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = true;
    this.renderer.domElement.className = 'bracelet-3d-canvas';
    this.container.appendChild(this.renderer.domElement);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xb0a898, 0.42));

    const key = new THREE.DirectionalLight(0xffffff, 1.35);
    key.position.set(4, 9, 7);
    key.castShadow = true;
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0xe8eef8, 0.55);
    fill.position.set(-5, 3, 4);
    this.scene.add(fill);

    const rim = new THREE.DirectionalLight(0xffffff, 0.45);
    rim.position.set(0, 1, -8);
    this.scene.add(rim);

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
    return {
      x: rx * c,
      z: rz * s,
      nx: c / rx,
      nz: s / rz,
    };
  }

  setBracelet(charmIds) {
    if (!this._ready) return;
    this.charmIds = [...charmIds];
    this.textureCache.forEach((tex) => tex.dispose());
    this.textureCache.clear();
    this._clearGroup(this.braceletGroup);
    this.linkMeshes = [];

    const n = charmIds.length;
    const linkW = 0.78;
    const overlap = 0.94;
    const radius = n <= 1 ? 2.2 : (linkW * overlap) / (2 * Math.sin(Math.PI / n));
    const rx = radius * 1.14;
    const rz = radius * 0.86;

    this._layout = { n, linkW, rx, rz };

    charmIds.forEach((id, i) => {
      const charm = CHARM_MAP[id] || CHARMS[0];
      const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
      const pt = this._ellipsePoint(angle, rx, rz);
      const len = Math.hypot(pt.nx, pt.nz) || 1;
      const nx = pt.nx / len;
      const nz = pt.nz / len;

      const linkGroup = this._createLink(charm, i, linkW);
      linkGroup.position.set(pt.x, 0, pt.z);
      linkGroup.lookAt(pt.x + nx * 4, 0, pt.z + nz * 4);
      linkGroup.userData.baseAngle = angle;
      linkGroup.userData.outward = { x: nx, z: nz };

      this.braceletGroup.add(linkGroup);
      this.linkMeshes.push(linkGroup);
    });

    this.braceletGroup.rotation.x = 0.18;
    this.braceletGroup.position.y = 0.15;
    this.braceletGroup.scale.setScalar(1.22);
    this.setSelectedIndex(this.selectedIndex);
  }

  _clearGroup(group) {
    while (group.children.length) {
      const child = group.children[0];
      group.remove(child);
      child.traverse?.((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
          else if (obj.material !== this.silverMat
            && obj.material !== this.silverBezelMat
            && obj.material !== this.selectMat) obj.material.dispose();
        }
      });
    }
  }

  _createHook(side, size, depth) {
    const g = new THREE.Group();
    const arc = new THREE.Mesh(
      new THREE.TorusGeometry(0.045, 0.013, 8, 14, Math.PI * 0.92),
      this.silverBezelMat
    );
    arc.rotation.y = Math.PI / 2;
    arc.rotation.x = side < 0 ? Math.PI * 0.08 : -Math.PI * 0.08;
    arc.position.set(side * (size / 2 + 0.028), 0, depth * 0.15);
    g.add(arc);

    const pin = new THREE.Mesh(
      new THREE.CylinderGeometry(0.011, 0.011, size * 0.22, 8),
      this.silverBezelMat
    );
    pin.rotation.z = Math.PI / 2;
    pin.position.set(side * (size / 2 + 0.01), 0, 0);
    g.add(pin);
    return g;
  }

  _createLink(charm, index, linkW) {
    const group = new THREE.Group();
    group.userData = { index, charmId: charm.id, type: 'link' };

    const size = charm.dangling ? linkW * 1.08 : linkW;
    const depth = 0.13;
    const tex = this._getTexture(charm);

    const bezel = new THREE.Mesh(
      new THREE.BoxGeometry(size + 0.07, size + 0.07, depth + 0.04),
      this.silverBezelMat
    );
    bezel.castShadow = true;
    bezel.receiveShadow = true;
    group.add(bezel);

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(size, size, depth),
      this.silverMat
    );
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    const faceH = charm.dangling ? size * 1.05 : size * 0.86;
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(size * 0.86, faceH),
      new THREE.MeshStandardMaterial({
        map: tex,
        transparent: true,
        alphaTest: 0.05,
        metalness: 0.15,
        roughness: 0.55,
        depthWrite: true,
      })
    );
    face.position.z = depth / 2 + 0.012;
    if (charm.dangling) face.position.y = -size * 0.08;
    face.name = 'charmFace';
    group.add(face);

    group.add(this._createHook(-1, size, depth));
    group.add(this._createHook(1, size, depth));

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(size * 0.52, 0.022, 8, 40),
      this.selectMat
    );
    ring.position.z = depth / 2 + 0.05;
    ring.name = 'selectRing';
    ring.visible = false;
    group.add(ring);

    if (charm.dangling) {
      const dangle = this._createDangleChain(size);
      dangle.name = 'dangle';
      group.add(dangle);
    }

    return group;
  }

  _createDangleChain(size) {
    const g = new THREE.Group();
    g.position.set(0, -size * 0.38, 0.04);
    const chain = new THREE.Mesh(
      new THREE.CylinderGeometry(0.009, 0.009, 0.18, 6),
      this.silverBezelMat
    );
    chain.position.y = -0.12;
    g.add(chain);
    return g;
  }

  _getTexture(charm) {
    if (this.textureCache.has(charm.id)) return this.textureCache.get(charm.id);

    const url = assetUrl(getCharmImageUrl(charm.id));
    const fallbackUrl = assetUrl(getCharmImageUrl('blank-silver'));

    const placeholder = new THREE.Texture();
    this.textureCache.set(charm.id, placeholder);

    this.textureLoader.load(
      url,
      (tex) => {
        tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
        if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;
        this.textureCache.set(charm.id, tex);
        this._applyTextureToLinks(charm.id, tex);
      },
      undefined,
      () => {
        this.textureLoader.load(fallbackUrl, (tex) => {
          tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
          if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
          tex.needsUpdate = true;
          this.textureCache.set(charm.id, tex);
          this._applyTextureToLinks(charm.id, tex);
        });
      }
    );

    return placeholder;
  }

  _applyTextureToLinks(charmId, tex) {
    this.linkMeshes.forEach((mesh) => {
      if (mesh.userData.charmId !== charmId) return;
      mesh.traverse((obj) => {
        if (obj.name === 'charmFace' && obj.material) {
          obj.material.map = tex;
          obj.material.needsUpdate = true;
        }
      });
    });
  }

  setSelectedIndex(index) {
    this.selectedIndex = index;
    this.linkMeshes.forEach((mesh, i) => {
      const ring = mesh.getObjectByName('selectRing');
      const sel = i === index;
      if (ring) ring.visible = sel;
      mesh.scale.setScalar(sel ? 1.1 : 1);
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

    if (this.autoRotate && !this.isDragging) this.targetRotateY += dt * 0.28;
    this.rotateY += (this.targetRotateY - this.rotateY) * 0.07;

    if (this.braceletGroup && this._layout) {
      this.braceletGroup.rotation.y = this.rotateY;
      const { n, linkW, rx, rz } = this._layout;

      this.linkMeshes.forEach((mesh, i) => {
        const angle = mesh.userData.baseAngle + this.rotateY;
        const pt = this._ellipsePoint(angle, rx, rz);
        const len = Math.hypot(pt.nx, pt.nz) || 1;
        const nx = pt.nx / len;
        const nz = pt.nz / len;

        const flex = Math.sin(t * 2.4 + i * 0.65) * 0.025;
        mesh.position.set(pt.x + nx * flex, flex * 0.4, pt.z + nz * flex);
        mesh.lookAt(pt.x + nx * 4, flex * 0.4, pt.z + nz * 4);

        const charm = CHARM_MAP[this.charmIds[i]];
        const dangle = mesh.getObjectByName('dangle');
        if (dangle) {
          dangle.rotation.z = Math.sin(t * 2.8 + i * 0.9) * 0.1;
        }
      });
    }

    this.renderer.render(this.scene, this.camera);
  }

  destroy() {
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