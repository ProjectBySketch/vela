import * as THREE from 'three';
import { Scene3DObject } from './types';

function buildMeshGeometry(obj: Scene3DObject): THREE.BufferGeometry {
  const p = obj.params;
  switch (obj.geometry) {
    case 'box':
    case 'wing':
      return new THREE.BoxGeometry(p.w ?? 1, p.h ?? 1, p.d ?? 1);
    case 'sphere':
      return new THREE.SphereGeometry(p.radius ?? 0.7, 24, 16);
    case 'cylinder':
      return new THREE.CylinderGeometry(p.radius ?? 0.6, p.radius ?? 0.6, p.h ?? 1.2, 24);
    case 'cone':
      return new THREE.ConeGeometry(p.radius ?? 0.5, p.h ?? 1.0, 24);
    case 'torus':
      return new THREE.TorusGeometry(p.radius ?? 0.8, p.tube ?? 0.16, 14, 36);
    case 'torusKnot':
      return new THREE.TorusKnotGeometry(p.radius ?? 0.7, p.tube ?? 0.18, 48, 12);
    case 'capsule':
      return new THREE.CapsuleGeometry(p.radius ?? 0.4, p.length ?? 1.0, 8, 16);
    case 'dish': {
      const pts: THREE.Vector2[] = [];
      const r = p.radius ?? 0.75;
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        pts.push(new THREE.Vector2(t * r, t * t * 0.35));
      }
      pts.push(new THREE.Vector2(r * 0.96, 0.37));
      pts.push(new THREE.Vector2(0, 0.04));
      return new THREE.LatheGeometry(pts, 28);
    }
    case 'gear': {
      const teeth = Math.max(6, Math.round(p.teeth ?? 12));
      const outerR = p.radius ?? 0.7;
      const innerR = outerR * 0.78;
      const boreR = outerR * 0.28;
      const shape = new THREE.Shape();
      for (let i = 0; i < teeth; i++) {
        const a0 = (i / teeth) * Math.PI * 2;
        const a1 = ((i + 0.25) / teeth) * Math.PI * 2;
        const a2 = ((i + 0.5) / teeth) * Math.PI * 2;
        const a3 = ((i + 0.75) / teeth) * Math.PI * 2;
        if (i === 0) shape.moveTo(Math.cos(a0) * innerR, Math.sin(a0) * innerR);
        else shape.lineTo(Math.cos(a0) * innerR, Math.sin(a0) * innerR);
        shape.lineTo(Math.cos(a1) * outerR, Math.sin(a1) * outerR);
        shape.lineTo(Math.cos(a2) * outerR, Math.sin(a2) * outerR);
        shape.lineTo(Math.cos(a3) * innerR, Math.sin(a3) * innerR);
      }
      shape.closePath();
      const hole = new THREE.Path();
      hole.absarc(0, 0, boreR, 0, Math.PI * 2, true);
      shape.holes.push(hole);
      const geo = new THREE.ExtrudeGeometry(shape, {
        depth: p.h ?? 0.35,
        bevelEnabled: true,
        bevelThickness: 0.02,
        bevelSize: 0.02,
        bevelSegments: 1,
      });
      geo.rotateX(Math.PI / 2);
      geo.center();
      return geo;
    }
    default:
      return new THREE.BoxGeometry(1, 1, 1);
  }
}

/**
 * Exports any Vela scene3d object graph into standard Wavefront .obj geometry
 * compatible with Blender, Godot, Unity, and macOS Preview.
 */
export function exportSceneToObj(sceneName: string, objects: Scene3DObject[]): string {
  const lines: string[] = [
    `# Vela 3D Studio Wavefront OBJ Export`,
    `# Scene: ${sceneName}`,
    `# Parts: ${objects.length}`,
    '',
  ];

  let vOffset = 1;
  let vnOffset = 1;
  const mat = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const euler = new THREE.Euler();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const normalMat = new THREE.Matrix3();
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();

  for (const obj of objects) {
    lines.push(`o ${obj.name}`);
    const geo = buildMeshGeometry(obj);
    const nonIdx = geo.index ? geo.toNonIndexed() : geo;
    nonIdx.computeVertexNormals();

    pos.set(...obj.position);
    euler.set(...obj.rotation);
    quat.setFromEuler(euler);
    scale.set(...obj.scale);
    mat.compose(pos, quat, scale);
    normalMat.getNormalMatrix(mat);

    const posAttr = nonIdx.getAttribute('position');
    const normAttr = nonIdx.getAttribute('normal');
    const count = posAttr.count;

    for (let i = 0; i < count; i++) {
      v.fromBufferAttribute(posAttr, i).applyMatrix4(mat);
      lines.push(`v ${v.x.toFixed(5)} ${v.y.toFixed(5)} ${v.z.toFixed(5)}`);
    }
    if (normAttr) {
      for (let i = 0; i < count; i++) {
        n.fromBufferAttribute(normAttr, i).applyMatrix3(normalMat).normalize();
        lines.push(`vn ${n.x.toFixed(5)} ${n.y.toFixed(5)} ${n.z.toFixed(5)}`);
      }
    }

    for (let i = 0; i + 2 < count; i += 3) {
      const a = vOffset + i;
      const b = vOffset + i + 1;
      const c = vOffset + i + 2;
      if (normAttr) {
        const na = vnOffset + i;
        const nb = vnOffset + i + 1;
        const nc = vnOffset + i + 2;
        lines.push(`f ${a}//${na} ${b}//${nb} ${c}//${nc}`);
      } else {
        lines.push(`f ${a} ${b} ${c}`);
      }
    }

    vOffset += count;
    if (normAttr) vnOffset += count;
    if (nonIdx !== geo) nonIdx.dispose();
    geo.dispose();
    lines.push('');
  }

  return lines.join('\n');
}
