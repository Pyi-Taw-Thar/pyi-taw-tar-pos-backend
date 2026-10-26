/**
 * Ecommerce product များတွင် sample UOM conversion ထည့်ရန် (client demo အတွက်)
 *
 * Sample တန်ဖိုး: 1 ပုံး = 10 ဘူး, 1 ဖာ = 12 ပုံး (= 120 ဘူး)
 * - Base unit "ဘူး" → ပုံး (10), ဖာ (120)
 * - Base unit "ပုံး" → ဖာ (12)
 * - uomConversions ဗလာ ဖြစ်နေသော product များကိုသာ update လုပ်သည်
 *
 * Usage:
 *   node scripts/seed-sample-uom.js --dry-run   # ပြောင်းမည့်စာရင်းသာ ပြ
 *   node scripts/seed-sample-uom.js             # တကယ် update
 */

import dns from "node:dns";
import mongoose from "mongoose";
import dotenv from "dotenv";
import Inventory from "../src/models/inventory.model.js";
import StorefrontInventory from "../src/models/storefrontInventory.model.js";

dotenv.config({ path: "./.env" });
// app.js အတိုင်း — local network တွင် Atlas SRV lookup မအောင်မြင်ခြင်းကို ကာကွယ်ရန်
dns.setServers(["1.1.1.1", "8.8.8.8"]);

const DRY_RUN = process.argv.includes("--dry-run");

// ဖာ ကို chain (convertFrom) မသုံးဘဲ base unit မှ တိုက်ရိုက် factor ဖြင့် သိမ်းသည်
const SAMPLE_CONVERSIONS = {
  "ဘူး": [
    { unit: "ပုံး", factor: 10 },
    { unit: "ဖာ", factor: 120 },
  ],
  "ပုံး": [{ unit: "ဖာ", factor: 12 }],
};

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`DB: ${mongoose.connection.name} | mode: ${DRY_RUN ? "DRY-RUN" : "UPDATE"}`);

  const storefrontId = new mongoose.Types.ObjectId(process.env.ECOMMERCE_STOREFRONT_ID);
  const inventoryIds = await StorefrontInventory.distinct("inventoryId", { storefrontId });

  const items = await Inventory.find({ _id: { $in: inventoryIds }, status: "active" })
    .select("productCode productName unitOfMeasure uomConversions")
    .lean();

  const ops = [];
  const skipped = [];
  for (const item of items) {
    const conversions = SAMPLE_CONVERSIONS[item.unitOfMeasure];
    if (!conversions) {
      skipped.push(`${item.productCode} (base unit "${item.unitOfMeasure}" မသိ)`);
      continue;
    }
    if (item.uomConversions?.length) {
      skipped.push(`${item.productCode} (conversion ရှိပြီးသား)`);
      continue;
    }
    console.log(
      `${item.productCode.padEnd(10)} ${item.unitOfMeasure} → ${conversions
        .map((c) => `${c.unit}=${c.factor}`)
        .join(", ")}  ${item.productName}`,
    );
    ops.push({
      updateOne: {
        filter: { _id: item._id },
        update: { $set: { uomConversions: conversions } },
      },
    });
  }

  console.log(`\nစုစုပေါင်း ${items.length} | update ${ops.length} | skip ${skipped.length}`);
  skipped.forEach((s) => console.log(`  skip: ${s}`));

  if (!DRY_RUN && ops.length > 0) {
    const result = await Inventory.bulkWrite(ops);
    console.log(`Updated: ${result.modifiedCount}`);
  }

  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
