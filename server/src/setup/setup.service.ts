import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../prisma/prisma.service";
import { staffNumber } from "../common/codes";
import { passwordProblems } from "../security/password-policy";
import { loadDemoData } from "./demo-data";
import { loadStarterContent } from "./starter-content";

/**
 * First start of a new installation. Render's free plan has no command line, so the first
 * system administrator is created from environment variables instead of a seed command:
 *   ADMIN_EMAIL, ADMIN_NAME and ADMIN_PASSWORD (remove ADMIN_PASSWORD after the first sign-in).
 * Nothing happens once any staff account exists. On the staging site SEED_DEMO=true also loads
 * example courses, classes and students; otherwise an empty database gets the institute's own
 * starter content (see starter-content.ts).
 */
@Injectable()
export class SetupService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SetupService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.createFirstAdministrator();
      if (process.env.SEED_DEMO === "true" && process.env.APP_ENV !== "production") await loadDemoData(this.prisma, (line) => this.logger.log(line));
      else await loadStarterContent(this.prisma, (line) => this.logger.log(line));
    } catch (error) {
      this.logger.error(`First-run setup failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  private async createFirstAdministrator() {
    if (await this.prisma.staff.count({ where: { role: "OWNER" } })) return;
    const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD;
    if (!email || !password) {
      this.logger.warn("No system administrator yet. Set ADMIN_EMAIL, ADMIN_NAME and ADMIN_PASSWORD and restart to create one.");
      return;
    }
    const problems = passwordProblems(password, [process.env.ADMIN_NAME, email]);
    if (problems.length) {
      this.logger.error(`ADMIN_PASSWORD is too weak: ${problems.join(" ")}`);
      return;
    }
    await this.prisma.staff.create({
      data: { name: process.env.ADMIN_NAME?.trim() || "System administrator", email, role: "OWNER", department: "director", jobTitle: "System administrator", staffNo: staffNumber(), passwordHash: await bcrypt.hash(password, 12) },
    });
    this.logger.log(`System administrator ${email} created. Sign in at /admin/login, set up two-step verification, then remove ADMIN_PASSWORD.`);
  }
}
