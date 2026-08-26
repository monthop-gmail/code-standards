/**
 * Money is carried as integer minor units (satang, cents) everywhere in this
 * service. Floats are never used for amounts — 0.1 + 0.2 problems in a payment
 * comparison would silently reject or accept the wrong charge.
 */
export interface Money {
  readonly amountMinorUnits: number;
  readonly currency: string;
}

/** ISO-4217 codes are always compared upper-cased; gateways are inconsistent about case. */
export function normalizeCurrency(currency: string): string {
  return currency.trim().toUpperCase();
}

function minorUnitDigits(currency: string): number {
  // Intl knows the exponent per currency (JPY 0, THB/USD 2, KWD 3) — hardcoding
  // "divide by 100" breaks the moment a zero-decimal currency is enabled.
  const options = new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions();
  return options.maximumFractionDigits ?? 2;
}

/**
 * Formats an amount for humans (emails, logs meant for support).
 *
 * Intl accepts any well-formed 3-letter code and falls back to 2 decimals for
 * ones it does not know (verified: "XYZ" -> "XYZ 5.00"), but it throws a
 * RangeError on a malformed code such as "TH1". That case degrades to a plain
 * "<minor units> <currency>" rendering rather than blowing up in the middle of
 * a payment that has already been captured.
 */
export function formatMoney(money: Money, locale = 'en-US'): string {
  const currency = normalizeCurrency(money.currency);
  try {
    const digits = minorUnitDigits(currency);
    const majorUnits = money.amountMinorUnits / 10 ** digits;
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(majorUnits);
  } catch {
    return `${money.amountMinorUnits} ${currency}`;
  }
}

export function isSameMoney(a: Money, b: Money): boolean {
  return (
    a.amountMinorUnits === b.amountMinorUnits && normalizeCurrency(a.currency) === normalizeCurrency(b.currency)
  );
}
