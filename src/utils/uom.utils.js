/**
 * UOM (Unit of Measure) Utility Functions
 *
 * Provides chainable UOM conversion support via convertFrom field.
 * Example:
 *   baseUnit: "ဖာ"
 *   conversions: [
 *     { unit: "ဘူး",  factor: 10,  convertFrom: null },        // 1ဘူး = 10ဖာ
 *     { unit: "ပုံး", factor: 12,  convertFrom: "ဘူး" },       // 1ပုံး = 12ဘူး = 120ဖာ
 *   ]
 *   getEffectiveFactor(conversions, "ဖာ", "ပုံး") → 12 × 10 = 120
 */

/**
 * Get the effective conversion factor from base unit to the target unit.
 * Handles chained conversions by recursively resolving convertFrom references.
 *
 * @param {Array} uomConversions - Array of { unit, factor, convertFrom }
 * @param {string} baseUnit - The base unit of measure (e.g., "piece", "ဖာ")
 * @param {string} targetUnit - The unit to convert to
 * @param {Set} [visited] - Internal: tracks visited units for circular detection
 * @returns {number} The effective factor (1 if no conversion found)
 */
export function getEffectiveFactor(uomConversions, baseUnit, targetUnit, visited = new Set()) {
  if (!targetUnit || !baseUnit) return 1;
  if (targetUnit.toLowerCase() === baseUnit.toLowerCase()) return 1;

  // Circular reference detection
  const key = targetUnit.toLowerCase();
  if (visited.has(key)) {
    console.error(`Circular UOM reference detected for unit: ${targetUnit}`);
    return 1;
  }
  visited.add(key);

  const conv = (uomConversions || []).find(
    (c) => c.unit && c.unit.toLowerCase() === key
  );

  if (!conv) return 1;

  // If convertFrom is specified and not the base unit, resolve the chain
  if (conv.convertFrom && conv.convertFrom.toLowerCase() !== baseUnit.toLowerCase()) {
    const parentFactor = getEffectiveFactor(uomConversions, baseUnit, conv.convertFrom, visited);
    return conv.factor * parentFactor;
  }

  return conv.factor;
}

/**
 * Get all valid unit options for a product (base unit + conversions).
 *
 * @param {string} baseUnit
 * @param {Array} uomConversions
 * @returns {Array<{ value: string, label: string, isBase: boolean, convertFrom?: string }>}
 */
export function getUnitOptions(baseUnit, uomConversions) {
  const options = [{ value: baseUnit, label: baseUnit, isBase: true }];
  for (const c of uomConversions || []) {
    if (c.unit && !options.some((o) => o.value === c.unit)) {
      options.push({
        value: c.unit,
        label: c.convertFrom
          ? `${c.unit} (1${c.unit} = ${c.factor}${c.convertFrom})`
          : `${c.unit} (1${c.unit} = ${c.factor}${baseUnit})`,
        isBase: false,
        convertFrom: c.convertFrom || null,
      });
    }
  }
  return options;
}

/**
 * Validate UOM conversions for consistency.
 * Checks: duplicate units, invalid convertFrom references, circular refs.
 *
 * @param {string} baseUnit
 * @param {Array} uomConversions
 * @returns {string|null} Error message or null if valid
 */
export function validateUomConversions(baseUnit, uomConversions) {
  if (!baseUnit) return "Unit of measure is required";
  if (!uomConversions || uomConversions.length === 0) return null;

  const unitNames = new Set(uomConversions.map((c) => c.unit?.toLowerCase()));

  for (const conv of uomConversions) {
    if (!conv.unit) return "Each conversion unit must not be empty";
    if (conv.factor <= 0) return "Conversion factor must be greater than 0";

    const unitLower = conv.unit.toLowerCase();
    if (unitLower === baseUnit.toLowerCase()) {
      return `Conversion unit "${conv.unit}" must not be the same as base unit "${baseUnit}"`;
    }

    // Check for duplicate unit names
    const sameUnitCount = uomConversions.filter(
      (c) => c.unit?.toLowerCase() === unitLower
    ).length;
    if (sameUnitCount > 1) return `Duplicate conversion unit "${conv.unit}"`;

    // Validate convertFrom reference
    if (conv.convertFrom) {
      const cfLower = conv.convertFrom.toLowerCase();
      if (cfLower !== baseUnit.toLowerCase() && !unitNames.has(cfLower)) {
        return `convertFrom unit "${conv.convertFrom}" not found. Must be base unit or another conversion unit.`;
      }
    }
  }

  // Check for circular references
  try {
    for (const conv of uomConversions) {
      if (conv.convertFrom) {
        const visited = new Set();
        let current = conv.unit.toLowerCase();
        while (current) {
          if (visited.has(current)) {
            return `Circular reference detected involving unit "${conv.unit}"`;
          }
          visited.add(current);
          const next = uomConversions.find(
            (c) => c.unit?.toLowerCase() === current
          );
          if (!next || !next.convertFrom) break;
          current = next.convertFrom.toLowerCase();
        }
      }
    }
  } catch {
    return "Invalid UOM conversion configuration";
  }

  return null;
}

/**
 * Calculate the display label for a conversion unit.
 */
export function getConversionLabel(conv, baseUnit) {
  if (conv.convertFrom) {
    return `${conv.unit} (×${conv.factor} ${conv.convertFrom})`;
  }
  return `${conv.unit} (×${conv.factor} ${baseUnit})`;
}
