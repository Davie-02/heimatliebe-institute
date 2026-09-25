import { detectFileType } from "./file-type";

const pad = (bytes: number[]) => Buffer.from([...bytes, ...new Array(16).fill(0)]);

describe("detectFileType", () => {
  it("recognises files by content", () => {
    expect(detectFileType(pad([0xff, 0xd8, 0xff, 0xe0]))?.mime).toBe("image/jpeg");
    expect(detectFileType(pad([0x25, 0x50, 0x44, 0x46, 0x2d]))?.ext).toBe("pdf");
    expect(detectFileType(pad([0x50, 0x4b, 0x03, 0x04]), "Homework.DOCX")?.ext).toBe("docx");
  });

  it("refuses anything else, whatever it is called", () => {
    expect(detectFileType(Buffer.from("<script>alert(1)</script>........"), "photo.jpg")).toBeNull();
    expect(detectFileType(pad([0x50, 0x4b, 0x03, 0x04]), "archive.zip")).toBeNull();
    expect(detectFileType(Buffer.from("MZ")), ).toBeNull();
  });
});
