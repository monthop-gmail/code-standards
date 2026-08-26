'use strict';

const { AppError } = require('../errors/AppError');

/**
 * All money is handled as integer minor units (satang / cents).
 *
 * The legacy code multiplied floats repeatedly (`price * 0.95 * 0.9`), so
 * totals such as 0.1 + 0.2 = 0.30000000000000004 were written straight into
 * the database and into the SQL string. Integers make every intermediate
 * value exact and every rounding decision explicit.
 */

/** Convert a DB/API value to integer minor units. mysql2 returns DECIMAL as a string. */
function toMinorUnits(value) {
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (typeof numeric !== 'number' || !Number.isFinite(numeric)) {
    throw new AppError('INVALID_AMOUNT', 'Encountered a non-numeric monetary value.', 500);
  }
  return Math.round(numeric * 100);
}

/** Convert integer minor units back to a 2-decimal major-unit number for API output. */
function toMajorUnits(minor) {
  assertInteger(minor);
  return Math.round(minor) / 100;
}

/** Apply a fractional rate (e.g. 0.05 for 5%) and round half-up to the nearest minor unit. */
function applyRate(minor, rate) {
  assertInteger(minor);
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0 || rate > 1) {
    throw new AppError('INVALID_RATE', 'Discount rate must be between 0 and 1.', 500);
  }
  return Math.round(minor * rate);
}

/** Clamp to zero — a discount must never produce a negative amount owed. */
function atLeastZero(minor) {
  assertInteger(minor);
  return minor < 0 ? 0 : minor;
}

function assertInteger(minor) {
  if (!Number.isInteger(minor)) {
    throw new AppError('INVALID_AMOUNT', 'Monetary amounts must be integer minor units.', 500);
  }
}

module.exports = { toMinorUnits, toMajorUnits, applyRate, atLeastZero, assertInteger };
