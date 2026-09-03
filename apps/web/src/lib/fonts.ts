import { Plus_Jakarta_Sans } from "next/font/google";

/**
 * One typeface, everywhere.
 *
 * **Plus Jakarta Sans** carries the whole interface — body, headings, labels, and the machine
 * data that used to be set in a monospace. A geometric grotesque with enough warmth to avoid
 * the clinical feel of the usual fintech default, chosen to sit in the register of a modern
 * consumer bank rather than a crypto dashboard.
 *
 * It is a stand-in for a face that cannot be shipped: Monzo's headline type is Monzo Sans,
 * commissioned and proprietary, and the ABC Favorit they used before it is a commercial
 * licence from ABC Dinamo. Neither is redistributable. This is the nearest freely-licensed
 * equivalent, and `next/font` self-hosts it at build time so no request leaves the page.
 *
 * The serif and monospace families this file used to load were dropped rather than left
 * loading unused — three families were three sets of font files on every first paint, and
 * nothing references them now.
 */
export const interfaceSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans-face",
  // 800 is carried for display headings, which is where the resemblance actually lives.
  weight: ["400", "500", "600", "700", "800"],
});

export const fontVariables = interfaceSans.variable;
