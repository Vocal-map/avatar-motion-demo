import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { neutralFace } from './face.js';

// Businesswoman 02, Copyright (c) 2020 Microsoft, MIT. See public/models/LICENSE*.
export async function createAvatar() {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const response = await fetch('/models/business-female-02.glb', { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`GLB_LOAD_FAILED: HTTP ${response.status}`);
  const gltf = await loader.parseAsync(await response.arrayBuffer(), '/models/');
  const root = new THREE.Group();
  root.add(gltf.scene);
  const bones = new Map();
  gltf.scene.traverse(object => {
    if (object.isBone) bones.set(object.name.replace(/[\s_]/g, ''), object);
    if (object.isMesh) { object.castShadow = true; object.receiveShadow = true; object.frustumCulled = false; }
  });
  function bone(name) {
    const result = bones.get(`Bip01${name}`);
    if (!result) throw new Error(`GLB_RIG_MISSING: ${name}`);
    return result;
  }
  root.updateMatrixWorld(true);
  // Align the model's bind-pose arms with the downward rest pose used by our clips.
  for (const side of ['R', 'L']) {
    for (const [name, child] of [['UpperArm', 'Forearm'], ['Forearm', 'Hand']]) {
      const joint = bone(side + name);
      const direction = bone(side + child).getWorldPosition(new THREE.Vector3()).sub(joint.getWorldPosition(new THREE.Vector3())).normalize();
      const desired = new THREE.Quaternion().setFromUnitVectors(direction, new THREE.Vector3(0, -1, 0)).multiply(joint.getWorldQuaternion(new THREE.Quaternion()));
      joint.quaternion.copy(joint.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(desired));
      root.updateMatrixWorld(true);
    }
  }
  const bounds = new THREE.Box3().setFromObject(root);
  const scale = 3.2 / bounds.getSize(new THREE.Vector3()).y;
  gltf.scene.scale.multiplyScalar(scale);
  root.updateMatrixWorld(true);
  const scaledBounds = new THREE.Box3().setFromObject(root);
  gltf.scene.position.y -= scaledBounds.min.y;
  root.updateMatrixWorld(true);
  const rest = new Map();
  bones.forEach(joint => rest.set(joint, { local: joint.quaternion.clone(), position: joint.position.clone(),
    world: joint.getWorldQuaternion(new THREE.Quaternion()),
    inverseParent: new THREE.Matrix3().setFromMatrix4(joint.parent.matrixWorld).invert() }));
  const facialNames = ['MJaw', 'MBottomLip', 'MUpperLip', 'LMouthBottom', 'RMouthBottom',
    ...['R', 'L'].flatMap(side => ['MouthCorner', 'Cheek', 'Upperlip', 'InnerEyebrow', 'OuterEyebrow', 'EyeBlinkTop', 'EyeBlinkBottom'].map(part => side + part))];
  const facialBones = facialNames.map(bone);
  const offsetVector = new THREE.Vector3();
  const defaultFace = neutralFace();
  const feet = ['RFoot', 'LFoot'].map(bone);
  const baseFootY = Math.min(...feet.map(joint => joint.getWorldPosition(new THREE.Vector3()).y));
  const delta = new THREE.Quaternion(), euler = new THREE.Euler(), temp = new THREE.Quaternion();
  function rotate(name, x = 0, y = 0, z = 0) {
    const joint = bone(name), base = rest.get(joint);
    delta.setFromEuler(euler.set(x, y, z));
    temp.copy(base.world).invert().multiply(delta).multiply(base.world);
    joint.quaternion.copy(base.local).multiply(temp);
  }
  function offset(name, x, y, z = 0) {
    const joint = bone(name);
    // Deltas are measured in scene units in the neutral face's coordinate frame.
    joint.position.add(offsetVector.set(x, y, z).applyMatrix3(rest.get(joint).inverseParent));
  }
  function applyFace(face, eyeScale) {
    // Rebuild from rest every frame, including translations, to prevent drift.
    facialBones.forEach(joint => { joint.position.copy(rest.get(joint).position); joint.quaternion.copy(rest.get(joint).local); });
    const blink = Math.max(1 - THREE.MathUtils.clamp(eyeScale, 0, 1), face.squint * .45);
    rotate('MJaw', face.jawOpen * .30);
    offset('MUpperLip', 0, face.jawOpen * .0035, face.round * .007);
    offset('MBottomLip', 0, -face.jawOpen * .004, face.round * .006);
    for (const [side, sign] of [['R', -1], ['L', 1]]) {
      const asymmetricLift = face.asymmetry * (side === 'R' ? .003 : -.001);
      offset(side + 'MouthCorner', sign * (face.smile * .010 + face.wide * .008 - face.round * .008),
        face.smile * .010 - face.frown * .008, face.round * .005);
      offset(side + 'MouthBottom', sign * (face.wide * .004 - face.round * .004), -face.jawOpen * .002);
      offset(side + 'Upperlip', sign * (face.wide * .003 - face.round * .003), face.smile * .002, face.round * .005);
      offset(side + 'Cheek', 0, face.cheek * .007, face.cheek * .002);
      offset(side + 'InnerEyebrow', -sign * face.browKnit * .005,
        face.browRaise * .010 + face.innerRaise * .008 + asymmetricLift);
      offset(side + 'OuterEyebrow', 0, face.browRaise * .008 - face.frown * .004 + asymmetricLift);
      offset(side + 'EyeBlinkTop', 0, -blink * .012 + face.eyeWide * .003 * (1 - blink));
      offset(side + 'EyeBlinkBottom', 0, blink * .004 + face.squint * .0015);
    }
  }
  function applyPose(pose, face = defaultFace) {
    root.position.y = 0;
    rotate('Spine', pose.bodyX, 0, pose.bodyZ);
    rotate('Head', pose.headX, pose.headY, pose.headZ);
    applyFace(face, pose.eyeScale);
    for (const [side, prefix] of [['R', 'right'], ['L', 'left']]) {
      rotate(side + 'UpperArm', pose[prefix + 'ArmX'], 0, pose[prefix + 'ArmZ']);
      rotate(side + 'Forearm', pose[prefix + 'ElbowX'], 0, pose[prefix + 'ElbowZ']);
      rotate(side + 'Thigh', pose[prefix + 'LegX']);
      rotate(side + 'Calf', pose.kneeX);
      rotate(side + 'Foot', -(pose[prefix + 'LegX'] + pose.kneeX));
    }
    root.updateMatrixWorld(true);
    const footY = Math.min(...feet.map(joint => joint.getWorldPosition(new THREE.Vector3()).y));
    root.position.y = .09 + baseFootY - footY + Math.max(0, pose.y);
  }
  const faceTarget = new THREE.Vector3();
  function getFaceTarget() {
    return bone('Head').getWorldPosition(faceTarget).add(new THREE.Vector3(0, .12, .06));
  }
  return { root, applyPose, getFaceTarget };
}

