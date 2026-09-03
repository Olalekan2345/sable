import { FinalCta } from "@/components/landing/final-cta";
import { Hero } from "@/components/landing/hero";
import { Principal } from "@/components/landing/principal";
import { PrivacyDifference } from "@/components/landing/privacy-difference";
import { PrizeLadder } from "@/components/landing/prize-ladder";
import { Rollover } from "@/components/landing/rollover";
import { TimeWeighting } from "@/components/landing/time-weighting";
import { TwoWays } from "@/components/landing/two-ways";
import { Verifiable } from "@/components/landing/verifiable";
import { ZamaSteps } from "@/components/landing/zama-steps";
import { SiteFooter } from "@/components/shell/site-footer";
import { SiteHeader } from "@/components/shell/site-header";

/**
 * The landing page.
 *
 * Ordered as an argument rather than a feature tour: what it is, the choice it gives you,
 * why that choice stays private, why holding longer matters, what you can win, what happens
 * when nobody wins, how you can check any of it, why your principal is safe, and only then
 * how the cryptography works.
 */
export default function LandingPage() {
  return (
    <>
      <SiteHeader />

      <main id="main">
        <Hero />
        <TwoWays />
        <PrivacyDifference />
        <TimeWeighting />
        <PrizeLadder />
        <Rollover />
        <Verifiable />
        <Principal />
        <ZamaSteps />
        <FinalCta />
      </main>

      <SiteFooter />
    </>
  );
}
