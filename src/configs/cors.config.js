import cors from "cors";

export const configureCors = () => {
  const envOrigins = process.env.CLIENT_ORIGINS
    ? process.env.CLIENT_ORIGINS.split(",").map((s) => s.trim())
    : [];

  const defaultOrigins = [
    process.env.FRONTEND_URL,
    process.env.ADMIN_URL,
    "https://pos.pyithawtar.com",
    "https://pyithawtar.com",
    "https://www.pyithawtar.com",
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:5175",
    "http://localhost:4173",
    "http://localhost:4200",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
    "http://127.0.0.1:5175",
    "http://127.0.0.1:4173",
  ].filter(Boolean);

  const allowedOrigins = Array.from(new Set([...defaultOrigins, ...envOrigins]));

  return cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (such as mobile apps, Postman, curl, or server-to-server)
      if (!origin) {
        return callback(null, true);
      }

      // In development mode, allow all origins
      if (process.env.NODE_ENV === "development") {
        return callback(null, true);
      }

      // Allow localhost or 127.0.0.1 on any port
      if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        return callback(null, true);
      }

      // Check configured allowed origins
      if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      callback(null, false);
    },
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "Accept",
      "Accept-Version",
      "Origin",
      "X-Requested-With",
    ],
    exposedHeaders: [
      "X-Total-Count",
      "Content-Range",
      "Retry-After",
      "RateLimit",
      "RateLimit-Policy",
    ],
    credentials: true,
    preflightContinue: false,
    maxAge: 600,
    optionsSuccessStatus: 204,
  });
};

export default configureCors;
