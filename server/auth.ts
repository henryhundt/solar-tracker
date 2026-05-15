import type { Express, Request, RequestHandler } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import createMemoryStore from "memorystore";
import { timingSafeEqual } from "node:crypto";
import { Pool } from "pg";
import type { AuthSessionResponse } from "@shared/schema";

declare module "express-session" {
  interface SessionData {
    isAuthenticated?: boolean;
    adminUsername?: string;
  }
}

interface AuthConfig {
  authEnabled: boolean;
  inProduction: boolean;
  adminUsername: string;
  adminPassword: string;
  sessionSecret: string;
  sessionMaxAgeMs: number;
}

function getAuthConfig(): AuthConfig {
  const adminUsername = process.env.ADMIN_USERNAME?.trim() ?? "";
  const adminPassword = process.env.ADMIN_PASSWORD?.trim() ?? "";
  const sessionSecret = process.env.SESSION_SECRET?.trim() ?? "";
  const inProduction = process.env.NODE_ENV === "production";
  const authEnabled = adminUsername.length > 0 && adminPassword.length > 0;
  const sessionMaxAgeMs = parseSessionMaxAgeMs(process.env.SESSION_MAX_AGE_HOURS);

  if (inProduction && !authEnabled) {
    throw new Error("ADMIN_USERNAME and ADMIN_PASSWORD must be set in production.");
  }

  if (inProduction && sessionSecret.length === 0) {
    throw new Error("SESSION_SECRET must be set in production.");
  }

  return {
    authEnabled,
    inProduction,
    adminUsername,
    adminPassword,
    sessionSecret: sessionSecret || "dev-only-session-secret",
    sessionMaxAgeMs,
  };
}

export function configureAuth(app: Express) {
  const config = getAuthConfig();

  if (config.inProduction) {
    app.set("trust proxy", 1);
  }

  const MemoryStore = createMemoryStore(session);
  const store = createSessionStore(config, MemoryStore);
  app.use(
    session({
      name: "solar_tracker_session",
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      unset: "destroy",
      store,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: config.inProduction,
        maxAge: config.sessionMaxAgeMs,
      },
    }),
  );
}

export function isAuthEnabled(): boolean {
  return getAuthConfig().authEnabled;
}

export function getAuthSessionResponse(req: Request): AuthSessionResponse {
  const authEnabled = isAuthEnabled();

  if (!authEnabled) {
    return {
      authEnabled: false,
      authenticated: true,
    };
  }

  return {
    authEnabled: true,
    authenticated: Boolean(req.session.isAuthenticated),
    username: req.session.isAuthenticated ? req.session.adminUsername : undefined,
  };
}

export const requireAppAuth: RequestHandler = (req, res, next) => {
  if (!isAuthEnabled()) {
    return next();
  }

  if (req.session.isAuthenticated) {
    return next();
  }

  return res.status(401).json({ message: "Authentication required" });
};

export function authenticateAdmin(username: string, password: string): boolean {
  const config = getAuthConfig();
  if (!config.authEnabled) {
    return false;
  }

  return safeCompare(username, config.adminUsername) && safeCompare(password, config.adminPassword);
}

export function saveAuthenticatedSession(req: Request): Promise<void> {
  req.session.isAuthenticated = true;
  req.session.adminUsername = getAuthConfig().adminUsername;

  return new Promise((resolve, reject) => {
    req.session.save((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

export function destroyAuthenticatedSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.destroy((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function safeCompare(input: string, expected: string): boolean {
  const inputBuffer = Buffer.from(input);
  const expectedBuffer = Buffer.from(expected);

  if (inputBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(inputBuffer, expectedBuffer);
}

function createSessionStore(
  config: AuthConfig,
  MemoryStore: ReturnType<typeof createMemoryStore>,
) {
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (databaseUrl) {
    const PGStore = connectPgSimple(session);
    const pool = new Pool({
      connectionString: databaseUrl,
      ssl: databaseUrl.includes("sslmode=require")
        ? { rejectUnauthorized: false }
        : undefined,
    });

    pool.on("error", (error) => {
      console.error("Session store pool error:", error);
    });

    return new PGStore({
      pool,
      createTableIfMissing: true,
      ttl: Math.ceil(config.sessionMaxAgeMs / 1000),
      pruneSessionInterval: 60 * 15,
    });
  }

  return new MemoryStore({
    checkPeriod: 24 * 60 * 60 * 1000,
  });
}

function parseSessionMaxAgeMs(rawHours: string | undefined) {
  const defaultHours = 24 * 7;

  if (!rawHours) {
    return defaultHours * 60 * 60 * 1000;
  }

  const parsedHours = Number(rawHours);
  if (!Number.isFinite(parsedHours) || parsedHours <= 0) {
    return defaultHours * 60 * 60 * 1000;
  }

  return parsedHours * 60 * 60 * 1000;
}
