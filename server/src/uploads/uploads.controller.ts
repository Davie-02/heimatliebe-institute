import { Controller, Get, Post, Req, Res, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { JwtService } from "@nestjs/jwt";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { Readable } from "stream";
import { JwtAuthGuard, extractSessionToken } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles, StaffRoute } from "../auth/roles.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { SessionService, type SessionClaims } from "../auth/session.service";
import { MAX_UPLOAD_BYTES, UploadsService } from "./uploads.service";
import { StorageService } from "./storage.service";

const upload = FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });

@Controller()
export class UploadsController {
  constructor(
    private readonly uploads: UploadsService,
    private readonly storage: StorageService,
    private readonly jwt: JwtService,
    private readonly sessions: SessionService
  ) {}

  /** Staff uploads for website content, course material and records: public files. */
  @Post("uploads")
  @StaffRoute()
  @UseInterceptors(upload)
  staffUpload(@UploadedFile() file: Express.Multer.File, @CurrentUser() user: SessionClaims, @Req() request: Request) {
    return this.uploads.save(file, { owner: `staff:${user.sub}`, isPublic: request.query.private !== "true" });
  }

  /** Students: homework and payment proofs. Private — only staff and the student can open them. */
  @Post("me/uploads")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("STUDENT")
  @Throttle({ default: { limit: 30, ttl: 60 * 60_000 } })
  @UseInterceptors(upload)
  studentUpload(@UploadedFile() file: Express.Multer.File, @CurrentUser() user: SessionClaims) {
    return this.uploads.save(file, { owner: `student:${user.sub}`, isPublic: false });
  }

  /** Applicants and exam candidates: a photo or PDF of their payment. Private, staff only. */
  @Post("public/uploads")
  @Throttle({ default: { limit: 6, ttl: 60 * 60_000 } })
  @UseInterceptors(upload)
  publicUpload(@UploadedFile() file: Express.Multer.File) {
    return this.uploads.save(file, { owner: "public", isPublic: false }, ["image", "document"]);
  }

  /** Serves stored files. Public ones are cached for a year (their names never change); private ones need a sign-in. */
  @Get("media/*")
  async media(@Req() request: Request, @Res() response: Response) {
    const key = (request.params as Record<string, string>)[0] ?? "";
    if (!/^(public|private)\/[\w/.-]+$/.test(key) || key.includes("..")) {
      response.status(404).json({ message: "File not found." });
      return;
    }
    let viewer: SessionClaims | null = null;
    if (key.startsWith("private/")) {
      const token = extractSessionToken(request);
      try {
        viewer = token ? await this.jwt.verifyAsync<SessionClaims>(token) : null;
        if (viewer) await this.sessions.assertStillValid(viewer);
      } catch {
        viewer = null;
      }
    }
    await this.uploads.assertCanRead(key, viewer);
    const file = await this.storage.get(key);
    const ext = key.split(".").pop() ?? "";
    const types: Record<string, string> = { webp: "image/webp", jpg: "image/jpeg", png: "image/png", gif: "image/gif", pdf: "application/pdf", mp3: "audio/mpeg", mp4: "video/mp4", m4a: "audio/mp4", ogg: "audio/ogg" };
    response.setHeader("Content-Type", file.contentType ?? types[ext] ?? "application/octet-stream");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    response.setHeader("Cache-Control", key.startsWith("public/") ? "public, max-age=31536000, immutable" : "private, no-store");
    if (!["webp", "jpg", "png", "gif", "pdf", "mp3", "mp4", "m4a", "ogg"].includes(ext)) response.setHeader("Content-Disposition", "attachment");
    if (file.length) response.setHeader("Content-Length", String(file.length));
    if (Buffer.isBuffer(file.body)) response.end(file.body);
    else (file.body as Readable).pipe(response);
  }
}
