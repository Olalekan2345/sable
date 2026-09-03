"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/cn";

/**
 * The lattice backdrop.
 *
 * A sparse field of points with occasional connecting edges, evoking the lattice problems
 * FHE security rests on. Rendered as SVG rather than WebGL: the composition needs perhaps
 * two hundred elements, and shipping a 3D runtime for that would cost more than the effect
 * is worth — particularly on the phones this page will mostly be read on.
 *
 * Points are laid out from a seeded pseudo-random sequence so the server and client agree
 * on the markup; `Math.random` here would hydrate-mismatch on every load.
 */

function seeded(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
}

interface Point {
  x: number;
  y: number;
  r: number;
  delay: number;
  bright: boolean;
}

export function Lattice({
  className,
  density = 90,
  seed = 7,
}: {
  className?: string;
  density?: number;
  seed?: number;
}) {
  const { points, edges } = useMemo(() => {
    const random = seeded(seed);
    const generated: Point[] = [];

    for (let i = 0; i < density; i++) {
      generated.push({
        x: random() * 100,
        y: random() * 100,
        r: 0.12 + random() * 0.2,
        delay: random() * 6,
        bright: random() > 0.86,
      });
    }

    // Connect only genuinely close pairs, so the field reads as structure rather than noise.
    const connections: [Point, Point][] = [];
    for (let i = 0; i < generated.length; i++) {
      for (let j = i + 1; j < generated.length; j++) {
        const a = generated[i]!;
        const b = generated[j]!;
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (distance < 11) connections.push([a, b]);
      }
    }

    return { points: generated, edges: connections.slice(0, 70) };
  }, [density, seed]);

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className={cn("pointer-events-none absolute inset-0 h-full w-full", className)}
    >
      <g stroke="var(--color-hairline)" strokeWidth="0.06">
        {edges.map(([a, b], index) => (
          <line key={index} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
        ))}
      </g>

      <g>
        {points.map((point, index) => (
          <circle
            key={index}
            cx={point.x}
            cy={point.y}
            r={point.r}
            fill={point.bright ? "var(--color-accent)" : "var(--color-quaternary)"}
            opacity={point.bright ? 0.55 : 0.4}
          >
            {point.bright ? (
              <animate
                attributeName="opacity"
                values="0.2;0.75;0.2"
                dur="5s"
                begin={`${point.delay}s`}
                repeatCount="indefinite"
              />
            ) : null}
          </circle>
        ))}
      </g>
    </svg>
  );
}

const GLYPHS = "0123456789ABCDEF";

/**
 * A vertical stream of hex glyphs, suggesting ciphertext in flight.
 *
 * Starts from a fixed seeded string and only begins mutating after mount, which keeps
 * server and client markup identical while still feeling alive.
 */
export function CipherStream({
  className,
  rows = 14,
  columns = 8,
  interval = 220,
}: {
  className?: string;
  rows?: number;
  columns?: number;
  interval?: number;
}) {
  const initial = useMemo(() => {
    const random = seeded(31);
    return Array.from({ length: rows }, () =>
      Array.from({ length: columns }, () => GLYPHS[Math.floor(random() * 16)] ?? "0").join(""),
    );
  }, [rows, columns]);

  const [lines, setLines] = useState(initial);
  const frame = useRef(0);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (media.matches) return;

    const id = window.setInterval(() => {
      frame.current += 1;
      setLines((current) =>
        current.map((line, index) => {
          // Mutate one row per tick so the field shimmers rather than boils.
          if ((frame.current + index) % rows !== 0) return line;
          return line
            .split("")
            .map((char) => (Math.random() > 0.7 ? GLYPHS[Math.floor(Math.random() * 16)] ?? char : char))
            .join("");
        }),
      );
    }, interval);

    return () => window.clearInterval(id);
  }, [rows, interval]);

  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none select-none font-mono text-[10px] leading-[1.7] text-[var(--color-quaternary)]",
        className,
      )}
    >
      {lines.map((line, index) => (
        <div key={index} style={{ opacity: 0.16 + (index / lines.length) * 0.34 }}>
          {line}
        </div>
      ))}
    </div>
  );
}
