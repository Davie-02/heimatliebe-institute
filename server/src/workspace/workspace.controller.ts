import { Controller, Get, HttpCode, Post, Query } from "@nestjs/common";
import { StaffRoute } from "../auth/roles.decorator";
import { CurrentStaff, type StaffActor } from "../access/current-staff.decorator";
import { EmailService } from "../email/email.service";
import { testEmail } from "../email/templates";
import { WorkspaceService } from "./workspace.service";

@Controller("workspace")
@StaffRoute()
export class WorkspaceController {
  constructor(
    private readonly workspace: WorkspaceService,
    private readonly email: EmailService
  ) {}

  @Get("overview")
  overview(@CurrentStaff() me: StaffActor) {
    return this.workspace.overview(me);
  }

  @Get("search")
  search(@CurrentStaff() me: StaffActor, @Query("q") q = "") {
    return this.workspace.search(me, q);
  }

  @Get("system-status")
  status() {
    return this.workspace.systemStatus();
  }

  /** Sends a test email to the person asking, to check the email settings. */
  @Post("test-email")
  @HttpCode(200)
  testEmail(@CurrentStaff() me: StaffActor) {
    return this.email.sendChecked({ to: me.email, ...testEmail() });
  }
}
