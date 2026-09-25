import { Controller, Get } from "@nestjs/common";
import { StaffRoute } from "../auth/roles.decorator";
import { ReportsService } from "./reports.service";

@Controller("reports")
@StaffRoute()
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get("overview")
  overview() {
    return this.reports.overview();
  }
}
