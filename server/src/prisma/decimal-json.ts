import { Prisma } from "@prisma/client";

/**
 * Money columns are stored as exact decimals. When sent to the browser (or kept in the activity
 * log) they become ordinary numbers instead of strings, so the website can do arithmetic and
 * formatting on them directly. Amounts stay far below the size where numbers lose precision.
 */
(Prisma.Decimal.prototype as unknown as { toJSON: () => number }).toJSON = function toJSON(this: Prisma.Decimal) {
  return this.toNumber();
};
