/**
 * Unit Barcode — batch barcode နောက်တွင် factor ထည့်ခြင်း
 *   B000001      → base unit (scan 1 = base 1)
 *   B000001-10   → factor 10 unit (ဥပမာ ပုံး, scan 1 = base 10)
 *   B000001-120  → factor 120 unit (ဥပမာ ဖာ)
 * Unit အမည် (မြန်မာ) ကို Code128 ဖြင့် encode မရ၍ factor ကိုသာ ထည့်သည်။
 */
import { getEffectiveFactor } from "./uom.utils.js";

const UNIT_SUFFIX = /^(.+)-(\d+)$/;

/**
 * @param {string} code - scan လုပ်သော barcode
 * @returns {{ baseBarcode: string, factor: number, hasSuffix: boolean }}
 */
export function parseUnitBarcode(code) {
  const trimmed = String(code || "").trim();
  const match = trimmed.match(UNIT_SUFFIX);
  if (match) {
    const factor = parseInt(match[2], 10);
    if (factor > 0) {
      return { baseBarcode: match[1], factor, hasSuffix: true };
    }
  }
  return { baseBarcode: trimmed, factor: 1, hasSuffix: false };
}

/**
 * @param {string} batchBarcode
 * @param {number} factor - base unit အရေအတွက် (1 ဆိုလျှင် suffix မထည့်)
 */
export function buildUnitBarcode(batchBarcode, factor) {
  return factor && factor !== 1 ? `${batchBarcode}-${factor}` : batchBarcode;
}

/**
 * Factor နှင့် ကိုက်သော unit ကို product ၏ base/conversion unit များမှ ရှာသည်
 * @returns {{ unit: string|null, ambiguous: boolean }}
 */
export function resolveUnitByFactor(inventory, factor) {
  const baseUnit = inventory?.unitOfMeasure || null;
  if (factor === 1) return { unit: baseUnit, ambiguous: false };

  const conversions = inventory?.uomConversions || [];
  const matches = conversions
    .filter((c) => c.unit)
    .filter((c) => getEffectiveFactor(conversions, baseUnit, c.unit) === factor)
    .map((c) => c.unit);

  return { unit: matches[0] || null, ambiguous: matches.length > 1 };
}
