import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import jwt from "jsonwebtoken";

// အထွေထွေ 429 response လုပ်ဆောင်ချက် (ယခု JSON ပုံစံအတိုင်း ထိန်းသိမ်းထားသည်)
const rateLimitHandler = (req, res) => {
  return res.status(429).json({
    code: 429,
    status: "failed",
    message: "Too many requests, please try again later.",
  });
};

// Request header မှ Bearer token ကို ဖတ်၍ JWT payload ကို verify လုပ်သည့် helper
// Token မမှန်ပါက သို့မဟုတ် မပါပါက null ပြန်ပေးမည် (401 ပြန်ခြင်းသည် auth middleware ၏ အလုပ်ဖြစ်သည်)
const extractVerifiedJwt = (req) => {
  if (req._rateLimitJwtChecked) {
    return req._rateLimitJwtPayload;
  }
  req._rateLimitJwtChecked = true;
  req._rateLimitJwtPayload = null;

  const authHeader = req.headers?.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.split(" ")[1];
  if (!token) {
    return null;
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded && decoded.id && decoded.role) {
      req._rateLimitJwtPayload = decoded;
      return decoded;
    }
  } catch {
    // Token သက်တမ်းကုန်ခြင်း သို့မဟုတ် signature မှားခြင်း — IP limiter သို့ fallback လုပ်မည်
  }

  return null;
};

const STAFF_ROLES = new Set([
  "owner",
  "admin",
  "cashier",
  "kitchen",
  "bar-counter",
  "ktv-waiter",
  "restaurant-waiter",
]);

const getEnvNumber = (envKey, defaultValue) => {
  const val = Number(process.env[envKey]);
  return Number.isFinite(val) && val > 0 ? val : defaultValue;
};

// A. Auth Limiter — Login နှင့် Register အတွက် တင်းကျပ်သော ကန့်သတ်ချက် (IP အလိုက် 10 req / 15 မိနစ်)
// အောင်မြင်သော login/register (status < 400) များကို ထည့်မရေတွက်ပါ
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // ၁၅ မိနစ်
  max: () => getEnvNumber("RATE_LIMIT_AUTH_MAX", 10),
  skipSuccessfulRequests: true,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  handler: rateLimitHandler,
});

// B & C. API Limiter — Login ဝင်ပြီးသူများအတွက် JWT (role:id) ဖြင့် ကန့်သတ်ပြီး၊ Token မပါသူများအတွက် IP ဖြင့် ကန့်သတ်သည်
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // ၁ မိနစ်
  max: (req) => {
    const decoded = extractVerifiedJwt(req);
    if (decoded) {
      if (STAFF_ROLES.has(decoded.role)) {
        return getEnvNumber("RATE_LIMIT_STAFF_MAX", 600);
      }
      if (decoded.role === "customer") {
        return getEnvNumber("RATE_LIMIT_CUSTOMER_MAX", 120);
      }
    }
    return getEnvNumber("RATE_LIMIT_PUBLIC_MAX", 300);
  },
  keyGenerator: (req) => {
    const decoded = extractVerifiedJwt(req);
    if (decoded) {
      return `${decoded.role}:${decoded.id}`;
    }
    return ipKeyGenerator(req.ip);
  },
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: rateLimitHandler,
});

export default apiLimiter;
