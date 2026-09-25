import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join, normalize } from "path";
import type { Readable } from "stream";

/**
 * Where uploaded files live.
 *
 * Production: any S3-compatible bucket — Cloudflare R2 or Backblaze B2 (both have free tiers, B2
 * without a card), Supabase Storage, AWS. The bucket can stay PRIVATE: files are then served
 * through this API (/api/media/…), which also lets private files (payment proofs, homework) be
 * shown only to the people allowed to see them.
 *
 * Development: files go to server/uploads on the local disk. (Render's disk is wiped on every
 * deploy, so production refuses to start without a bucket — see main.ts.)
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client | null;
  private readonly bucket = process.env.S3_BUCKET ?? "";
  private readonly localRoot = join(process.cwd(), "uploads");

  constructor() {
    this.client = StorageService.configured()
      ? new S3Client({
          region: process.env.S3_REGION || "auto",
          endpoint: process.env.S3_ENDPOINT || undefined,
          forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true") !== "false",
          credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID!, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY! },
        })
      : null;
  }

  static configured(): boolean {
    return Boolean(process.env.S3_BUCKET && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY);
  }

  get mode(): "bucket" | "local" {
    return this.client ? "bucket" : "local";
  }

  /** Browser address for a stored file. Public files may come straight from a public bucket/CDN. */
  urlFor(key: string): string {
    const base = process.env.S3_PUBLIC_URL_BASE?.replace(/\/+$/, "");
    if (base && key.startsWith("public/")) return `${base}/${key}`;
    return `/api/media/${key}`;
  }

  private localPath(key: string): string {
    const path = normalize(join(this.localRoot, key));
    if (!path.startsWith(this.localRoot)) throw new NotFoundException();
    return path;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    if (this.client) {
      await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType, CacheControl: "public, max-age=31536000, immutable" }));
      return;
    }
    const path = this.localPath(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }

  async get(key: string): Promise<{ body: Buffer | Readable; contentType?: string; length?: number }> {
    if (this.client) {
      try {
        const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
        return { body: result.Body as Readable, contentType: result.ContentType, length: result.ContentLength };
      } catch {
        throw new NotFoundException("File not found.");
      }
    }
    try {
      const body = await readFile(this.localPath(key));
      return { body, length: body.length };
    } catch {
      throw new NotFoundException("File not found.");
    }
  }

  async remove(key: string): Promise<void> {
    try {
      if (this.client) await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (error) {
      this.logger.warn(`Could not delete ${key}: ${error instanceof Error ? error.message : error}`);
    }
  }
}
