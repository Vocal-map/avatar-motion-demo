import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Original stylized human MILO character. All geometry is created here; no external model asset.
export function createAvatar() {
  const material = (color, roughness = .75) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
  const skin = material('#efd0bb');
  const blush = material('#ba7974');
  const hair = material('#171719');
  const hairHighlight = material('#242326');
  const shirt = material('#a9c9ed');
  const collar = material('#c4dcf4');
  const pants = material('#202126');
  const shoes = material('#17171b');
  const sole = material('#252329');
  const white = material('#fffaf0', .4);
  const iris = material('#574237', .35);
  const pupil = material('#211d25', .3);
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

  // Adult proportions; leg link lengths match the shared motion geometry.
  function tailored(parent, name, profile, mat, position, depth = .65) {
    if (profile[0][1] > profile[profile.length - 1][1]) profile = [...profile].reverse();
    const geometry = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 48);
    geometry.scale(1, 1, depth);
    const item = mesh(parent, geometry, mat, position);
    item.name = name;
    return item;
  }
  const body = group(root, 'Waist', [0, 1.62, 0]);
  tailored(body, 'Blouse', [[.27,0],[.29,.12],[.31,.32],[.36,.55],[.34,.70],[.25,.78],[.12,.82]], shirt, [0,0,0]);
  mesh(body, new THREE.CylinderGeometry(.09, .11, .23, 24), skin, [0, .86, 0]);
  // Two pointed collar panels and a central button placket.
  for (const side of [-1,1]) {
    const shape = new THREE.Shape();
    shape.moveTo(side*.025,.82); shape.lineTo(side*.17,.75); shape.lineTo(side*.105,.59); shape.lineTo(side*.01,.74); shape.closePath();
    mesh(body, new THREE.ExtrudeGeometry(shape, {depth:.015,bevelEnabled:false}), collar, [0,0,.17]);
  }
  mesh(body, box(.025,.57,.015,.006), collar, [0,.34,.224]);
  for (let i=0;i<5;i++) mesh(body,sphere(.013),white,[0,.14+i*.105,.238]);
  const skirt = tailored(root, 'PencilSkirt', [[.28,0],[.31,-.08],[.37,-.25],[.36,-.50],[.32,-.86],[.31,-.90]], pants, [0,1.64,0], .73);
  // Store rest vertices so the skirt follows the bent legs during a jump.
  const skirtRest = skirt.geometry.attributes.position.array.slice();
  const head = group(body, 'Head', [0, .96, 0]);
  head.scale.set(.46, .53, .46);
  mesh(head, sphere(.59), skin, [0, .39, 0], [1, 1.12, .84]);
  // Hair cap and rear volume leave the forehead and face exposed.
  mesh(head, sphere(.59), hair, [0, .47, -.15], [1.04, 1.10, .80]);
  const cap = new THREE.SphereGeometry(.61, 40, 24, 0, Math.PI * 2, 0, 1.24);
  mesh(head, cap, hair, [0, .41, 0], [1.03, 1.12, .88]);
  mesh(head, sphere(.30), hair, [0,.42,-.57], [1,.90,.75]);
  const fringe = mesh(head,sphere(.48),hairHighlight,[-.17,.86,.18],[1,.47,.65]);
  fringe.rotation.z=.32;
  const eyes = [];
  for (const side of [-1, 1]) {
    mesh(head, sphere(.13), skin, [side * .57, .40, 0], [.70, 1.2, .8]);
    mesh(head, sphere(.073), blush, [side * .625, .40, .035], [.35, 1, .7]);
    mesh(head, sphere(.11), blush, [side * .34, .28, .397], [1, .45, .20]);
    const eye = group(head, side < 0 ? 'RightEye' : 'LeftEye', [side * .225, .49, .451]);
    mesh(eye, sphere(.115), white, [0, 0, 0], [.85, .65, .38]);
    mesh(eye, sphere(.074), iris, [0, -.005, .039], [.72, .70, .38]);
    mesh(eye, sphere(.043), pupil, [0, -.005, .063], [.72, .70, .3]);
    mesh(eye, sphere(.012), white, [-.018, .028, .077]);
    eyes.push(eye);
    const brow = mesh(head, capsule(.024, .12), hair, [side * .23, .67, .427], [1, 1, .55]);
    brow.rotation.z = side * .13 + Math.PI / 2;
  }
  mesh(head, sphere(.085), skin, [0, .36, .493], [.8, 1.05, 1]);
  const smile = new THREE.QuadraticBezierCurve3(new THREE.Vector3(-.12,.20,.436), new THREE.Vector3(0,.12,.47), new THREE.Vector3(.12,.20,.436));
  mesh(head, new THREE.TubeGeometry(smile, 24, .017, 8, false), blush);

  function makeArm(side, name) {
    const shoulder = group(body, name, [side * .34, .70, 0]);
    mesh(shoulder, sphere(.12), shirt);
    mesh(shoulder, capsule(.105, .25), shirt, [0, -.22, 0]);
    mesh(shoulder, new THREE.CylinderGeometry(.10, .10, .06, 24), collar, [0, -.36, 0]);
    mesh(shoulder, capsule(.09, .13), shirt, [0, -.40, 0]);
    const elbow = group(shoulder, `${name}Elbow`, [0, -.49, 0]);
    mesh(elbow, sphere(.095), shirt);
    mesh(elbow, capsule(.085, .22), shirt, [0, -.18, 0]);
    mesh(elbow, sphere(.095), skin, [0, -.41, .015], [.85, 1.15, .65]);
    const thumb = mesh(elbow, capsule(.034, .06), skin, [-side * .10, -.38, .06]);
    thumb.rotation.z = side * .45;
    // Rounded finger tips make the waving hand read as human, without changing the rig.
    for (let i = 0; i < 4; i++) mesh(elbow, capsule(.019, .065), skin, [(i - 1.5) * .035, -.51 + Math.abs(i - 1.5) * .012, .02]);
    return { shoulder, elbow };
  }
  const right = makeArm(-1, 'RightShoulder');
  const left = makeArm(1, 'LeftShoulder');

  function makeLeg(side, name) {
    const hip = group(root, name, [side * .17, 1.565, 0]);
    mesh(hip, sphere(.15), skin);
    mesh(hip, capsule(.125, .44), skin, [0, -.34, 0]);
    const knee = group(hip, `${name}Knee`, [0, -.70, 0]);
    mesh(knee, sphere(.095), skin);
    tailored(knee, 'Calf', [[.095,0],[.105,-.18],[.085,-.40],[.055,-.68]], skin, [0,0,0], .85);
    const foot = group(knee, `${name}Foot`, [0, -.75, 0]);
    mesh(foot, sphere(.12), skin, [0,.055,.025], [.58,.7,1.2]);
    mesh(foot, sphere(.15), shoes, [0,-.025,.13], [.64,.45,1.45]);
    mesh(foot, box(.12,.09,.16,.035), shoes, [0,.025,-.025]);
    mesh(foot, new THREE.CylinderGeometry(.027,.022,.14,16), shoes, [0,-.07,-.06]);
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
    const vertices = skirt.geometry.attributes.position;
    const angle = (pose.rightLegX + pose.leftLegX) / 2;
    for (let i=0; i<vertices.count; i++) {
      const x=skirtRest[i*3], y=skirtRest[i*3+1], z=skirtRest[i*3+2];
      const bend=angle*Math.min(1,Math.max(0,-y/.65));
      vertices.setXYZ(i,x,y*Math.cos(bend)-z*Math.sin(bend),y*Math.sin(bend)+z*Math.cos(bend));
    }
    vertices.needsUpdate=true;
    skirt.geometry.computeVertexNormals();
    eyes.forEach((eye) => { eye.scale.y = pose.eyeScale; });
  }
  return { root, applyPose };
}
