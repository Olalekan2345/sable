import { cn } from "@/lib/cn";

/**
 * The Sable mark.
 *
 * The supplied artwork, served from `public/sable-mark.png`.
 *
 * ## What was done to the file, and why
 *
 * The original is `public/sable-logo.jpg` — a 1905×2048 render on its own near-black ground.
 * JPEG carries no alpha channel, so placing it directly would have put an opaque dark
 * rectangle behind the mark in every position it appears. The shipped PNG is that same
 * artwork with the background removed: pixels below the sampled background luminance are made
 * transparent, and connected regions smaller than the artwork's three real pieces — the
 * crest, the shield-and-S, and the keyhole — are dropped, which clears the compression
 * speckle a plain threshold leaves behind. Nothing in the artwork itself was altered.
 *
 * It is then trimmed to its own bounds and scaled to 256px wide, which covers four-times
 * retina at the largest size the interface uses it (32px). The full-resolution original stays
 * in `public/` for decks, the README and social posts.
 *
 * ## Why `object-contain`
 *
 * The artwork is taller than it is wide (1188×1561). Every call site sizes the mark with a
 * square box — `h-6 w-6` and the like — so without this the shield would be squashed.
 */
export function SableMark({ className }: { className?: string }) {
  // A fixed-size static mark gains nothing from the image pipeline, and `next/image` would
  // add a wrapper element that breaks the inline layout of the lockup.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/sable-mark.png"
      alt=""
      aria-hidden="true"
      className={cn("h-7 w-7 object-contain", className)}
    />
  );
}

/** The full lockup: mark plus wordmark. */
export function SableLogo({
  className,
  showMark = true,
  size = "md",
}: {
  className?: string;
  showMark?: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const wordmark = {
    sm: "text-[15px] tracking-[0.16em]",
    md: "text-[17px] tracking-[0.18em]",
    lg: "text-[22px] tracking-[0.2em]",
  }[size];

  const mark = { sm: "h-5 w-5", md: "h-6 w-6", lg: "h-8 w-8" }[size];

  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      {showMark ? <SableMark className={mark} /> : null}
      <span className={cn("font-semibold uppercase text-[var(--color-primary)]", wordmark)}>
        Sable
      </span>
    </span>
  );
}
