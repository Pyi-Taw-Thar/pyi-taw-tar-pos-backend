import cors from "cors";

export const configureCors = () => {
  const envOrigins = process.env.CLIENT_ORIGINS
    ? process.env.CLIENT_ORIGINS.split(",").map((s) => s.trim())
    : [];

  const defaultOrigins = [
    process.env.FRONTEND_URL,
    process.env.ADMIN_URL,
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:4200",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
  ].filter(Boolean);

  const allowedOrigins = Array.from(new Set([...defaultOrigins, ...envOrigins]));

  return cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (such as mobile apps, Postman, curl, or server-to-server)
      if (!origin) {
        return callback(null, true);
      }

      // In development mode, allow localhost and configured origins
      if (
        process.env.NODE_ENV === "development" ||
        allowedOrigins.length === 0 ||
        allowedOrigins.includes(origin)
      ) {
        return callback(null, true);
      }

      callback(new Error(`Origin ${origin} is not allowed by CORS.`));
    },
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization", "Accept-Version"],
    exposedHeaders: ["X-Total-Count", "Content-Range"],
    credentials: true,
    preflightContinue: false,
    maxAge: 600,
    optionsSuccessStatus: 204,
  });
};

export default configureCors;
