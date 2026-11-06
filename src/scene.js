import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createRobot } from './robot.js';

export function createScene(container, onContextLost) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'default' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.20;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, .1, 60);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.63, 0);
  controls.enableDamping = true;
  controls.dampingFactor = .065;
  controls.enablePan = false;
  controls.minDistance = 6.1;
  controls.maxDistance = 12;
  controls.minPolarAngle = Math.PI / 3;
  controls.maxPolarAngle = Math.PI / 2 + .05;
  controls.rotateSpeed = .60;
  controls.zoomSpeed = .65;

  scene.add(new THREE.HemisphereLight('#fefff2', '#94a779', 2.6));
  const key = new THREE.DirectionalLight('#fff5e3', 3.4);
  key.position.set(-3.5, 7, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -4, right: 4, top: 5, bottom: -4, near: .5, far: 20 });
  key.shadow.normalBias = .035;
  key.shadow.bias = -.0002;
  key.shadow.radius = 4;
  scene.add(key);
  const fill = new THREE.DirectionalLight('#edf6df', 1.4);
  fill.position.set(4, 3, 0);
  scene.add(fill);
  const rim = new THREE.DirectionalLight('#ffffff', 2);
  rim.position.set(-1, 5, -4);
  scene.add(rim);

  const platform = new THREE.Mesh(new THREE.CylinderGeometry(1.43, 1.46, .15, 96), new THREE.MeshStandardMaterial({ color: '#eff0de', roughness: .8, metalness: 0 }));
  platform.position.y = .01;
  platform.receiveShadow = true;
  platform.castShadow = true;
  scene.add(platform);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.34, .009, 8, 100), new THREE.MeshStandardMaterial({ color: '#cfd7bc', roughness: .7 }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = .091;
  scene.add(ring);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ color: '#53623b', opacity: .14 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -.069;
  ground.receiveShadow = true;
  scene.add(ground);

  // Radial contact shadow keeps the character grounded under soft lighting.
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = shadowCanvas.height = 128;
  const ctx = shadowCanvas.getContext('2d');
  const gradient = ctx.createRadialGradient(64, 64, 1, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(68,81,49,0.30)');
  gradient.addColorStop(.45, 'rgba(68,81,49,0.15)');
  gradient.addColorStop(1, 'rgba(68,81,49,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  const contactTexture = new THREE.CanvasTexture(shadowCanvas);
  const contactShadow = new THREE.Mesh(new THREE.PlaneGeometry(2, 1.45), new THREE.MeshBasicMaterial({ map: contactTexture, transparent: true, depthWrite: false }));
  contactShadow.rotation.x = -Math.PI / 2;
  contactShadow.position.set(0, .094, .08);
  scene.add(contactShadow);

  const robot = createRobot();
  scene.add(robot.root);
  let initialSize = true;
  let lastCompact = false;
  function resetCamera() {
    const compact = container.clientWidth < 550;
    camera.position.set(compact ? 3.65 : 3.4, 2.95, compact ? 9.9 : 8.6);
    controls.target.set(0, 1.63, 0);
    controls.update();
  }
  function resize() {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (!width || !height) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    const compact = width < 550;
    if (initialSize || compact !== lastCompact) resetCamera();
    initialSize = false;
    lastCompact = compact;
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();
  const handleContextLost = (event) => { event.preventDefault(); onContextLost(); };
  renderer.domElement.addEventListener('webglcontextlost', handleContextLost);

  function render(pose) {
    robot.applyPose(pose);
    contactShadow.material.opacity = 1 - Math.max(0, pose.y) * .65;
    contactShadow.scale.setScalar(1 + Math.max(0, pose.y) * .3);
    controls.update();
    renderer.render(scene, camera);
  }
  function dispose() {
    resizeObserver.disconnect();
    controls.dispose();
    renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
    const materials = new Set();
    scene.traverse((object) => {
      object.geometry?.dispose();
      if (object.material) (Array.isArray(object.material) ? object.material : [object.material]).forEach((m) => materials.add(m));
    });
    materials.forEach((m) => m.dispose());
    contactTexture.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }
  return { render, resetCamera, dispose };
}
