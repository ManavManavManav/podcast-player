/**
 * The garden: stick plants along a horizon that grow and blossom as an
 * episode goes on. Growth follows the playhead, not the sound: the episode's
 * length is the whole blossoming, so halfway through the garden is halfway
 * grown, at the end it's in full bloom, and at the start it's bare
 * landscape. Each plant has its own slot in that span, so they come up one
 * after another.
 *
 * Everything here is pure and seeded (a show always grows the same garden);
 * components/garden/Garden.tsx draws it.
 */

/** How far the garden has grown at `time` in an episode `duration` seconds long (0–1). Unknown length: bare. */
export function growthAt(time: number, duration: number): number {
  if (!(duration > 0)) return 0;
  return Math.min(1, Math.max(0, time / duration));
}

/** A small, fast seeded random generator (mulberry32). */
export function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type FlowerKind = "daisy" | "tulip" | "star";

export interface Point {
  x: number;
  y: number;
}

/** A cubic curve, as an SVG path's start, two controls and end. */
export interface Curve {
  from: Point;
  c1: Point;
  c2: Point;
  to: Point;
}

export interface Leaf {
  /** Where it joins its stem or branch. */
  at: Point;
  /** Direction it points, radians. */
  angle: number;
  length: number;
  /** Stem progress (0–1) at which it starts to unfold. */
  appears: number;
}

export interface Branch {
  curve: Curve;
  /** Stem progress (0–1) at which it starts to grow. */
  appears: number;
  /** A leaf at its tip. */
  leaf: Leaf;
}

export interface Plant {
  stem: Curve;
  branches: Branch[];
  leaves: Leaf[];
  flower: { kind: FlowerKind; at: Point; size: number; angle: number };
  /** Its slot in the episode: growth (0–1) at which it starts, and ends. */
  start: number;
  end: number;
}

export interface Garden {
  width: number;
  height: number;
  /** The horizon, as an SVG path. */
  ground: string;
  /** Ground level at x. */
  groundAt: (x: number) => number;
  /** Small marks on the ground: pebbles and tufts of grass, as SVG paths. */
  marks: string[];
  plants: Plant[];
}

/** A point along a cubic curve. */
export function pointOn(c: Curve, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const d = 3 * u * t * t;
  const e = t * t * t;
  return {
    x: a * c.from.x + b * c.c1.x + d * c.c2.x + e * c.to.x,
    y: a * c.from.y + b * c.c1.y + d * c.c2.y + e * c.to.y,
  };
}

export function curvePath(c: Curve): string {
  const f = (p: Point) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  return `M${f(c.from)} C${f(c.c1)} ${f(c.c2)} ${f(c.to)}`;
}

/** Lays out a show's garden for a `width` × `height` strip (the ground runs along its foot). */
export function layoutGarden(seed: number, width: number, height: number): Garden {
  const rand = seeded(seed);
  const between = (a: number, b: number) => a + (b - a) * rand();
  const base = height - 18;

  // A gently rolling horizon: two slow waves.
  const w1 = { f: between(1.2, 2.2), p: rand() * Math.PI * 2, a: between(3, 7) };
  const w2 = { f: between(3, 5), p: rand() * Math.PI * 2, a: between(1, 3) };
  const groundAt = (x: number) =>
    base + w1.a * Math.sin((x / width) * Math.PI * 2 * w1.f + w1.p) + w2.a * Math.sin((x / width) * Math.PI * 2 * w2.f + w2.p);
  const steps = Math.max(12, Math.round(width / 24));
  let ground = "";
  for (let i = 0; i <= steps; i++) {
    const x = (i / steps) * width;
    ground += `${i ? "L" : "M"}${x.toFixed(1)} ${groundAt(x).toFixed(1)}`;
  }

  // Pebbles and tufts, always there: the landscape before anything grows.
  const marks: string[] = [];
  const markCount = Math.round(width / 70);
  for (let i = 0; i < markCount; i++) {
    const x = between(8, width - 8);
    const y = groundAt(x);
    if (rand() < 0.45) {
      const w = between(4, 9);
      marks.push(`M${(x - w).toFixed(1)} ${(y + 0.5).toFixed(1)} Q${x.toFixed(1)} ${(y - w * 0.8).toFixed(1)} ${(x + w).toFixed(1)} ${(y + 0.5).toFixed(1)}`);
    } else {
      const blades = 2 + Math.floor(rand() * 3);
      let tuft = "";
      for (let b = 0; b < blades; b++) {
        const bx = x + (b - blades / 2) * 3;
        const tip = { x: bx + between(-4, 4), y: y - between(5, 11) };
        tuft += `M${bx.toFixed(1)} ${y.toFixed(1)} Q${(bx + (tip.x - bx) * 0.2).toFixed(1)} ${(y - 4).toFixed(1)} ${tip.x.toFixed(1)} ${tip.y.toFixed(1)}`;
      }
      marks.push(tuft);
    }
  }

  // The plants: spread along the ground, each with its own slot in the episode.
  const count = Math.max(3, Math.min(9, Math.round(width / 170)));
  const order = Array.from({ length: count }, (_, i) => i).sort(() => rand() - 0.5);
  const kinds: FlowerKind[] = ["daisy", "tulip", "star"];
  const plants: Plant[] = [];
  for (let i = 0; i < count; i++) {
    const x = ((i + 0.5) / count) * width + between(-0.25, 0.25) * (width / count);
    const y = groundAt(x);
    const tall = between(0.5, 0.92) * (height - 40);
    const lean = between(-0.18, 0.18) * tall;
    const stem: Curve = {
      from: { x, y },
      c1: { x: x + between(-0.1, 0.1) * tall, y: y - tall * 0.35 },
      c2: { x: x + lean * 0.6 + between(-0.08, 0.08) * tall, y: y - tall * 0.72 },
      to: { x: x + lean, y: y - tall },
    };
    const branches: Branch[] = [];
    const branchCount = 1 + Math.floor(rand() * 3);
    for (let b = 0; b < branchCount; b++) {
      const t = between(0.25, 0.7);
      const from = pointOn(stem, t);
      const side = b % 2 ? 1 : -1;
      const reach = tall * between(0.14, 0.26);
      const to = { x: from.x + side * reach, y: from.y - reach * between(0.5, 1) };
      branches.push({
        curve: {
          from,
          c1: { x: from.x + side * reach * 0.35, y: from.y - reach * 0.05 },
          c2: { x: to.x - side * reach * 0.15, y: to.y + reach * 0.25 },
          to,
        },
        appears: t,
        leaf: { at: to, angle: Math.atan2(to.y - from.y, to.x - from.x), length: between(9, 15), appears: t },
      });
    }
    const leaves: Leaf[] = [];
    const leafCount = 1 + Math.floor(rand() * 3);
    for (let l = 0; l < leafCount; l++) {
      const t = between(0.15, 0.6);
      const at = pointOn(stem, t);
      const side = l % 2 ? 1 : -1;
      leaves.push({ at, angle: -Math.PI / 2 + side * between(0.7, 1.2), length: between(10, 18), appears: t });
    }
    const slot = order[i] / count;
    const start = slot * 0.62;
    plants.push({
      stem,
      branches,
      leaves,
      flower: { kind: kinds[Math.floor(rand() * kinds.length)], at: stem.to, size: between(9, 16), angle: Math.atan2(stem.to.y - stem.c2.y, stem.to.x - stem.c2.x) },
      start,
      end: Math.min(1, start + between(0.3, 0.42)),
    });
  }
  return { width, height, ground, groundAt, marks, plants };
}

/** How far a plant has grown (0–1) when the garden has grown `growth`. */
export function plantProgress(plant: Pick<Plant, "start" | "end">, growth: number): number {
  return Math.min(1, Math.max(0, (growth - plant.start) / (plant.end - plant.start)));
}

/**
 * A plant's stages from its progress: the stem draws up over the first 60%,
 * leaves and branches unfold as it passes them, and the flower opens at the end.
 */
export function stages(progress: number) {
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  return {
    stem: clamp(progress / 0.6),
    /** How open a leaf or branch that appears at stem progress `at` is. */
    part: (at: number) => clamp((progress / 0.6 - at) / 0.3),
    bloom: clamp((progress - 0.8) / 0.2),
  };
}
