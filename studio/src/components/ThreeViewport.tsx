import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Scene3DCamera, Scene3DLight, Scene3DObject } from '../vela/types';
import { exportSceneToObj } from '../vela/objExporter';
import { ChevronDown, ChevronUp, Download, Pause, Play, RotateCcw } from 'lucide-react';

interface ThreeViewportProps {
  sceneName?: string;
  objects: Scene3DObject[];
  lights?: Scene3DLight[];
  cameraConfig?: Scene3DCamera;
  bgColor?: string;
  onSelectPreset?: (presetId: string) => void;
  activePresetId?: string;
}

type FinishMode = 'vela' | 'titanium' | 'gold' | 'clay' | 'wireframe';

function detectSoftwareGl(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

function createSolarGridTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#0B2E59';
  ctx.fillRect(0, 0, 512, 256);
  ctx.strokeStyle = '#38BDF8';
  ctx.lineWidth = 2;
  for (let x = 0; x <= 512; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 256);
    ctx.stroke();
  }
  for (let y = 0; y <= 256; y += 32) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(512, y);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(128, 128, 12, 128, 128, 120);
  grad.addColorStop(0, 'rgba(0,0,0,0.55)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.2)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(canvas);
}

function buildGeometry(obj: Scene3DObject): THREE.BufferGeometry {
  const p = obj.params;
  switch (obj.geometry) {
    case 'box':
    case 'wing':
      return new THREE.BoxGeometry(p.w ?? 1, p.h ?? 1, p.d ?? 1);
    case 'sphere':
      return new THREE.SphereGeometry(p.radius ?? 0.7, 32, 24);
    case 'cylinder':
      return new THREE.CylinderGeometry(p.radius ?? 0.6, p.radius ?? 0.6, p.h ?? 1.2, 32);
    case 'cone':
      return new THREE.ConeGeometry(p.radius ?? 0.5, p.h ?? 1.0, 32);
    case 'torus':
      return new THREE.TorusGeometry(p.radius ?? 0.8, p.tube ?? 0.16, 20, 64);
    case 'torusKnot':
      return new THREE.TorusKnotGeometry(p.radius ?? 0.7, p.tube ?? 0.18, 96, 20);
    case 'capsule':
      return new THREE.CapsuleGeometry(p.radius ?? 0.4, p.length ?? 1.0, 12, 24);
    case 'dish': {
      const pts: THREE.Vector2[] = [];
      const r = p.radius ?? 0.75;
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        pts.push(new THREE.Vector2(t * r, t * t * 0.35));
      }
      pts.push(new THREE.Vector2(r * 0.96, 0.37));
      pts.push(new THREE.Vector2(0, 0.04));
      return new THREE.LatheGeometry(pts, 36);
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
        bevelThickness: 0.03,
        bevelSize: 0.02,
        bevelSegments: 2,
      });
      geo.rotateX(Math.PI / 2);
      geo.center();
      return geo;
    }
    default:
      return new THREE.BoxGeometry(1, 1, 1);
  }
}

export const ThreeViewport: React.FC<ThreeViewportProps> = ({
  sceneName = 'Vela 3D Scene',
  objects,
  lights,
  cameraConfig,
  bgColor = '#090D16',
  onSelectPreset,
  activePresetId,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [explode, setExplode] = useState(0);
  const [finish, setFinish] = useState<FinishMode>('vela');
  const [playing, setPlaying] = useState(true);
  const [dockOpen, setDockOpen] = useState(true);
  const [selectedPart, setSelectedPart] = useState<Scene3DObject | null>(null);
  const [webglError, setWebglError] = useState<string | null>(null);

  const explodeRef = useRef(explode);
  const finishRef = useRef(finish);
  const playingRef = useRef(playing);
  const cameraPresetRef = useRef<{ pos: [number, number, number]; target: [number, number, number] } | null>(null);

  useEffect(() => { explodeRef.current = explode; }, [explode]);
  useEffect(() => { finishRef.current = finish; }, [finish]);
  useEffect(() => { playingRef.current = playing; }, [playing]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareGl();
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: 'high-performance',
      });
    } catch {
      setWebglError('WebGL2 context unavailable in this browser.');
      return;
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setSize(container.clientWidth || 800, container.clientHeight || 540);

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const bgCol = new THREE.Color(bgColor || '#090D16');
    scene.background = bgCol;
    scene.fog = new THREE.FogExp2(bgCol.getHex(), 0.032);

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 540;
    const camPos = cameraConfig?.position ?? [5.2, 3.6, 6.2];
    const camTarget = cameraConfig?.target ?? [0, 1.0, 0];

    const camera = new THREE.PerspectiveCamera(cameraConfig?.fov ?? 44, width / height, 0.1, 150);
    camera.position.set(camPos[0], camPos[1], camPos[2]);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(camTarget[0], camTarget[1], camTarget[2]);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.maxDistance = 24;
    controls.minDistance = 2;

    // 3-point studio lighting + hemisphere fill
    const hemi = new THREE.HemisphereLight('#B8D4F5', '#1E293B', 0.9);
    scene.add(hemi);

    const keyConfig = lights?.find((l) => l.kind === 'directional');
    const keyLight = new THREE.DirectionalLight(keyConfig?.color ?? '#FFF6E8', keyConfig?.intensity ?? 2.5);
    keyLight.position.set(...(keyConfig?.position ?? [6, 9, 5]));
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight('#38BDF8', 1.1);
    rimLight.position.set(-6, 4, -5);
    scene.add(rimLight);

    // Subtle studio floor grid + contact shadow plane
    const gridHelper = new THREE.GridHelper(14, 28, '#1E293B', '#111827');
    gridHelper.position.y = -0.02;
    scene.add(gridHelper);

    const shadowTex = createContactShadowTexture();
    const shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(6.5, 6.5),
      new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.7 })
    );
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.y = -0.01;
    scene.add(shadowPlane);

    // Build Composite Procedural Group from Vela AST objects
    const rootGroup = new THREE.Group();
    scene.add(rootGroup);

    const solarTex = createSolarGridTexture();
    solarTex.anisotropy = renderer.capabilities.getMaxAnisotropy();

    const meshRecords: {
      mesh: THREE.Mesh;
      obj: Scene3DObject;
      basePos: THREE.Vector3;
      explodeVec: THREE.Vector3;
      origMat: THREE.MeshPhysicalMaterial;
    }[] = [];

    for (const obj of objects) {
      const geo = buildGeometry(obj);
      const isWing = obj.geometry === 'wing';
      const mat = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(obj.material.color),
        roughness: obj.material.roughness,
        metalness: obj.material.metalness,
        clearcoat: obj.material.clearcoat ?? 0.3,
        emissive: new THREE.Color(obj.material.emissive || '#000000'),
        emissiveIntensity: obj.material.emissiveIntensity ?? 0,
        map: isWing ? solarTex : null,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(...obj.position);
      mesh.rotation.set(...obj.rotation);
      mesh.scale.set(...obj.scale);
      mesh.castShadow = !isSoftwareGl;
      mesh.receiveShadow = !isSoftwareGl;
      mesh.userData = { velaObj: obj };
      rootGroup.add(mesh);
      meshRecords.push({
        mesh,
        obj,
        basePos: new THREE.Vector3(...obj.position),
        explodeVec: new THREE.Vector3(...(obj.explodeVec ?? [0, 0.5, 0])),
        origMat: mat,
      });
    }

    // Raycasting on click
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const onPointerDown = (ev: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(meshRecords.map((r) => r.mesh), false);
      if (hits.length > 0) {
        const picked = hits[0].object.userData.velaObj as Scene3DObject;
        setSelectedPart(picked);
      }
    };
    renderer.domElement.addEventListener('pointerdown', onPointerDown);

    // Cancel scripted camera move when user drags
    const onControlsStart = () => {
      cameraPresetRef.current = null;
    };
    controls.addEventListener('start', onControlsStart);

    // Resize observer
    const onResize = () => {
      if (!container) return;
      const w = container.clientWidth || 800;
      const h = container.clientHeight || 540;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(container);

    let frameId = 0;
    let disposed = false;
    let currentExplode = 0;
    const clock = new THREE.Clock();
    const _targetVec = new THREE.Vector3();

    function applyFinish(rec: (typeof meshRecords)[number], mode: FinishMode) {
      const m = rec.origMat;
      m.wireframe = mode === 'wireframe';
      if (mode === 'vela') {
        m.color.set(rec.obj.material.color);
        m.roughness = rec.obj.material.roughness;
        m.metalness = rec.obj.material.metalness;
      } else if (mode === 'titanium') {
        m.color.set('#CBD5E1');
        m.roughness = 0.22;
        m.metalness = 0.94;
      } else if (mode === 'gold') {
        m.color.set('#EAB308');
        m.roughness = 0.18;
        m.metalness = 0.96;
      } else if (mode === 'clay') {
        m.color.set('#E2E8F0');
        m.roughness = 0.85;
        m.metalness = 0.05;
      }
    }

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (!gl || typeof gl.fenceSync !== 'function') {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    let lastFinish: FinishMode = 'vela';
    function tick() {
      if (disposed) return;
      const dt = Math.min(clock.getDelta(), 0.1);

      if (finishRef.current !== lastFinish) {
        lastFinish = finishRef.current;
        for (const r of meshRecords) applyFinish(r, lastFinish);
      }

      currentExplode = THREE.MathUtils.damp(currentExplode, explodeRef.current, 8, dt);

      for (const r of meshRecords) {
        _targetVec.copy(r.basePos).addScaledVector(r.explodeVec, currentExplode);
        r.mesh.position.copy(_targetVec);

        if (playingRef.current) {
          if (r.obj.spin) {
            r.mesh.rotation.x += r.obj.spin[0] * dt;
            r.mesh.rotation.y += r.obj.spin[1] * dt;
            r.mesh.rotation.z += r.obj.spin[2] * dt;
          }
        }
      }

      if (playingRef.current && !objects.some((o) => o.spin)) {
        rootGroup.rotation.y += dt * 0.25;
      }

      if (cameraPresetRef.current) {
        const p = cameraPresetRef.current;
        camera.position.x = THREE.MathUtils.damp(camera.position.x, p.pos[0], 6, dt);
        camera.position.y = THREE.MathUtils.damp(camera.position.y, p.pos[1], 6, dt);
        camera.position.z = THREE.MathUtils.damp(camera.position.z, p.pos[2], 6, dt);
        controls.target.x = THREE.MathUtils.damp(controls.target.x, p.target[0], 6, dt);
        controls.target.y = THREE.MathUtils.damp(controls.target.y, p.target[1], 6, dt);
        controls.target.z = THREE.MathUtils.damp(controls.target.z, p.target[2], 6, dt);
        if (
          Math.abs(camera.position.x - p.pos[0]) < 0.02 &&
          Math.abs(camera.position.y - p.pos[1]) < 0.02 &&
          Math.abs(camera.position.z - p.pos[2]) < 0.02
        ) {
          cameraPresetRef.current = null;
        }
      }

      controls.update();
      renderer.render(scene, camera);

      if (isSoftwareGl) afterDraw(tick);
      else frameId = requestAnimationFrame(tick);
    }

    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      ro.disconnect();
      controls.removeEventListener('start', onControlsStart);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      controls.dispose();
      solarTex.dispose();
      shadowTex.dispose();
      for (const r of meshRecords) {
        r.mesh.geometry.dispose();
        r.origMat.dispose();
      }
      renderer.dispose();
    };
  }, [objects, lights, cameraConfig, bgColor]);

  const setCamPreset = (pos: [number, number, number], target: [number, number, number] = [0, 1.0, 0]) => {
    cameraPresetRef.current = { pos, target };
  };

  return (
    <div className="relative w-full h-[580px] rounded-xl overflow-hidden border border-white/10 bg-[#090D16]">
      {/* Isolated WebGL canvas mount */}
      <div ref={mountRef} className="w-full h-full" />

      {webglError && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0B0F17] text-slate-300 text-sm">
          {webglError}
        </div>
      )}

      {/* Minimal Top-Left Scene Spec Header */}
      <div className="absolute top-4 left-4 z-10 pointer-events-auto flex items-center gap-4">
        <div className="bg-[#0B0F17]/90 border border-white/10 rounded-lg px-3.5 py-2">
          <div className="text-sm font-semibold text-white font-display">{sceneName}</div>
          <div className="text-xs text-slate-400 tabular-nums">
            {objects.length} procedural parts · Click any mesh to inspect
          </div>
        </div>

        {onSelectPreset && (
          <div className="flex items-center gap-1 p-1 rounded-lg bg-[#0B0F17]/90 border border-white/10">
            <button
              onClick={() => onSelectPreset('model3d_sat')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
                activePresetId === 'model3d_sat' ? 'bg-teal-500 text-slate-950' : 'text-slate-300 hover:text-white'
              }`}
            >
              Orbital Satellite
            </button>
            <button
              onClick={() => onSelectPreset('model3d_gear')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
                activePresetId === 'model3d_gear' ? 'bg-teal-500 text-slate-950' : 'text-slate-300 hover:text-white'
              }`}
            >
              Planetary Gearbox
            </button>
            <button
              onClick={() => {
                const objText = exportSceneToObj(sceneName, objects);
                const blob = new Blob([objText], { type: 'text/plain;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${sceneName.replace(/\s+/g, '_').toLowerCase()}.obj`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
              }}
              className="px-2.5 py-1 text-xs font-medium rounded-md text-teal-300 hover:bg-white/10 flex items-center gap-1 whitespace-nowrap"
              title="Download Wavefront .obj 3D mesh"
            >
              <Download className="w-3.5 h-3.5" />
              .OBJ
            </button>
          </div>
        )}
      </div>

      {/* Selected Part Inspector (compact top-right readout only when clicked) */}
      {selectedPart && (
        <div className="absolute top-4 right-4 z-10 bg-[#0B0F17]/92 border border-white/10 rounded-lg px-3.5 py-2.5 text-xs max-w-[230px]">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="font-semibold text-white">{selectedPart.name}</span>
            <button onClick={() => setSelectedPart(null)} className="text-slate-400 hover:text-white">
              Close
            </button>
          </div>
          <div className="text-slate-400 space-y-0.5 tabular-nums font-mono">
            <div>geometry: {selectedPart.geometry}</div>
            <div>role: {selectedPart.role}</div>
            <div>metalness: {selectedPart.material.metalness.toFixed(2)}</div>
            <div>roughness: {selectedPart.material.roughness.toFixed(2)}</div>
          </div>
        </div>
      )}

      {/* Unified Collapsible Bottom Control Dock */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 w-[min(860px,94%)] flex flex-col items-center">
        <button
          onClick={() => setDockOpen((v) => !v)}
          className="mb-1.5 px-3 py-1 rounded-md bg-[#0B0F17]/90 border border-white/10 text-[11px] font-medium text-slate-300 hover:text-white flex items-center gap-1.5 whitespace-nowrap"
        >
          {dockOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          {dockOpen ? 'Hide Controls' : 'Show Controls'}
        </button>

        {dockOpen && (
          <div className="w-full bg-[#0B0F17]/92 border border-white/10 rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-4">
            {/* Exploded View Slider */}
            <label className="flex items-center gap-2.5 text-xs text-slate-300 whitespace-nowrap">
              <span>Explode</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={explode}
                onChange={(e) => setExplode(Number(e.target.value))}
                className="w-24 accent-teal-400 cursor-pointer"
              />
              <span className="w-8 font-mono tabular-nums text-slate-400">{Math.round(explode * 100)}%</span>
            </label>

            {/* Material Finishes */}
            <div className="flex items-center gap-1 bg-white/5 p-0.5 rounded-lg">
              {(['vela', 'titanium', 'gold', 'clay', 'wireframe'] as FinishMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setFinish(mode)}
                  className={`px-2 py-1 text-xs rounded-md capitalize whitespace-nowrap transition-colors ${
                    finish === mode ? 'bg-teal-500 text-slate-950 font-medium' : 'text-slate-300 hover:text-white'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>

            {/* Camera Views & Spin */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setCamPreset([5.2, 3.6, 6.2])}
                className="px-2 py-1 text-xs rounded bg-white/5 hover:bg-white/10 text-slate-300 whitespace-nowrap"
              >
                Iso
              </button>
              <button
                onClick={() => setCamPreset([0, 1.2, 7.2])}
                className="px-2 py-1 text-xs rounded bg-white/5 hover:bg-white/10 text-slate-300 whitespace-nowrap"
              >
                Front
              </button>
              <button
                onClick={() => setCamPreset([0.1, 7.5, 0.5])}
                className="px-2 py-1 text-xs rounded bg-white/5 hover:bg-white/10 text-slate-300 whitespace-nowrap"
              >
                Top
              </button>
              <button
                onClick={() => setPlaying((p) => !p)}
                className="p-1.5 rounded bg-white/5 hover:bg-white/10 text-slate-200"
                title={playing ? 'Pause animation' : 'Play animation'}
              >
                {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={() => {
                  setExplode(0);
                  setFinish('vela');
                  setCamPreset(cameraConfig?.position ?? [5.2, 3.6, 6.2], cameraConfig?.target ?? [0, 1.0, 0]);
                }}
                className="p-1.5 rounded bg-white/5 hover:bg-white/10 text-slate-200"
                title="Reset camera"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
