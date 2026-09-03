import { ButtonLink } from "@/components/ui/button";
import { SableMark } from "@/components/brand/logo";

export default function NotFound() {
  return (
    <main id="main" className="flex min-h-dvh flex-col items-center justify-center px-5 text-center">
      <SableMark className="mb-8 h-8 w-8" />

      <p className="text-eyebrow mb-5">404</p>
      <h1 className="text-display text-[clamp(2rem,5vw,3rem)] text-[var(--color-primary)]">
        Nothing here.
      </h1>
      <p className="mt-5 max-w-[44ch] text-[15px] leading-relaxed text-[var(--color-secondary)]">
        This page does not exist. Your savings are unaffected — they live in a contract, not in a
        URL.
      </p>

      <div className="mt-9 flex flex-col gap-3 sm:flex-row">
        <ButtonLink href="/" size="md">
          Back to Sable
        </ButtonLink>
        <ButtonLink href="/app" size="md" variant="outline">
          Open dashboard
        </ButtonLink>
      </div>
    </main>
  );
}
