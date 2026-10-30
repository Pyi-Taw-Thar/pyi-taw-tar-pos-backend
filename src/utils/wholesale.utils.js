// Ecommerce အတွက် inventory နှင့် unit, quantity အလိုက် အကျုံးဝင်သော လက်ကားဈေး (wholesale price) ကို ရှာဖွေသည်
export const findEcommerceWholesalePrice = (inventory, unit, qty) => {
  if (
    !inventory ||
    !inventory.wholesalePrices ||
    !Array.isArray(inventory.wholesalePrices) ||
    inventory.wholesalePrices.length === 0
  ) {
    return null;
  }

  const requestedQty = Number(qty);
  if (!requestedQty || requestedQty <= 0) {
    return null;
  }

  const unitNorm = (unit || "").trim().toLowerCase();
  const baseUnitNorm = (inventory.unitOfMeasure || "").trim().toLowerCase();

  // Tier ကိုက်ညီမှု စစ်ဆေးခြင်း:
  // ၁။ tier.unit ပါရှိပါက ရွေးချယ်ထားသော unit နှင့် တူညီရမည်
  // ၂။ tier.unit မပါရှိပါက base unit နှင့်သာ ကိုက်ညီရမည်
  // ၃။ price <= 0 နှင့် quantity <= 0 ဖြစ်သော tier များကို ပယ်သည်
  const matched = inventory.wholesalePrices.filter((wp) => {
    if (!wp || typeof wp.price !== "number" || wp.price <= 0) return false;
    const tierQty = Number(wp.quantity);
    if (!tierQty || tierQty <= 0) return false;

    const wpUnitNorm = (wp.unit || "").trim().toLowerCase();
    if (wpUnitNorm) {
      return wpUnitNorm === unitNorm;
    }
    return unitNorm === baseUnitNorm;
  });

  if (matched.length === 0) {
    return null;
  }

  // minQty ငယ်ရာမှ ကြီးရာ စီပြီး minQty တူနေပါက နောက်ဆုံးတန်ဖိုးကို ယူသည်
  matched.sort((a, b) => Number(a.quantity) - Number(b.quantity));
  const tierMap = new Map();
  for (const t of matched) {
    tierMap.set(Number(t.quantity), Number(t.price));
  }

  const sortedTiers = Array.from(tierMap.entries())
    .map(([minQty, price]) => ({ minQty, price }))
    .sort((a, b) => a.minQty - b.minQty);

  // minQty <= requestedQty ဖြစ်သော အမြင့်ဆုံး tier ကို ရှာသည်
  let currentPrice = null;
  for (const t of sortedTiers) {
    if (t.minQty <= requestedQty) {
      currentPrice = t.price;
    }
  }

  return currentPrice;
};
