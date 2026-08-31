import express, { type Request, Response, NextFunction } from "express";
import helmet from "helmet";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { configureAuth } from "./auth";
import { pool } from "./db";
import { getActiveTaskCount, waitForBackgroundTasks } from "./sync-runtime";
import { initializeCredentialEncryption } from "./credentials";

const app = express();
const httpServer = createServer(app);

app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:"],
      connectSrc: process.env.NODE_ENV === "production"
        ? ["'self'"]
        : ["'self'", "ws:", "wss:"],
      objectSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: "100kb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: "100kb" }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: unknown;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse !== undefined) {
        logLine += ` :: ${JSON.stringify(compactLogPayload(redactSensitiveData(capturedJsonResponse)))}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await configureAuth(app);
  await initializeCredentialEncryption();
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message =
      process.env.NODE_ENV === "production" && status >= 500
        ? "Internal Server Error"
        : err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  await new Promise<void>((resolve, reject) => {
    const handleListenError = (error: Error) => reject(error);
    httpServer.once("error", handleListenError);
    httpServer.listen(
      {
        port,
        host: "0.0.0.0",
      },
      () => {
        httpServer.off("error", handleListenError);
        log(`serving on port ${port}`);
        resolve();
      },
    );
  });
})().catch(async (error) => {
  console.error("Server startup failed:", error);
  process.exitCode = 1;
  await pool.end().catch(() => undefined);
});

let shutdownStarted = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shutdownStarted) {
    return;
  }
  shutdownStarted = true;

  const graceMs = parsePositiveNumber(process.env.SHUTDOWN_GRACE_MS, 30_000);
  log(`received ${signal}; waiting up to ${graceMs}ms for ${getActiveTaskCount()} background task(s)`, "shutdown");
  const serverClosed = new Promise<boolean>((resolve) => {
    httpServer.close((error) => {
      if (error) {
        console.error("HTTP server close failed:", error);
        resolve(false);
        return;
      }
      resolve(true);
    });
  });

  const connectionTimeout = new Promise<false>((resolve) => {
    const timeout = setTimeout(() => resolve(false), graceMs);
    timeout.unref();
  });
  const [tasksCompleted, connectionsClosed] = await Promise.all([
    waitForBackgroundTasks(graceMs),
    Promise.race([serverClosed, connectionTimeout]),
  ]);

  if (!tasksCompleted || !connectionsClosed) {
    console.error("Shutdown grace period expired before all work completed.");
    process.exitCode = 1;
  }

  await pool.end();
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

function redactSensitiveData(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveData(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const sensitiveKeys = new Set(["username", "password", "apiKey", "authorization", "cookie"]);
  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => [
      key,
      sensitiveKeys.has(key) ? "[REDACTED]" : redactSensitiveData(entryValue),
    ]),
  );
}

function compactLogPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    const preview = value.slice(0, 5).map((item) => compactLogPayload(item));
    if (value.length > 5) {
      preview.push({ __truncatedItems: value.length - 5 });
    }
    return preview;
  }

  if (typeof value === "string") {
    return value.length > 200 ? `${value.slice(0, 200)}...` : value;
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => [key, compactLogPayload(entryValue)]),
  );
}

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
