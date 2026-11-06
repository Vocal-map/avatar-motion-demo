import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Original MILO character. All geometry is created here; no external model asset.
export function createRobot() {
  const cream = new THREE.MeshStandardMaterial({ color: '#f7f5e9', roughness: .32, metalness: .04 });
  const mint = new THREE.MeshStandardMaterial({ color: '#c7d7b4', roughness: .42, metalness: .04 });
  const graphite = new THREE.MeshStandardMaterial({ color: '#34453e', roughness: .42, metalness: .22 });
  const visor = new THREE.MeshStandardMaterial({ color: '#263b35', roughness: .22, metalness: .10 });
  const lime = new THREE.MeshStandardMaterial({ color: '#ddf6a3', emissive: '#c7ec8f', emissiveIntensity: .6, roughness: .4 });
  const orange = new THREE.MeshStandardMaterial({ color: '#e79b61', roughness: .35, metalness: .03 });
  const seam = new THREE.MeshStandardMaterial({ color: '#e1dfce', roughness: .52 });
  const root = new THREE.Group();
  root.name = 'MILO';

  function mesh(parent, geometry, material, position = [0, 0, 0], scale) {
    const object = new THREE.Mesh(geometry, material);
    object.position.set(...position);
    if (scale) object.scale.set(...scale);
    object.castShadow = true;
    object.receiveShadow = true;
    parent.add(object);
    return object;
  }
  const box = (w, h, d, radius = .1) => {
    // Keep round face corners even on a very thin visor or chest panel.
    const depth = Math.max(d, radius * 2);
    const geometry = new RoundedBoxGeometry(w, h, depth, 4, radius);
    geometry.scale(1, 1, d / depth);
    return geometry;
  };
  const sphere = (r) => new THREE.SphereGeometry(r, 24, 16);
  const capsule = (r, length) => new THREE.CapsuleGeometry(r, length, 6, 16);
  function group(parent, name, position) {
    const part = new THREE.Group();
    part.name = name;
    part.position.set(...position);
    parent.add(part);
    return part;
  }

  // The upper body rotates around the waist for a true articulated bow.
  const body = group(root, 'Waist', [0, .96, 0]);
  mesh(body, sphere(.29), graphite, [0, .03, 0], [1, .50, .80]);
  mesh(body, box(.94, .96, .66, .23), cream, [0, .48, 0]);
  mesh(body, box(.71, .67, .095, .16), mint, [0, .48, .326]);
  const badge = mesh(body, new THREE.CylinderGeometry(.095, .095, .035, 28), orange, [.19, .66, .395]);
  badge.rotation.x = Math.PI / 2;
  mesh(body, box(.08, .018, .014, .007), cream, [.19, .66, .416]);
  // Three inset speaker slots and a tiny status lamp.
  for (let i = 0; i < 3; i++) mesh(body, box(.12, .018, .015, .008), graphite, [-.18, .53 - i * .058, .386]);
  mesh(body, sphere(.026), lime, [0, .25, .386], [1, 1, .4]);
  mesh(body, new THREE.CylinderGeometry(.14, .17, .18, 24), graphite, [0, 1.01, 0]);

  const head = group(body, 'Head', [0, 1.05, 0]);
  mesh(head, box(1.40, 1.02, .89, .30), cream, [0, .36, 0]);
  mesh(head, box(1.25, .78, .15, .24), seam, [0, .37, .390]);
  mesh(head, box(1.16, .69, .14, .22), visor, [0, .37, .440]);
  const eyes = [-.25, .25].map((x) => mesh(head, capsule(.055, .105), lime, [x, .43, .518], [1, 1, .33]));
  const smileCurve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(-.105, .235, .526), new THREE.Vector3(0, .145, .54), new THREE.Vector3(.105, .235, .526));
  mesh(head, new THREE.TubeGeometry(smileCurve, 20, .014, 8, false), lime);
  // Very subtle glass reflection at the top-left of the face.
  const glint = new THREE.MeshBasicMaterial({ color: '#d6e9cc', transparent: true, opacity: .15 });
  const reflection = mesh(head, box(.25, .035, .008, .015), glint, [-.31, .61, .515]);
  reflection.rotation.z = .04;
  [-1, 1].forEach((side) => {
    const ear = mesh(head, new THREE.CylinderGeometry(.16, .16, .13, 32), mint, [side * .72, .37, 0]);
    ear.rotation.z = Math.PI / 2;
    const earInset = mesh(head, new THREE.CylinderGeometry(.075, .075, .012, 24), orange, [side * .791, .37, 0]);
    earInset.rotation.z = Math.PI / 2;
  });
  mesh(head, new THREE.CylinderGeometry(.037, .049, .19, 16), graphite, [0, .94, -.03]);
  mesh(head, sphere(.11), orange, [0, 1.075, -.03]);

  function makeArm(side, name) {
    const shoulder = group(body, name, [side * .56, .78, 0]);
    mesh(shoulder, sphere(.17), graphite);
    mesh(shoulder, capsule(.155, .20), cream, [0, -.245, 0]);
    const elbow = group(shoulder, `${name}Elbow`, [0, -.49, 0]);
    mesh(elbow, sphere(.12), graphite);
    mesh(elbow, capsule(.135, .16), cream, [0, -.20, 0]);
    mesh(elbow, new THREE.CylinderGeometry(.137, .137, .07, 24), mint, [0, -.34, 0]);
    mesh(elbow, box(.25, .26, .23, .105), cream, [0, -.48, .02]);
    mesh(elbow, capsule(.065, .04), cream, [-side * .14, -.43, .05]);
    return { shoulder, elbow };
  }
  const right = makeArm(-1, 'RightShoulder');
  const left = makeArm(1, 'LeftShoulder');

  function makeLeg(side, name) {
    const hip = group(root, name, [side * .27, .90, 0]);
    mesh(hip, sphere(.16), graphite);
    mesh(hip, capsule(.165, .13), cream, [0, -.19, 0]);
    const knee = group(hip, `${name}Knee`, [0, -.38, 0]);
    mesh(knee, sphere(.123), graphite);
    mesh(knee, capsule(.145, .10), mint, [0, -.17, 0]);
    const foot = group(knee, `${name}Foot`, [0, -.405, 0]);
    mesh(foot, box(.38, .29, .58, .13), cream, [0, 0, .11]);
    mesh(foot, box(.38, .075, .57, .03), seam, [0, -.11, .11]);
    return { hip, knee, foot };
  }
  const rightLeg = makeLeg(-1, 'RightHip');
  const leftLeg = makeLeg(1, 'LeftHip');

  function applyPose(pose) {
    root.position.y = .12 + pose.y;
    body.rotation.set(pose.bodyX, 0, pose.bodyZ);
    head.rotation.set(pose.headX, pose.headY, pose.headZ);
    right.shoulder.rotation.set(pose.rightArmX, 0, pose.rightArmZ);
    left.shoulder.rotation.set(pose.leftArmX, 0, pose.leftArmZ);
    right.elbow.rotation.set(pose.rightElbowX, 0, pose.rightElbowZ);
    left.elbow.rotation.set(pose.leftElbowX, 0, pose.leftElbowZ);
    rightLeg.hip.rotation.x = pose.rightLegX;
    leftLeg.hip.rotation.x = pose.leftLegX;
    rightLeg.knee.rotation.x = leftLeg.knee.rotation.x = pose.kneeX;
    rightLeg.foot.rotation.x = -(pose.rightLegX + pose.kneeX);
    leftLeg.foot.rotation.x = -(pose.leftLegX + pose.kneeX);
    eyes.forEach((eye) => { eye.scale.y = pose.eyeScale; });
  }
  return { root, applyPose };
}
