import type { PrismaService } from "../prisma/prisma.service";
import { studentNumber } from "../common/codes";

/**
 * The next free student number for this year (HMLI-2026-0001, -0002, …).
 * Reads the highest number issued this year; the unique index on studentNo stops two admissions
 * officers getting the same one at the same moment (the second save fails and is retried by the caller).
 */
export async function nextStudentNumber(prisma: PrismaService, year = new Date().getFullYear()): Promise<string> {
  const prefix = `HMLI-${year}-`;
  const latest = await prisma.student.findFirst({
    where: { studentNo: { startsWith: prefix } },
    orderBy: { studentNo: "desc" },
    select: { studentNo: true },
  });
  const last = latest ? Number(latest.studentNo.slice(prefix.length)) || 0 : 0;
  return studentNumber(year, last + 1);
}
