// The camera path, as a function of scroll progress s (0 to 1).
//
// One perspective camera does the whole page. On the sheet it hangs far above
// the house with a lens of 2 degrees, which flattens perspective until the
// model reads as a drawing. Coming down, the lens opens and the distance
// shrinks together, so there is never a cut.

import { CUT_PLAN, CUT_OPEN } from './plan';

const io = (t: number) => t * t * (3 - 2 * t);
const io5 = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lin = (t: number) => t;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const rad = Math.PI / 180;

function track(keys: [number, number, ((t: number) => number)?][]) {
  return (s: number) => {
    if (s <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      if (s <= keys[i][0]) {
        const t = (s - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]);
        const e = (keys[i][2] ?? lin)(t);
        return keys[i - 1][1] + (keys[i][1] - keys[i - 1][1]) * e;
      }
    }
    return keys[keys.length - 1][1];
  };
}

function glide(keys: [number, number][]) {
  const n = keys.length;
  const xs = keys.map((k) => k[0]), ys = keys.map((k) => k[1]);
  const d: number[] = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (2 * d[i - 1] * d[i]) / (d[i - 1] + d[i]);
  return (s: number) => {
    if (s <= xs[0]) return ys[0];
    if (s >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (s > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (s - xs[i]) / h;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

export const STOPS = { sheetEnd: 0.06, liftEnd: 0.34, landed: 0.58, walk: 0.64, end: 1 };

export interface RigState {
  s: number;
  cut: number;
  fogNear: number;
  fogFar: number;
  fov: number;
  pitch: number;
  yaw: number;
  x: number;
  y: number;
  z: number;
  dist: number;
  door: number;
  hall: number;
  near: number;
  far: number;
}

export interface FrameDef {
  cx: number;
  cn: number;
  w: number;
  h: number;
}

export interface Rig {
  at: (s: number) => RigState;
  frame: FrameDef;
  portrait: boolean;
  fovWalk: number;
}

export function makeRig(aspect: number): Rig {
  const portrait = aspect < 0.9;
  const fovWalk = portrait ? 76 : aspect < 1.5 ? 58 : 50;
  const F0 = portrait ? 82 : 60;
  const cn = portrait ? 24.2 : 17.2;
  const cx = portrait ? 2.4 : 3.0 - 0.26 * ((F0 * aspect) / 2);
  const frame: FrameDef = { cx, cn, w: F0 * aspect, h: F0 };

  const L = Math.log, T = (deg: number) => Math.tan((deg * rad) / 2);
  const DOOR_Z = 0.2;
  const REST_Z = 8.2;
  const landFrame = 2 * (REST_Z - DOOR_Z) * T(fovWalk);
  const { sheetEnd: s1, liftEnd: s2, landed: s3 } = STOPS;

  const early = (t: number) => 0.5 * io(t) + 0.5 * (1 - (1 - t) * (1 - t));
  const elev = track([[0, 90], [s1, 90], [s2, 33, early], [s3, 0, io]]);
  const fovL = track([[0, L(T(2))], [s1, L(T(2))], [s2, L(T(4.6)), io], [s3, L(T(fovWalk)), io5]]);
  const frmL = track([[0, L(F0)], [s1, L(F0)], [s2, L(portrait ? 62 : 46), io], [s3, L(landFrame), io5]]);
  const tx = track([[0, cx], [s1, cx], [s2, portrait ? 3.0 : 2.4, io], [s3, 0.15, io]]);
  const ty = track([[0, 0], [s1, 0], [s2, 1.2, io], [s3, 1.45, io]]);
  const tz = track([[0, -cn], [s1, -cn], [s2, -15.5, io], [s3, DOOR_Z, io]]);
  const cut = track([[0, CUT_PLAN], [s1 + 0.01, CUT_PLAN], [s2, 2.64, io], [0.455, 2.69, lin], [0.555, CUT_OPEN, io]]);
  const fogN = track([[0, L(4000)], [s2, L(4000)], [s3, L(26), io]]);
  const fogF = track([[0, L(9000)], [s2, L(9000)], [s3, L(92), io]]);

  const pz = glide([[s3, REST_Z], [0.64, 7.85], [0.76, 4.5], [0.88, 1.0], [0.96, -0.62], [1, -0.9]]);

  function at(sIn: number): RigState {
    const s = clamp01(sIn);
    const cutVal = cut(s);
    const fogNear = Math.exp(fogN(s));
    const fogFar = Math.exp(fogF(s));

    let fov = 2;
    let pitch = 0;
    let yaw = 0;
    let x = 0;
    let y = 0;
    let z = 0;
    let dist = 0;
    let door = 0;
    let hall = 0;

    if (s <= s3) {
      const e = elev(s) * rad;
      const tanHalf = Math.exp(fovL(s));
      dist = Math.exp(frmL(s)) / (2 * tanHalf);
      fov = (2 * Math.atan(tanHalf)) / rad;
      pitch = -e;
      yaw = 0;
      x = tx(s);
      y = ty(s) + dist * Math.sin(e);
      z = tz(s) + dist * Math.cos(e);
      door = 0;
      hall = 0;
    } else {
      z = pz(s);
      fov = fovWalk;
      yaw = 0;
      pitch = -4.5 * rad * io(clamp01((1.6 - z) / 2.4));
      x = 0.15;
      y = 1.45 + 0.15 * io(clamp01((3.4 - z) / 1.2));
      dist = 8;
      door = io(clamp01((6.9 - z) / 4.4));
      hall = clamp01((1.35 - z) / 2.1);
    }

    const near = Math.max(0.08, (y - 7) * 0.6);
    const far = y > 60 ? y * 1.6 + 500 : 700;

    return {
      s,
      cut: cutVal,
      fogNear,
      fogFar,
      fov,
      pitch,
      yaw,
      x,
      y,
      z,
      dist,
      door,
      hall,
      near,
      far,
    };
  }

  return { at, frame, portrait, fovWalk };
}
