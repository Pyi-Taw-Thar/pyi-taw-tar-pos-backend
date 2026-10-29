import moment from "moment-timezone";
import mongoose from "mongoose";
import Counter from "../models/counter.model.js";
import BatchStock from "../models/batchStock.model.js";
import GoodsRecievedNote from "../models/goodsRecievedNote.model.js";

/**
 * GRN အတွက် Batch Number အလိုအလျောက် ထုတ်ပေးသည့် Helper Function
 * Format: B-YYMMDD-NNN (ဥပမာ B-261029-001)
 * နေ့စဉ် 001 မှ ပြန်စပြီး ၉၉၉ ကျော်ပါက ဂဏန်းအရေအတွက်အတိုင်း အပြည့်ပြသသည်။
 * ရက်စွဲကို မြန်မာစံတော်ချိန် (Asia/Yangon) ဖြင့်သာ တိကျစွာ တွက်ချက်သည်။
 * 
 * @param {string|null} [mockDate] - စမ်းသပ်မှုများအတွက် ရက်စွဲ mock လုပ်ရန် (YYYY-MM-DD format)
 * @returns {Promise<string>} အသစ်ထုတ်ပေးလိုက်သော Batch Number
 */
export async function generateBatchNumber(mockDate = null) {
  // မြန်မာစံတော်ချိန် (Asia/Yangon) ဖြင့် လက်ရှိရက်စွဲကို ရယူမည်
  const mmtMoment = mockDate
    ? moment.tz(mockDate, "Asia/Yangon")
    : moment().tz("Asia/Yangon");

  const yymmdd = mmtMoment.format("YYMMDD");
  const prefix = `B-${yymmdd}-`;
  const counterId = `BATCH-${yymmdd}`;

  // ဤရက်အတွက် counter မရှိသေးပါက ယခင် manual ရိုက်ထားသော အမြင့်ဆုံး seq ကို ရှာဖွေပြီး $max ဖြင့် စတင်မည်
  const existingCounter = await Counter.findById(counterId).session(null).lean();
  if (!existingCounter) {
    let maxSeq = 0;
    const batchRegex = new RegExp(`^${prefix}(\\d+)`);

    // ၁။ BatchStock ထဲမှ အမြင့်ဆုံး batchNumber ကို ရှာဖွေမည်
    try {
      const lastBatchStock = await BatchStock
        .findOne({ batchNumber: batchRegex })
        .sort({ batchNumber: -1 })
        .select("batchNumber")
        .session(null)
        .lean();

      if (lastBatchStock?.batchNumber) {
        const parts = lastBatchStock.batchNumber.split("-");
        if (parts.length === 3) {
          const parsed = parseInt(parts[2], 10);
          if (!Number.isNaN(parsed) && parsed > maxSeq) {
            maxSeq = parsed;
          }
        }
      }
    } catch (err) {
      console.warn("BatchStock find error during batchNumber init:", err?.message);
    }

    // ၂။ GoodsRecievedNote lineItems ထဲမှ အမြင့်ဆုံး batchNumber ကို ရှာဖွေမည်
    try {
      const lastGRN = await GoodsRecievedNote
        .findOne({ "lineItems.batchNumber": batchRegex })
        .sort({ "lineItems.batchNumber": -1 })
        .select("lineItems.batchNumber")
        .session(null)
        .lean();

      if (lastGRN?.lineItems) {
        for (const item of lastGRN.lineItems) {
          if (item.batchNumber && item.batchNumber.startsWith(prefix)) {
            const parts = item.batchNumber.split("-");
            if (parts.length === 3) {
              const parsed = parseInt(parts[2], 10);
              if (!Number.isNaN(parsed) && parsed > maxSeq) {
                maxSeq = parsed;
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn("GoodsRecievedNote find error during batchNumber init:", err?.message);
    }

    // Counter document ကို initial seq ($max) ဖြင့် initialize လုပ်မည်
    try {
      await Counter.updateOne(
        { _id: counterId },
        { $max: { seq: maxSeq } },
        { upsert: true }
      );
    } catch (err) {
      // တစ်ပြိုင်နက်တည်း upsert ကြောင့် E11000 ဖြစ်ပါက ရှိပြီးသား document ကို $max ဖြင့်သာ update လုပ်မည်
      if (err?.code === 11000) {
        await Counter.updateOne(
          { _id: counterId },
          { $max: { seq: maxSeq } }
        );
      } else {
        throw err;
      }
    }
  }

  // Transaction အပြင်ဘက်တွင် (session မပါဘဲ) atomic $inc ဖြင့် နံပါတ်အသစ် ရယူမည်
  const counter = await Counter.findOneAndUpdate(
    { _id: counterId },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" }
  );

  const seqStr = String(counter.seq).padStart(3, "0");
  return `${prefix}${seqStr}`;
}
