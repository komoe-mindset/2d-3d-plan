import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';

import { PAPER, INK, GROUND_Y, SUN_ELEV, SUN_HEADING } from './lib/plan';
import { CUT, SWEEP_PLANES, setRoomReveal, makeMaterials, texturesReady, setAnisotropy, contactShadowMaterial } from './lib/materials';
import { buildHouse } from './lib/house';
import { buildSheet } from './lib/sheet';
import { makeRig, Rig } from './lib/rig';

const RAIL_STOPS = [
  { at: 0, label: '01 Sheet' },
  { at: 0.06, label: '02 Lift' },
  { at: 0.56, label: '03 Forecourt' },
  { at: 0.8, label: '04 Hall' },
];

export const App: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const grainRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);

  const [hudState, setHudState] = useState({
    lens: '2.0°',
    height: '1 718 m',
    cut: '+1.20 m',
  });
  const [activeRail, setActiveRail] = useState(0);
  const [loading, setLoading] = useState(true);

  const lenisRef = useRef<Lenis | null>(null);
  const scrollToStop = useCallback((atProgress: number) => {
    if (lenisRef.current) {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      lenisRef.current.scrollTo(atProgress * max, { duration: 1.4, easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)) });
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let destroyed = false;
    gsap.registerPlugin(ScrollTrigger);

    // Renderer setup
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.localClippingEnabled = true;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;
    setAnisotropy(renderer.capabilities.getMaxAnisotropy());

    // Scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(PAPER);
    scene.fog = new THREE.Fog(new THREE.Color(PAPER), 4000, 9000);
    scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.3;

    // Camera
    const camera = new THREE.PerspectiveCamera(2, window.innerWidth / window.innerHeight, 1, 5000);
    camera.rotation.order = 'YXZ';

    // The paper plane
    const paper = new THREE.Mesh(
      new THREE.PlaneGeometry(9000, 9000),
      new THREE.MeshBasicMaterial({ color: PAPER, toneMapped: false, fog: false })
    );
    paper.rotation.x = -Math.PI / 2;
    paper.position.y = GROUND_Y;
    scene.add(paper);

    // Ink line configurations
    const LINE: Record<string, { w: number; color: string; cut?: boolean; dashed?: boolean }> = {
      structure: { w: 1.2, color: INK, cut: true },
      furniture: { w: 0.85, color: INK, cut: true },
      anno: { w: 0.8, color: INK },
      thin: { w: 0.55, color: INK },
      hatch: { w: 0.5, color: '#aaa69c' },
      dash: { w: 0.6, color: INK, dashed: true },
    };

    const planesFor = (room: string, cut = false) => {
      const p: THREE.Plane[] = [];
      if (cut) p.push(CUT);
      if (SWEEP_PLANES[room]) p.push(SWEEP_PLANES[room]);
      return p;
    };

    const lineMats: LineMaterial[] = [];
    function lines(kind: string, room: string, positions: number[]) {
      const k = LINE[kind];
      const g = new LineSegmentsGeometry();
      g.setPositions(positions);
      const m = new LineMaterial({
        color: new THREE.Color(k.color).getHex(),
        linewidth: k.w,
        worldUnits: false,
        fog: true,
        dashed: !!k.dashed,
        dashSize: 0.34,
        gapSize: 0.2,
        clippingPlanes: planesFor(room, k.cut),
      });
      (m as any).toneMapped = false;
      m.resolution.set(window.innerWidth, window.innerHeight);
      lineMats.push(m);
      const l = new LineSegments2(g, m);
      if (k.dashed) l.computeLineDistances();
      l.frustumCulled = false;
      l.renderOrder = 1;
      return l;
    }

    // The House
    const M = makeMaterials();
    const H = buildHouse();
    const house = new THREE.Group();
    scene.add(house);

    const solid = (geo: THREE.BufferGeometry, mat: THREE.Material, shadows = true) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = shadows;
      m.receiveShadow = shadows;
      house.add(m);
      return m;
    };

    for (const key in H.shell.geos) solid(H.shell.geos[key], M[key]);
    for (const key in H.roof.geos) solid(H.roof.geos[key], key === 'ceiling' ? M.ceiling : M.generic);
    for (const key in H.kit.b) {
      const mat = key.split('|')[1];
      const mesh = solid(H.bucketToGeometry(H.kit.b[key]), M[mat], mat !== 'glass' && mat !== 'lamp');
      if (mat === 'glass') mesh.renderOrder = 3;
    }
    for (const room in H.shell.edges) house.add(lines('structure', room, H.shell.edges[room]));
    for (const room in H.roof.edges) house.add(lines('structure', room, H.roof.edges[room]));
    for (const room in H.kit.e) house.add(lines('furniture', room, H.kit.e[room]));

    // Front door
    const door = new THREE.Group();
    door.position.copy(H.door.pivot);
    const leaf = new THREE.Mesh(H.door.leaf, M.oakDoor);
    const pull = new THREE.Mesh(H.door.pull, M.bronze);
    leaf.castShadow = leaf.receiveShadow = pull.castShadow = true;
    door.add(leaf, pull, lines('furniture', 'hall', H.door.edges));
    house.add(door);

    // Contact shadows
    const contact = (x0: number, n0: number, x1: number, n1: number, y: number, strength: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, n1 - n0), contactShadowMaterial(strength));
      m.rotation.x = -Math.PI / 2;
      m.position.set((x0 + x1) / 2, y, -(n0 + n1) / 2);
      m.renderOrder = 2;
      house.add(m);
    };
    contact(-2.25, 2.7, -1.2, 5.7, 0.006, 0.55);
    contact(1.2, 2.8, 2.25, 5.1, 0.006, 0.6);
    contact(-2.0, 6.0, -1.05, 6.95, 0.006, 0.6);
    contact(-2.1, 3.2, -1.4, 3.9, 0.826, 0.5);
    contact(-2.0, 4.75, -1.5, 5.32, 0.826, 0.45);

    // Lighting
    const el = (SUN_ELEV * Math.PI) / 180;
    const sunDir = new THREE.Vector3(SUN_HEADING[0] * Math.cos(el), -Math.sin(el), SUN_HEADING[1] * Math.cos(el)).normalize();
    const sun = new THREE.DirectionalLight(0xffc98f, 11);
    sun.target.position.set(0, 1, -4);
    sun.position.copy(sun.target.position).addScaledVector(sunDir, -70);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    Object.assign(sun.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 10, far: 140 });
    sun.shadow.bias = -0.0002;
    sun.shadow.normalBias = 0.015;
    scene.add(sun, sun.target);
    scene.add(new THREE.HemisphereLight(0xeef2f8, 0xdccfb9, 0.72));

    const bounce1 = new THREE.PointLight(0xffd3a6, 6, 8, 2);
    bounce1.position.set(0.5, 0.75, -2.8);
    const bounce2 = new THREE.PointLight(0xffcfa0, 5, 8, 2);
    bounce2.position.set(1.1, 1.0, -5.0);
    const sky = new THREE.PointLight(0xe4ecff, 6, 11, 2);
    sky.position.set(-0.4, 1.9, -0.2);
    scene.add(bounce1, bounce2, sky);

    // Rig and Sheet
    let rig: Rig;
    let sheet: ReturnType<typeof buildSheet> | null = null;
    let sheetGroup: THREE.Group | null = null;

    function layout() {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      rig = makeRig(w / h);

      lineMats.forEach((m) => m.resolution.set(w, h));

      if (sheetGroup) {
        scene.remove(sheetGroup);
        sheet?.dispose();
        sheetGroup.traverse((o: any) => {
          if (o.isLineSegments2) {
            o.geometry.dispose();
            o.material.dispose();
          }
        });
      }

      const pxPerMetre = h / rig.frame.h;
      sheet = buildSheet({
        frame: rig.frame,
        portrait: rig.portrait,
        labelScale: Math.min(1.25, Math.max(1, 15 / pxPerMetre)),
        anisotropy: renderer.capabilities.getMaxAnisotropy(),
        planesFor: (room) => planesFor(room),
      });

      sheetGroup = new THREE.Group();
      sheetGroup.add(sheet.group);
      for (const key in sheet.lines) {
        const [kind, room] = key.split('|');
        sheetGroup.add(lines(kind, room, sheet.lines[key]));
      }
      scene.add(sheetGroup);
    }

    const sp = (v: number) => Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

    function draw(s: number) {
      if (!rig || destroyed) return;
      const o = rig.at(s);

      camera.position.set(o.x, o.y, o.z);
      camera.rotation.set(o.pitch, o.yaw, 0);
      camera.fov = o.fov;
      camera.near = o.near;
      camera.far = o.far;
      camera.updateProjectionMatrix();

      CUT.constant = o.cut;
      if (scene.fog && 'near' in scene.fog) {
        scene.fog.near = o.fogNear;
        scene.fog.far = o.fogFar;
      }
      door.rotation.y = o.door * 1.5;
      setRoomReveal('hall', o.hall);

      if (o.hall > 0) renderer.shadowMap.needsUpdate = true;
      renderer.render(scene, camera);

      // Update HUD
      const above = o.y - GROUND_Y;
      setHudState({
        lens: o.fov.toFixed(1) + '°',
        height: above > 20 ? sp(above) + ' m' : above.toFixed(2) + ' m',
        cut: o.cut > 5.3 ? 'none' : '+' + o.cut.toFixed(2) + ' m',
      });

      // Update rail active index
      let cur = 0;
      for (let i = 0; i < RAIL_STOPS.length; i++) {
        if (s >= RAIL_STOPS[i].at - 0.01) cur = i;
      }
      setActiveRail(cur);

      // Grain opacity
      if (grainRef.current) {
        grainRef.current.style.opacity = (0.5 * (1 - o.hall)).toFixed(3);
      }
    }

    // Scroll timeline
    const proxy = { s: 0 };
    const tl = gsap.timeline({ paused: true, defaults: { ease: 'none' } });
    tl.to(proxy, { s: 1, duration: 1 }, 0);
    tl.to('#hero', { autoAlpha: 0, y: -30, duration: 0.04 }, 0.035);

    const cap = (sel: string, a: number, b: number | null) => {
      tl.fromTo(sel, { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, duration: 0.03 }, a);
      if (b !== null) tl.to(sel, { autoAlpha: 0, y: -16, duration: 0.03 }, b);
    };
    cap('#cap-lift', 0.1, 0.3);
    cap('#cap-fore', 0.56, 0.67);
    cap('#cap-hall', 0.94, null);

    let drawn = -1;
    function tick() {
      if (proxy.s !== drawn) {
        drawn = proxy.s;
        draw(drawn);
      }
    }

    let scrollTriggerInstance: ScrollTrigger | null = null;
    let lenis: Lenis | null = null;

    async function boot() {
      try {
        await Promise.race([
          Promise.all([
            document.fonts.load('400 20px "IBM Plex Mono"'),
            document.fonts.load('500 20px "IBM Plex Mono"'),
            document.fonts.load('400 40px "Instrument Serif"'),
            document.fonts.load('italic 400 40px "Instrument Serif"'),
          ]),
          new Promise((r) => setTimeout(r, 2500)),
        ]);
      } catch (err) {
        console.warn('Font loading note:', err);
      }

      await texturesReady();
      if (destroyed) return;

      layout();
      for (const m of Object.values(M)) m.needsUpdate = true;
      draw(0);

      lenis = new Lenis({ lerp: 0.085, wheelMultiplier: 0.9 });
      lenisRef.current = lenis;

      lenis.on('scroll', ScrollTrigger.update);
      gsap.ticker.add((t) => lenis?.raf(t * 1000));
      gsap.ticker.lagSmoothing(0);

      scrollTriggerInstance = ScrollTrigger.create({
        trigger: '#track',
        start: 'top top',
        end: 'bottom bottom',
        scrub: 0.8,
        animation: tl,
      });

      gsap.ticker.add(tick);

      // Hero animations
      gsap.from('#hero h1 .l > span', {
        yPercent: 105,
        duration: 1.3,
        ease: 'expo.out',
        stagger: 0.12,
        delay: 0.25,
      });
      gsap.from('#hero .eyebrow, #hero .lede, #hero .cue, #bar', {
        autoAlpha: 0,
        y: 12,
        duration: 1,
        ease: 'power2.out',
        stagger: 0.08,
        delay: 0.6,
      });

      setLoading(false);
    }

    const onResize = () => {
      layout();
      drawn = -1;
      draw(proxy.s);
    };
    window.addEventListener('resize', onResize);

    boot().catch((err) => {
      console.error('Error booting 3D experience:', err);
      setLoading(false);
    });

    return () => {
      destroyed = true;
      window.removeEventListener('resize', onResize);
      gsap.ticker.remove(tick);
      if (scrollTriggerInstance) scrollTriggerInstance.kill();
      if (lenis) lenis.destroy();
      renderer.dispose();
      sheet?.dispose();
    };
  }, []);

  return (
    <div className="relative min-h-screen bg-[#f1eee6] text-[#17171a] font-mono selection:bg-[#17171a] selection:text-[#f1eee6]">
      <canvas id="gl" ref={canvasRef} aria-hidden="true" />
      <div id="grain" ref={grainRef} aria-hidden="true" />

      {/* Top Header Bar */}
      <header id="bar">
        <span className="mark">Sample Home Design</span>
        <span id="hud" className="chip" aria-hidden="true">
          <span>
            LENS <b id="hud-lens">{hudState.lens}</b>
          </span>
          <span>
            HEIGHT <b id="hud-height">{hudState.height}</b>
          </span>
          <span>
            CUT <b id="hud-cut">{hudState.cut}</b>
          </span>
        </span>
      </header>

      {/* Hero Section */}
      <section id="hero" className="overlay">
        <p className="eyebrow">
          Coll de Marès, Mallorca <span className="wide">&nbsp;·&nbsp; Ground floor plan</span> &nbsp;·&nbsp; A-101
        </p>
        <h1>
          <span className="l">
            <span>A house</span>
          </span>
          <span className="l">
            <span>
              on <em>one line.</em>
            </span>
          </span>
        </h1>
        <p className="lede">
          <span className="wide">Forty metres from the front door to the tree in the courtyard. </span>
          This drawing is the building. Scroll and walk into it.
        </p>
        <p className="cue">
          <i></i> Scroll
        </p>
      </section>

      {/* Informative Captions */}
      <aside id="cap-lift" className="overlay cap">
        <p className="no">02 &nbsp; The lift</p>
        <p className="say">The plan was never a picture. It is the house, cut at 1.2 m. Now the cut rises.</p>
      </aside>

      <aside id="cap-fore" className="overlay cap">
        <p className="no">03 &nbsp; The forecourt</p>
        <p className="say">Eight metres to the door. Everything ahead is still ink.</p>
      </aside>

      <aside id="cap-hall" className="overlay cap">
        <p className="no">04 &nbsp; Entrance hall &nbsp; 4.00 × 7.00</p>
        <p className="say">Limestone, oak, lime plaster. The living room is next, and it is still a drawing.</p>
      </aside>

      {/* Navigation Stop Rail */}
      <nav id="rail" aria-label="Walkthrough navigation">
        {RAIL_STOPS.map((stop, idx) => (
          <button
            key={stop.label}
            type="button"
            className={activeRail === idx ? 'on' : ''}
            onClick={() => scrollToStop(stop.at)}
          >
            {stop.label}
          </button>
        ))}
      </nav>

      {/* Loading Overlay */}
      <div id="loading" className={!loading ? 'done' : ''}>
        <span>Drawing the plan</span>
      </div>

      {/* Scroll track for Lenis + ScrollTrigger */}
      <main id="track" ref={trackRef} />
    </div>
  );
};

export default App;
