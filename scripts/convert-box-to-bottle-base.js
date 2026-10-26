/**
 * Base unit "ပုံး" ဖြစ်နေသော ecommerce product များကို base "ဘူး" သို့ ပြောင်းရန် (sample data)
 *
 * 1 ပုံး = 10 ဘူး, 1 ဖာ = 120 ဘူး
 * - စျေး (sellingPrice, buyingPrice, batch costPrice) ÷ 10
 * - Stock (storefront, warehouse, batch), reorder, ecommerceMaxPerUser × 10
 *
 * Usage:
 *   node scripts/convert-box-to-bottle-base.js --dry-run
 *   node scripts/convert-box-to-bottle-base.js
 */

import dns from "node:dns";
import mongoose from "mongoose";
import dotenv from "dotenv";
import Inventory from "../src/models/inventory.model.js";
import StorefrontInventory from "../src/models/storefrontInventory.model.js";
import WarehouseStock from "../src/models/warehouse.model.js";
import BatchStock from "../src/models/batchStock.model.js";

dotenv.config({ path: "./.env" });
// app.js အတိုင်း — local network တွင် Atlas SRV lookup မအောင်မြင်ခြင်းကို ကာကွယ်ရန်
dns.setServers(["1.1.1.1", "8.8.8.8"]);

const DRY_RUN = process.argv.includes("--dry-run");
const FROM_UNIT = "ပုံး";
const TO_UNIT = "ဘူး";
const FACTOR = 10;
const NEW_CONVERSIONS = [
  { unit: "ပုံး", factor: 10 },
  { unit: "ဖာ", factor: 120 },
];

const scale = (value, by) => (value === null || value === undefined ? value : value * by);

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`DB: ${mongoose.connection.name} | mode: ${DRY_RUN ? "DRY-RUN" : "UPDATE"}`);

  const storefrontId = new mongoose.Types.ObjectId(process.env.ECOMMERCE_STOREFRONT_ID);
  const ecommerceIds = await StorefrontInventory.distinct("inventoryId", { storefrontId });
  const items = await Inventory.find({ _id: { $in: ecommerceIds }, unitOfMeasure: FROM_UNIT }).lean();
  const ids = items.map((i) => i._id);

  const [sfStocks, whStocks, batches] = await Promise.all([
    StorefrontInventory.find({ inventoryId: { $in: ids } }).lean(),
    WarehouseStock.find({ inventoryId: { $in: ids } }).lean(),
    BatchStock.find({ inventoryId: { $in: ids } }).lean(),
  ]);

  const warnings = [];
  for (const item of items) {
    const sf = sfStocks.filter((s) => s.inventoryId.equals(item._id)).map((s) => s.quantity);
    const wh = whStocks.filter((s) => s.inventoryId.equals(item._id)).map((s) => s.quantity);
    const bt = batches.filter((s) => s.inventoryId.equals(item._id)).map((s) => s.quantity);
    console.log(
      `${item.productCode.padEnd(8)} sell ${item.sellingPrice}→${item.sellingPrice / FACTOR}` +
        ` | buy ${item.buyingPrice}→${scale(item.buyingPrice, 1 / FACTOR)}` +
        ` | max ${item.ecommerceMaxPerUser}→${scale(item.ecommerceMaxPerUser, FACTOR)}` +
        ` | sf [${sf}]→[${sf.map((q) => q * FACTOR)}] wh [${wh}] batch [${bt}]  ${item.productName}`,
    );
    if (item.sellingPrice % FACTOR !== 0 || (item.buyingPrice ?? 0) % FACTOR !== 0) {
      warnings.push(`${item.productCode}: စျေး ÷${FACTOR} တွင် ဒသမ ထွက်သည်`);
    }
  }
  console.log(
    `\nproducts ${items.length} | storefront stocks ${sfStocks.length} | warehouse stocks ${whStocks.length} | batches ${batches.length}`,
  );
  warnings.forEach((w) => console.log(`  warning: ${w}`));

  if (!DRY_RUN && items.length > 0) {
    const session = await mongoose.startSession();
    await session.withTransaction(async () => {
      await Inventory.bulkWrite(
        items.map((item) => ({
          updateOne: {
            filter: { _id: item._id, unitOfMeasure: FROM_UNIT },
            update: {
              $set: {
                unitOfMeasure: TO_UNIT,
                uomConversions: NEW_CONVERSIONS,
                sellingPrice: item.sellingPrice / FACTOR,
                buyingPrice: scale(item.buyingPrice, 1 / FACTOR),
                reorderPoint: scale(item.reorderPoint, FACTOR),
                reorderQuantity: scale(item.reorderQuantity, FACTOR),
                ecommerceMaxPerUser: scale(item.ecommerceMaxPerUser, FACTOR),
              },
            },
          },
        })),
        { session },
      );
      await StorefrontInventory.updateMany(
        { inventoryId: { $in: ids } },
        { $mul: { quantity: FACTOR } },
        { session },
      );
      await WarehouseStock.updateMany(
        { inventoryId: { $in: ids } },
        { $mul: { quantity: FACTOR } },
        { session },
      );
      await BatchStock.updateMany(
        { inventoryId: { $in: ids } },
        { $mul: { quantity: FACTOR, costPrice: 1 / FACTOR } },
        { session },
      );
    });
    await session.endSession();
    console.log("Updated (transaction committed)");
  }

  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
