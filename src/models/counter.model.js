import mongoose from "mongoose";

// အော်ဒါနံပါတ်များ တစ်ပြိုင်နက်တည်း မထပ်စေရန် နေ့စဉ် sequence မှတ်သားသည့် Counter model
const counterSchema = new mongoose.Schema({
  _id: {
    type: String,
    required: true,
  },
  seq: {
    type: Number,
    default: 0,
  },
});

const Counter = mongoose.model("Counter", counterSchema);
export default Counter;
