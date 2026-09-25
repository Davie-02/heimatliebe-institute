import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "crypto";
import sharp from "sharp";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "./storage.service";
import { detectFileType } from "./file-type";

export const MAX_UPLOAD_BYTES = (Number(process.env.MAX_UPLOAD_MB) || 10) * 1024 * 1024;
/** Longest side of stored photos: sharp on phones, small enough for slow connections. */
const MAX_IMAGE_SIDE = 1600;

export interface Uploader {
  /** "staff:<id>", "student:<id>" or "public". */
  owner: string;
  /** Private files are only shown to staff and to the person who uploaded them. */
  isPublic: boolean;
}

/**
 * Receives uploaded files: checks what they really are, turns photos into compact WebP images
 * (usually a tenth of the size of a phone photo), and stores them with an unguessable name.
 */
@Injectable()
export class UploadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService
  ) {}

  async save(file: Express.Multer.File | undefined, uploader: Uploader, allowed: Array<"image" | "document" | "audio" | "video"> = ["image", "document", "audio", "video"]) {
    if (!file?.buffer?.length) throw new BadRequestException("Choose a file to upload.");
    if (file.size > MAX_UPLOAD_BYTES) throw new BadRequestException(`Files can be up to ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`);
    const type = detectFileType(file.buffer, file.originalname);
    if (!type || !allowed.includes(type.kind)) {
      throw new BadRequestException(allowed.length === 1 && allowed[0] === "image" ? "Upload a photo (JPG, PNG or WebP)." : "That kind of file isn't accepted. Use a photo, PDF, Word, Excel, PowerPoint, MP3 or MP4 file.");
    }

    let body = file.buffer;
    let contentType = type.mime;
    let ext = type.ext;
    if (type.kind === "image") {
      try {
        body = await sharp(file.buffer, { animated: type.ext === "gif", limitInputPixels: 40_000_000 })
          .rotate() // respect the phone's orientation, then drop the metadata (incl. GPS location)
          .resize({ width: MAX_IMAGE_SIDE, height: MAX_IMAGE_SIDE, fit: "inside", withoutEnlargement: true })
          .webp({ quality: 80 })
          .toBuffer();
        contentType = "image/webp";
        ext = "webp";
      } catch {
        throw new BadRequestException("That image couldn't be read. Try another photo.");
      }
    }

    const month = new Date().toISOString().slice(0, 7).replace("-", "/");
    const key = `${uploader.isPublic ? "public" : "private"}/${month}/${randomBytes(12).toString("hex")}.${ext}`;
    await this.storage.put(key, body, contentType);
    const safeName = (file.originalname || `file.${ext}`).replace(/[^\w.\- ]+/g, "_").slice(0, 120);
    await this.prisma.upload.create({ data: { key, filename: safeName, contentType, size: body.length, isPublic: uploader.isPublic, uploadedBy: uploader.owner } });
    return { url: this.storage.urlFor(key), key, filename: safeName, contentType, size: body.length };
  }

  /** Private file access: any staff member, or the person who uploaded it. */
  async assertCanRead(key: string, viewer: { role: string; sub: string } | null) {
    if (key.startsWith("public/")) return;
    const upload = await this.prisma.upload.findUnique({ where: { key }, select: { uploadedBy: true } });
    if (!upload) throw new NotFoundException("File not found.");
    if (!viewer) throw new ForbiddenException("Sign in to see this file.");
    if (viewer.role !== "STUDENT") return;
    if (upload.uploadedBy !== `student:${viewer.sub}`) throw new ForbiddenException("You can't open this file.");
  }
}
