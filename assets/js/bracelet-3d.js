/**
 * 3D Italian charm bracelet — HD charm planes in a rotating circle
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
    this._ready = false;
    this._pendingTextures = 0;

    this._init();
    this._ready = true;
  }

  _init() {
    const w = Math.max(this.container.clientWidth, 320);
    const h = Math.max(this.container.clientHeight, 320);

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(38, w / h, 0.1, 100);
    this.camera.position.set(0, 3.8, 10.5);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    if (THREE.SRGBColorSpace) this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.className = 'bracelet-3d-canvas';
    this.container.appendChild(this.renderer.domElement);

    this.scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    this.scene.add(new THREE.HemisphereLight(0xfff8f0, 0xe8ddd0, 0.55));

    const key = new THREE.DirectionalLight(0xffffff, 0.65);
    key.position.set(4, 8, 6);
    this.scene.add(key);

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

  setBracelet(charmIds) {
    if (!this._ready) return;
    this.charmIds = [...charmIds];
    this.textureCache.forEach((tex) => tex.dispose());
    this.textureCache.clear();
    this._clearGroup(this.braceletGroup);
    this.linkMeshes = [];
    this._pendingTextures = 0;

    const n = charmIds.length;
    const linkSize = 0.95;
    const radius = n <= 1
      ? 2.4
      : Math.max(2.0, (linkSize / (2 * Math.sin(Math.PI / n))) * 1.38);
    const tiltZ = 0.55;

    charmIds.forEach((id, i) => {
      const charm = CHARM_MAP[id] || CHARMS[0];
      const linkGroup = this._createLink(charm, i);
      const angle = (i / n) * Math.PI * 2 - Math.PI / 2;

      const px = Math.cos(angle) * radius;
      const pz = Math.sin(angle) * radius * tiltZ;
      linkGroup.position.set(px, 0, pz);
      linkGroup.lookAt(px * 2.5, 0, pz * 2.5);

      this.braceletGroup.add(linkGroup);
      this.linkMeshes.push(linkGroup);
    });

    this.braceletGroup.rotation.x = 0.28;
    this.braceletGroup.scale.setScalar(1.15);
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
          else obj.material.dispose();
        }
      });
    }
  }

  _createLink(charm, index) {
    const group = new THREE.Group();
    group.userData = { index, charmId: charm.id, type: 'link' };

    const size = charm.dangling ? 1.15 : 0.92;
    const tex = this._getTexture(charm);

    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        alphaTest: 0.04,
        side: THREE.DoubleSide,
        depthWrite: true,
      })
    );
    face.name = 'charmFace';
    group.add(face);

    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(size * 0.88, size * 0.12),
      new THREE.MeshBasicMaterial({
        color: 0xc4b5a5,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
      })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -size * 0.42;
    shadow.position.z = 0.02;
    group.add(shadow);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(size * 0.48, size * 0.54, 48),
      new THREE.MeshBasicMaterial({
        color: 0xc4846a,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    ring.name = 'selectRing';
    ring.visible = false;
    group.add(ring);

    return group;
  }

  _getTexture(charm) {
    if (this.textureCache.has(charm.id)) return this.textureCache.get(charm.id);

    const url = assetUrl(getCharmImageUrl(charm.id));
    const fallbackUrl = assetUrl(getCharmImageUrl('blank-silver'));

    const placeholder = new THREE.Texture();
    this.textureCache.set(charm.id, placeholder);

    this._pendingTextures += 1;
    this.textureLoader.load(
      url,
      (tex) => {
        tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
        if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;
        this.textureCache.set(charm.id, tex);
        this._applyTextureToLinks(charm.id, tex);
        this._pendingTextures -= 1;
      },
      undefined,
      () => {
        this.textureLoader.load(
          fallbackUrl,
          (tex) => {
            tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
            if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
            tex.needsUpdate = true;
            this.textureCache.set(charm.id, tex);
            this._applyTextureToLinks(charm.id, tex);
            this._pendingTextures -= 1;
          },
          undefined,
          () => { this._pendingTextures -= 1; }
        );
      }
    );

    return placeholder;
  }

  _applyTextureToLinks(charmId, tex) {
    this.linkMeshes.forEach((mesh) => {
      if (mesh.userData.charmId !== charmId) return;
      const face = mesh.getObjectByName('charmFace');
      if (face?.material) {
        face.material.map = tex;
        face.material.needsUpdate = true;
      }
    });
  }

  setSelectedIndex(index) {
    this.selectedIndex = index;
    this.linkMeshes.forEach((mesh, i) => {
      const ring = mesh.getObjectByName('selectRing');
      const sel = i === index;
      if (ring) ring.visible = sel;
      mesh.scale.setScalar(sel ? 1.14 : 1);
      mesh.position.y = sel ? 0.12 : 0;
    });
  }

  _onPointerDown(e) {
    this.isDragging = true;
    this.lastPointerX = e.clientX;
  }

  _onPointerMove(e) {
    if (!this.isDragging) return;
    this.targetRotateY += (e.clientX - this.lastPointerX) * 0.012;
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
    if (this.autoRotate && !this.isDragging) this.targetRotateY += dt * 0.38;
    this.rotateY += (this.targetRotateY - this.rotateY) * 0.08;
    if (this.braceletGroup) {
      this.braceletGroup.rotation.y = this.rotateY;
      this.braceletGroup.position.y = Math.sin(performance.now() * 0.0012) * 0.05;
      const t = performance.now() * 0.001;
      this.linkMeshes.forEach((mesh, i) => {
        const charm = CHARM_MAP[this.charmIds[i]];
        if (charm?.dangling) {
          mesh.rotation.z = Math.sin(t * 1.8 + i * 0.7) * 0.06;
        }
      });
    }
    this.renderer.render(this.scene, this.camera);
  }

  destroy() {
    this._resizeObserver?.disconnect();
    this.textureCache.forEach((tex) => tex.dispose());
    this.textureCache.clear();
    this.renderer?.dispose();
    this.container.innerHTML = '';
  }
}

window.Bracelet3D = Bracelet3D;