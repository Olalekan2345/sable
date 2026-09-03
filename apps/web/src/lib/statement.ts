"use client";

import { NETWORK_LABEL, assetSymbol, formatAmount } from "@sable/config";

/**
 * Private statement generation.
 *
 * The PDF is built **entirely in the browser**. Decrypted figures are never sent to a
 * server, an API route, or a third-party rendering service — doing so would hand a
 * plaintext balance to exactly the party the protocol exists to keep it from.
 *
 * ## What a Sable statement can and cannot say
 *
 * A conventional statement opens with a balance brought forward and reconciles every
 * movement to a closing figure. Sable cannot produce that, and the reason is structural
 * rather than a missing feature: every FHE operation yields a *new* ciphertext handle, and
 * the protocol does not retain superseded handles or grant decryption rights over them. The
 * historical amounts are not withheld — they are genuinely unrecoverable, by anyone,
 * including the account owner.
 *
 * So the statement reports what is actually true: the dated movements that occurred, and
 * the position as at the moment of generation, decrypted under the holder's own
 * authorisation. Inventing an opening balance to make the layout look familiar would be
 * fabricating financial data, which is not a trade worth making for a tidier document.
 */

export interface StatementMovement {
  date: Date;
  description: string;
  txHash: string;
}

export interface StatementData {
  account: string;
  periodStart: Date;
  periodEnd: Date;
  generatedAt: Date;
  /** Decrypted savings balance at generation time. */
  closingPosition: bigint | null;
  /** Decrypted unclaimed rewards at generation time. */
  unclaimedRewards: bigint | null;
  movements: StatementMovement[];
}

const MARGIN = 56;

/** Builds the statement and hands the browser a download. Nothing leaves the page. */
export async function generateStatementPdf(data: StatementData): Promise<void> {
  const { jsPDF } = await import("jspdf");

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const contentWidth = pageWidth - MARGIN * 2;

  let y = MARGIN;

  // ---------------------------------------------------------------- Masthead
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(17, 18, 15);
  doc.text("SABLE", MARGIN, y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(120, 120, 115);
  doc.text("Private Savings Statement", MARGIN, y + 16);

  doc.setFontSize(8);
  doc.text(NETWORK_LABEL, pageWidth - MARGIN, y, { align: "right" });
  doc.text(
    `Generated ${data.generatedAt.toISOString().slice(0, 16).replace("T", " ")} UTC`,
    pageWidth - MARGIN,
    y + 12,
    { align: "right" },
  );

  y += 34;
  rule(doc, y, MARGIN, contentWidth);
  y += 26;

  // ------------------------------------------------------------------ Account
  y = section(doc, "Account", y, MARGIN);

  doc.setFont("courier", "normal");
  doc.setFontSize(9);
  doc.setTextColor(40, 40, 38);
  doc.text(data.account, MARGIN, y);
  y += 20;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(90, 90, 86);
  doc.text(
    `Statement period: ${formatPeriod(data.periodStart)} — ${formatPeriod(data.periodEnd)}`,
    MARGIN,
    y,
  );
  y += 30;

  // ----------------------------------------------------------------- Position
  y = section(doc, "Position", y, MARGIN);

  y = row(
    doc,
    "Closing savings position",
    data.closingPosition !== null
      ? `${formatAmount(data.closingPosition)} ${assetSymbol()}`
      : "Not authorised",
    y,
    MARGIN,
    contentWidth,
  );

  y = row(
    doc,
    "Unclaimed prize rewards",
    data.unclaimedRewards !== null
      ? `${formatAmount(data.unclaimedRewards)} ${assetSymbol()}`
      : "Not authorised",
    y,
    MARGIN,
    contentWidth,
  );

  y = row(
    doc,
    "Total",
    data.closingPosition !== null && data.unclaimedRewards !== null
      ? `${formatAmount(data.closingPosition + data.unclaimedRewards)} ${assetSymbol()}`
      : "Not authorised",
    y,
    MARGIN,
    contentWidth,
    true,
  );

  y += 8;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(130, 130, 125);
  y = wrap(
    doc,
    "Figures are as at the generation time above, decrypted under your own authorisation.",
    MARGIN,
    y,
    contentWidth,
    11,
  );
  y += 20;

  // ---------------------------------------------------------------- Movements
  y = section(doc, "Movements in period", y, MARGIN);

  if (data.movements.length === 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(120, 120, 115);
    doc.text("No activity during this period.", MARGIN, y);
    y += 26;
  } else {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 115);
    doc.text("DATE", MARGIN, y);
    doc.text("DESCRIPTION", MARGIN + 90, y);
    doc.text("AMOUNT", MARGIN + contentWidth, y, { align: "right" });
    y += 6;
    rule(doc, y, MARGIN, contentWidth);
    y += 16;

    for (const movement of data.movements) {
      if (y > doc.internal.pageSize.getHeight() - 120) {
        doc.addPage();
        y = MARGIN;
      }

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(40, 40, 38);
      doc.text(movement.date.toISOString().slice(0, 10), MARGIN, y);
      doc.text(movement.description, MARGIN + 90, y);

      doc.setTextColor(130, 130, 125);
      doc.text("Private", MARGIN + contentWidth, y, { align: "right" });

      y += 13;

      doc.setFont("courier", "normal");
      doc.setFontSize(7);
      doc.setTextColor(160, 160, 155);
      doc.text(movement.txHash, MARGIN + 90, y);

      y += 18;
    }
  }

  y += 6;
  rule(doc, y, MARGIN, contentWidth);
  y += 20;

  // ------------------------------------------------------------------- Notice
  y = section(doc, "About this statement", y, MARGIN);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(110, 110, 106);

  y = wrap(
    doc,
    "Per-transaction amounts are not shown because they are not recoverable. Each confidential " +
      "operation produces a new ciphertext, and Sable does not retain superseded ciphertexts or " +
      "grant decryption rights over them — so historical amounts cannot be read by anyone, " +
      "including you. The dated movements above are drawn from public transaction logs, which " +
      "record that an action occurred but never how much.",
    MARGIN,
    y,
    contentWidth,
    11,
  );

  y += 10;

  y = wrap(
    doc,
    `This statement was generated locally in your browser. No decrypted figure was transmitted ` +
      `anywhere. Sable is a testnet protocol on ${NETWORK_LABEL}; ${assetSymbol()} is a test asset ` +
      `with no monetary value and is not redeemable.`,
    MARGIN,
    y,
    contentWidth,
    11,
  );

  const filename = `sable-statement-${data.periodStart.getUTCFullYear()}-${String(
    data.periodStart.getUTCMonth() + 1,
  ).padStart(2, "0")}.pdf`;

  doc.save(filename);
}

/* ------------------------------------------------------------------ helpers */

function rule(doc: import("jspdf").jsPDF, y: number, x: number, width: number): void {
  doc.setDrawColor(220, 219, 214);
  doc.setLineWidth(0.6);
  doc.line(x, y, x + width, y);
}

function section(doc: import("jspdf").jsPDF, title: string, y: number, x: number): number {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(150, 150, 145);
  doc.text(title.toUpperCase(), x, y);
  return y + 18;
}

function row(
  doc: import("jspdf").jsPDF,
  label: string,
  value: string,
  y: number,
  x: number,
  width: number,
  emphasis = false,
): number {
  doc.setFont("helvetica", emphasis ? "bold" : "normal");
  doc.setFontSize(10);
  doc.setTextColor(emphasis ? 17 : 70, emphasis ? 18 : 70, emphasis ? 15 : 66);
  doc.text(label, x, y);
  doc.text(value, x + width, y, { align: "right" });
  return y + 18;
}

function wrap(
  doc: import("jspdf").jsPDF,
  text: string,
  x: number,
  y: number,
  width: number,
  lineHeight: number,
): number {
  const lines = doc.splitTextToSize(text, width) as string[];
  for (const line of lines) {
    doc.text(line, x, y);
    y += lineHeight;
  }
  return y;
}

function formatPeriod(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
