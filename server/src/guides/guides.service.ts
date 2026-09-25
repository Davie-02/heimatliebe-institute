import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { EventsService } from "../events/events.service";
import { GUIDE_DEFAULTS } from "./guide-defaults";

/** Help pages: built-in defaults, overridden by whatever the system administrator saved. */
@Injectable()
export class GuidesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService
  ) {}

  async list() {
    const saved = await this.prisma.guide.findMany();
    const byKey = new Map(saved.map((g) => [g.key, g]));
    return GUIDE_DEFAULTS.map((d, index) => {
      const s = byKey.get(d.key);
      return { key: d.key, module: d.module, title: s?.title ?? d.title, body: s?.body ?? d.body, position: index, edited: Boolean(s) };
    });
  }

  async save(key: string, title: string, body: string) {
    const d = GUIDE_DEFAULTS.find((g) => g.key === key);
    if (!d) throw new NotFoundException("Unknown guide.");
    const row = await this.prisma.guide.upsert({ where: { key }, create: { key, module: d.module, title, body }, update: { title, body } });
    this.events.emit(["guides"]);
    return row;
  }

  async reset(key: string) {
    await this.prisma.guide.deleteMany({ where: { key } });
    this.events.emit(["guides"]);
    return { reset: true };
  }
}
