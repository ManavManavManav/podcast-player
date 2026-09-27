"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  curvePath,
  growthAt,
  layoutGarden,
  plantProgress,
  stages,
  type FlowerKind,
  type Garden as GardenLayout,
  type Leaf,
  type Point,
} from "@/lib/garden";
import { usePlayback, usePlayer } from "@/store/player";

/**
 * Stick plants along a horizon, growing with the episode (lib/garden.ts).
 * Line art in the ink colour, faint behind the pages and a little stronger
 * behind Now Playing. Growth follows the playhead, eased, so a seek glides
 * to the new stage instead of snapping; jump to the start and it's bare
 * landscape again.
 */
export function Garden({ variant = "page" }: { variant?: "page" | "stage" }) {
  const episode = usePlayer((s) => s.episode);
  // The episode's length is the whole blossoming (the feed's figure until the audio reports its own).
  // Quantized, so steady playback redraws every so often rather than every tick.
  const target = usePlayback((s) => Math.round(growthAt(s.currentTime, s.duration || episode?.duration || 0) * 2000) / 2000);
  const growth = useEased(episode ? target : 0);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const seed = episode ? Math.imul(episode.podcastId ^ 0x2f6e5a1b, 0x9e3779b1) >>> 0 : 0;

  useEffect(() => {
    const el = box.current!;
    const measure = () => setSize({ width: Math.round(el.clientWidth), height: Math.round(el.clientHeight) });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const layout: GardenLayout | null = useMemo(
    () => (size && size.width > 0 && size.height > 0 ? layoutGarden(seed, size.width, size.height) : null),
    [seed, size],
  );

  const stage = variant === "stage";
  return (
    <div
      ref={box}
      aria-hidden="true"
      data-garden={variant}
      className={`pointer-events-none text-text transition-opacity duration-700 ${
        stage ? "absolute inset-x-0 bottom-0 z-0 h-[62vh] opacity-40" : "fixed inset-x-0 bottom-0 -z-10 h-[min(46vh,420px)]"
      } ${episode ? (stage ? "" : "opacity-25") : "opacity-0"}`}
    >
      {layout && (
        <svg width={layout.width} height={layout.height} className="block" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
          <path d={layout.ground} strokeWidth={1.25} />
          {layout.marks.map((d, i) => (
            <path key={i} d={d} strokeWidth={1} />
          ))}
          {layout.plants.map((plant, i) => {
            const p = plantProgress(plant, growth);
            if (p <= 0) return null;
            const s = stages(p);
            return (
              <g key={i} strokeWidth={1.25}>
                <path d={curvePath(plant.stem)} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - s.stem} />
                {plant.leaves.map((leaf, l) => (
                  <LeafShape key={`l${l}`} leaf={leaf} open={s.part(leaf.appears)} />
                ))}
                {plant.branches.map((branch, b) => {
                  const grown = s.part(branch.appears);
                  if (grown <= 0) return null;
                  return (
                    <g key={`b${b}`}>
                      <path d={curvePath(branch.curve)} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - grown} />
                      <LeafShape leaf={branch.leaf} open={Math.min(1, Math.max(0, (grown - 0.6) / 0.4))} />
                    </g>
                  );
                })}
                {s.stem >= 1 && s.bloom <= 0 && <circle cx={plant.flower.at.x} cy={plant.flower.at.y} r={2.5} fill="currentColor" />}
                {s.bloom > 0 && <Flower {...plant.flower} open={s.bloom} />}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

/** An outlined almond, unfolding from where it joins. */
function LeafShape({ leaf, open }: { leaf: Leaf; open: number }) {
  if (open <= 0) return null;
  const l = leaf.length;
  const w = l * 0.32;
  return (
    <path
      d={`M0 0 Q${l / 2} ${-w} ${l} 0 Q${l / 2} ${w} 0 0`}
      transform={`translate(${leaf.at.x} ${leaf.at.y}) rotate(${(leaf.angle * 180) / Math.PI}) scale(${open})`}
      vectorEffect="non-scaling-stroke"
    />
  );
}

/** A flower at the stem's tip, opening from its centre. */
function Flower({ kind, at, size, angle, open }: { kind: FlowerKind; at: Point; size: number; angle: number; open: number }) {
  const r = size;
  let shape: React.ReactNode;
  if (kind === "daisy") {
    shape = (
      <>
        {Array.from({ length: 7 }, (_, i) => (
          <ellipse key={i} cx={r * 0.55} cy={0} rx={r * 0.38} ry={r * 0.14} transform={`rotate(${(i * 360) / 7})`} vectorEffect="non-scaling-stroke" />
        ))}
        <circle r={r * 0.16} fill="currentColor" />
      </>
    );
  } else if (kind === "tulip") {
    shape = (
      <g transform={`rotate(${(angle * 180) / Math.PI + 90})`}>
        <path
          d={`M${-r * 0.5} 0 Q${-r * 0.6} ${-r} ${-r * 0.2} ${-r * 1.1} L0 ${-r * 0.7} L${r * 0.2} ${-r * 1.1} Q${r * 0.6} ${-r} ${r * 0.5} 0 Q0 ${r * 0.3} ${-r * 0.5} 0`}
          vectorEffect="non-scaling-stroke"
        />
      </g>
    );
  } else {
    shape = (
      <>
        {Array.from({ length: 8 }, (_, i) => {
          const a = (i * Math.PI) / 4;
          return <line key={i} x1={Math.cos(a) * r * 0.3} y1={Math.sin(a) * r * 0.3} x2={Math.cos(a) * r} y2={Math.sin(a) * r} vectorEffect="non-scaling-stroke" />;
        })}
        <circle r={r * 0.12} fill="currentColor" />
      </>
    );
  }
  return <g transform={`translate(${at.x} ${at.y}) scale(${open})`}>{shape}</g>;
}

/** Follows `target` smoothly (about a second to settle), so jumps glide instead of snapping. */
function useEased(target: number, tau = 0.45) {
  const [value, setValue] = useState(target);
  const current = useRef(target);
  useEffect(() => {
    // With reduced motion, go straight there.
    const instant = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const diff = target - current.current;
      if (instant || Math.abs(diff) < 0.0005) {
        current.current = target;
        setValue(target);
        return;
      }
      current.current += diff * (1 - Math.exp(-dt / tau));
      setValue(current.current);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, tau]);
  return value;
}
