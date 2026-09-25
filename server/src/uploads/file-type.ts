/**
 * What a file really is, judged from its first bytes rather than the name or the type the
 * browser claims — so a script renamed to "photo.jpg" is refused.
 */
export interface DetectedType {
  ext: string;
  mime: string;
  kind: "image" | "document" | "audio" | "video";
}

const starts = (buf: Buffer, bytes: number[], offset = 0) => bytes.every((b, i) => buf[offset + i] === b);

export function detectFileType(buf: Buffer, originalName = ""): DetectedType | null {
  if (buf.length < 12) return null;
  if (starts(buf, [0xff, 0xd8, 0xff])) return { ext: "jpg", mime: "image/jpeg", kind: "image" };
  if (starts(buf, [0x89, 0x50, 0x4e, 0x47])) return { ext: "png", mime: "image/png", kind: "image" };
  if (starts(buf, [0x47, 0x49, 0x46, 0x38])) return { ext: "gif", mime: "image/gif", kind: "image" };
  if (starts(buf, [0x52, 0x49, 0x46, 0x46]) && starts(buf, [0x57, 0x45, 0x42, 0x50], 8)) return { ext: "webp", mime: "image/webp", kind: "image" };
  if (starts(buf, [0x25, 0x50, 0x44, 0x46])) return { ext: "pdf", mime: "application/pdf", kind: "document" };
  if (starts(buf, [0x49, 0x44, 0x33]) || starts(buf, [0xff, 0xfb]) || starts(buf, [0xff, 0xf3])) return { ext: "mp3", mime: "audio/mpeg", kind: "audio" };
  if (starts(buf, [0x4f, 0x67, 0x67, 0x53])) return { ext: "ogg", mime: "audio/ogg", kind: "audio" };
  if (starts(buf, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = buf.subarray(8, 12).toString("latin1");
    if (/^M4A/.test(brand)) return { ext: "m4a", mime: "audio/mp4", kind: "audio" };
    return { ext: "mp4", mime: "video/mp4", kind: "video" };
  }
  if (starts(buf, [0x50, 0x4b, 0x03, 0x04])) {
    // Office files are zip archives; the name tells which program opens it.
    const ext = originalName.toLowerCase().match(/\.(docx|xlsx|pptx)$/)?.[1];
    const mimes: Record<string, string> = {
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    };
    return ext ? { ext, mime: mimes[ext], kind: "document" } : null;
  }
  if (starts(buf, [0xd0, 0xcf, 0x11, 0xe0])) {
    const ext = originalName.toLowerCase().match(/\.(doc|xls|ppt)$/)?.[1];
    return ext ? { ext, mime: ext === "doc" ? "application/msword" : ext === "xls" ? "application/vnd.ms-excel" : "application/vnd.ms-powerpoint", kind: "document" } : null;
  }
  return null;
}
