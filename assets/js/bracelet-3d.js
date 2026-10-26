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
    this.skinMat = new THREE.MeshStandardMaterial({
      color: 0xc99578,
      roughness: 0.78,
      metalness: 0,
    });
    this.nailMat = new THREE.MeshStandardMaterial({
      color: 0xe8c9b9,
      roughness: 0.46,
      metalness: 0,
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
    this._building = true;

    // The wrist is a fixed, adult-sized mannequin. Each link is modeled at its
    // nominal 9mm size, so a short design visibly leaves a gap instead of being
    // stretched to look like it fits.
    const linkW = 0.42;
    const wristY = 1.30;
    const wristZ = 0.95;
    const pathY = 1.40;
    const pathZ = 1.05;
    const circumference = Math.PI * (3 * (pathY + pathZ) - Math.sqrt((3 * pathY + pathZ) * (pathY + 3 * pathZ)));
    const fullLinkCount = Math.max(1, Math.round(circumference / linkW));
    const n = Math.max(charmIds.length, 1);
    const angleStep = n >= fullLinkCount ? (Math.PI * 2) / n : (Math.PI * 2) / fullLinkCount;
    const visibleArc = Math.min(angleStep * n, Math.PI * 2);
    const startAngle = -visibleArc / 2 + angleStep / 2;

    this._layout = { n, linkW, wristY, wristZ, fullLinkCount };
    this._createWrist(wristY, wristZ);

    charmIds.forEach((id, i) => {
      const charm = CHARM_MAP[id] || CHARMS[0];
      const angle = startAngle + angleStep * i;
      const y = pathY * Math.sin(angle);
      const z = pathZ * Math.cos(angle);
      const tangent = new THREE.Vector3(0, pathY * Math.cos(angle), -pathZ * Math.sin(angle)).normalize();
      const normal = new THREE.Vector3(0, Math.sin(angle) / pathY, Math.cos(angle) / pathZ).normalize();
      const alongArm = new THREE.Vector3(1, 0, 0);
      const linkGroup = this._createLink(charm, i, linkW);

      // Align each square face with the curve of the wrist, pointing outward.
      const basis = new THREE.Matrix4().makeBasis(alongArm, tangent, normal);
      linkGroup.quaternion.setFromRotationMatrix(basis);
      linkGroup.position.set(-0.35, y, z);
      linkGroup.userData.basePosition = linkGroup.position.clone();
      linkGroup.userData.baseQuaternion = linkGroup.quaternion.clone();
      linkGroup.userData.baseAngle = angle;

      this.braceletGroup.add(linkGroup);
      this.linkMeshes.push(linkGroup);
    });

    const horizontalSpan = 13.4;
    const verticalSpan = 4.8;
    const fitDistance = Math.max(
      horizontalSpan / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * this.camera.aspect * 0.92),
      verticalSpan / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 0.90)
    );
    this.braceletGroup.rotation.set(0.10, 0, 0);
    this.braceletGroup.position.set(0, 0, 0);
    this.braceletGroup.scale.setScalar(1);
    this.camera.position.set(0, 2.9, Math.max(15, fitDistance));
    this.camera.lookAt(0, 0, 0);
    this.setSelectedIndex(this.selectedIndex);
    this._building = false;
  }

  _createWrist(wristY, wristZ) {
    const skin = this.skinMat;
    const nail = this.nailMat;

    // A softly tapered forearm, palm and fingers make the 9mm links readable at
    // human scale. The hand is deliberately generic; it is a sizing reference,
    // not a scan of Kasya's hand.
    const sections = [
      [-6.0, 1.56, 1.00],
      [-5.2, 1.50, 0.98],
      [-4.2, 1.40, 0.94],
      [-3.2, 1.34, 0.91],
      [-2.3, 1.28, 0.89],
      [-1.4, 1.26, 0.90],
      [-0.7, wristY, wristZ],
      [0.0, 1.32, 0.96],
      [0.55, 1.42, 0.94],
      [1.0, 1.44, 0.82],
      [1.35, 1.34, 0.68],
    ];
    const around = 40;
    const vertices = [];
    const indices = [];

    sections.forEach(([x, ry, rz]) => {
      for (let j = 0; j < around; j++) {
        const a = (j / around) * Math.PI * 2;
        vertices.push(x, ry * Math.cos(a), rz * Math.sin(a));
      }
    });
    for (let i = 0; i < sections.length - 1; i++) {
      for (let j = 0; j < around; j++) {
        const a = i * around + j;
        const b = i * around + ((j + 1) % around);
        const c = (i + 1) * around + ((j + 1) % around);
        const d = (i + 1) * around + j;
        indices.push(a, c, b, a, d, c);
      }
    }
    const armGeometry = new THREE.BufferGeometry();
    armGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    armGeometry.setIndex(indices);
    armGeometry.computeVertexNormals();
    this.braceletGroup.add(new THREE.Mesh(armGeometry, skin));

    const sphere = new THREE.SphereGeometry(1, 28, 20);
    const ellipsoid = (position, scale, material, rotationZ = 0) => {
      const mesh = new THREE.Mesh(sphere, material);
      mesh.position.set(position[0], position[1], position[2]);
      mesh.scale.set(scale[0], scale[1], scale[2]);
      mesh.rotation.z = rotationZ;
      this.braceletGroup.add(mesh);
      return mesh;
    };

    // Palm blends into the forearm; four fingers and a thumb give a clear
    // on-hand silhouette without obscuring the bracelet.
    ellipsoid([2.00, 0, 0.08], [1.50, 1.22, 0.48], skin, -0.04);
    const fingers = [
      { y: -0.98, end: 6.45, width: 0.35, tilt: -0.035 },
      { y: -0.33, end: 7.08, width: 0.37, tilt: -0.015 },
      { y: 0.34, end: 7.00, width: 0.37, tilt: 0.015 },
      { y: 0.98, end: 6.48, width: 0.35, tilt: 0.045 },
    ];
    fingers.forEach((finger) => {
      const startX = 2.55;
      const length = finger.end - startX;
      ellipsoid(
        [startX + length * 0.52, finger.y, 0.08],
        [length * 0.58, finger.width, 0.15],
        skin,
        finger.tilt
      );
      // Small knuckle pads and natural, pale nail beds help the hand read as a
      // hand when viewed from above.
      ellipsoid([startX + length * 0.38, finger.y, 0.20], [0.28, finger.width * 0.76, 0.07], skin);
      ellipsoid([finger.end - 0.17, finger.y, 0.215], [0.22, finger.width * 0.48, 0.035], nail, finger.tilt);
    });

    ellipsoid([1.48, -1.08, 0.08], [0.75, 0.36, 0.17], skin, -0.62);
    ellipsoid([1.92, -1.48, 0.12], [0.63, 0.31, 0.16], skin, -0.58);
    ellipsoid([2.38, -1.79, 0.19], [0.24, 0.18, 0.045], nail, -0.55);
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
          && obj.material !== this.skinMat
          && obj.material !== this.nailMat
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
        const charm = CHARM_MAP[this.charmIds[i]];
        const swing = charm?.dangling ? Math.sin(t * 2.5 + i) * 0.035 : 0;
        mesh.quaternion.copy(mesh.userData.baseQuaternion);
        if (swing) mesh.rotateZ(swing);
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
