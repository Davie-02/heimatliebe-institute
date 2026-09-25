import "dotenv/config";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { ForbiddenException, Logger, ValidationPipe } from "@nestjs/common";
import compression from "compression";
import helmet from "helmet";
import type { NextFunction, Request, Response } from "express";
import { AppModule } from "./app.module";
import { csrfCheckRequired, hasValidCsrfToken } from "./auth/csrf";
import { readCookie } from "./auth/cookies";
import { STAFF_SESSION_COOKIE, STUDENT_SESSION_COOKIE } from "./auth/session-cookie";
import { StorageService } from "./uploads/storage.service";

/** Settings a live site can't run safely without. Checked before anything starts. */
function checkProductionSettings() {
  if (process.env.NODE_ENV !== "production") return;
  const problems: string[] = [];
  if (!process.env.FRONTEND_URL) problems.push("FRONTEND_URL (the website's address) is not set.");
  // JWT_SECRET signs every session; a short or guessable one would let anyone forge a sign-in.
  if ((process.env.JWT_SECRET ?? "").length < 32) problems.push("JWT_SECRET must be at least 32 random characters.");
  if (!process.env.DATABASE_URL) problems.push("DATABASE_URL is not set.");
  // Render's disk is wiped on every deploy, so uploads must go to a bucket.
  if (!StorageService.configured() && process.env.ALLOW_LOCAL_UPLOADS !== "true") problems.push("S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are not set (uploaded files would be lost on every deploy).");
  if (problems.length) {
    // eslint-disable-next-line no-console
    console.error(`Refusing to start:\n  - ${problems.join("\n  - ")}`);
    process.exit(1);
  }
}

const PUBLIC_READ = /^\/api\/(public\/|assistant\/status|health)/;

async function bootstrap() {
  checkProductionSettings();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ["error", "warn", "log"] });
  const frontendUrls = (process.env.FRONTEND_URL ?? "http://localhost:5173").split(",").map((u) => u.trim().replace(/\/+$/, ""));

  // Behind Render (and Vercel's forwarding of /api) every request would otherwise appear to come
  // from the proxy, making per-address limits apply to everyone at once. TRUST_PROXY = number of
  // proxy hops (2 with the same-domain Vercel setup). Leave unset when exposed directly.
  const trustProxy = Number(process.env.TRUST_PROXY);
  if (Number.isInteger(trustProxy) && trustProxy > 0) app.set("trust proxy", trustProxy);

  app.enableCors({
    origin: frontendUrls,
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization", "x-csrf-token"],
    maxAge: 86400,
  });

  // Standard protective headers. This server returns JSON and files, never HTML pages, so the
  // browser-page Content-Security-Policy is set by the website (vercel.json) instead; files are
  // served with their own locked-down policy (uploads.controller.ts).
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.setGlobalPrefix("api");
  // The live-update stream must not be compressed, or events arrive in delayed batches.
  app.use(compression({ filter: (req, res) => (req.path === "/api/events" ? false : compression.filter(req, res)) }));

  app.use((request: Request, response: Response, next: NextFunction) => {
    if (request.path === "/api/events") response.setHeader("X-Accel-Buffering", "no");
    // Public reads may be cached but are always revalidated (ETag), so an edit shows on the very
    // next request while unchanged data costs a tiny "304 Not Modified". Anything tied to a
    // signed-in person is never stored.
    const signedIn =
      Boolean(readCookie(request.headers.cookie, STAFF_SESSION_COOKIE)) ||
      Boolean(readCookie(request.headers.cookie, STUDENT_SESSION_COOKIE)) ||
      Boolean(request.headers.authorization?.startsWith("Bearer "));
    if (!response.getHeader("Cache-Control")) {
      response.setHeader("Cache-Control", request.method === "GET" && !signedIn && PUBLIC_READ.test(request.path) ? "public, no-cache" : "no-store");
    }
    next();
  });

  app.use((request: Request, _response: Response, next: NextFunction) => {
    const isStateChanging = !["GET", "HEAD", "OPTIONS"].includes(request.method);
    const usesBearerToken = request.headers.authorization?.startsWith("Bearer ");
    if (isStateChanging && !usesBearerToken && csrfCheckRequired(request) && !hasValidCsrfToken(request)) {
      throw new ForbiddenException("A valid CSRF token is required. Refresh the page and try again.");
    }
    next();
  });

  // Unknown fields are refused and values converted, so each request's shape is exactly what its DTO allows.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableShutdownHooks();

  const port = Number(process.env.PORT) || 3001;
  await app.listen(port, "0.0.0.0");
  new Logger("Bootstrap").log(`Heimatliebe API listening on port ${port} (/api)`);
}

bootstrap();
