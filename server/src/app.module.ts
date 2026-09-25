import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { ScheduleModule } from "@nestjs/schedule";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { PrismaModule } from "./prisma/prisma.module";
import { EventsModule } from "./events/events.module";
import { EmailModule } from "./email/email.module";

import { SessionService } from "./auth/session.service";
import { AuthService } from "./auth/auth.service";
import { StudentAuthService } from "./auth/student-auth.service";
import { SocialIdentityService } from "./auth/social-identity";
import { JwtAuthGuard } from "./auth/jwt-auth.guard";
import { RolesGuard } from "./auth/roles.guard";
import { AuthController } from "./auth/auth.controller";
import { SignInController } from "./auth/sign-in.controller";
import { StudentAccountController } from "./auth/student-account.controller";

import { ActivityService } from "./activity/activity.service";
import { ActivityController } from "./activity/activity.controller";
import { WebhooksService } from "./integrations/webhooks.service";
import { FeedsController } from "./integrations/feeds.controller";
import { NotificationsService } from "./messaging/notifications.service";
import { MessagingService } from "./messaging/messaging.service";
import { MessagingController } from "./messaging/messaging.controller";
import { ResourceService } from "./resources/resource.service";
import { ResourcesController } from "./resources/resources.controller";
import { PublicResourcesController } from "./resources/public-resources.controller";
import { SiteContentService } from "./site/site-content.service";
import { SiteController } from "./site/site.controller";
import { StaffService } from "./staff/staff.service";
import { StaffController } from "./staff/staff.controller";
import { HrService } from "./hr/hr.service";
import { HrController } from "./hr/hr.controller";
import { AdmissionsService } from "./admissions/admissions.service";
import { AdmissionsController, PublicAdmissionsController } from "./admissions/admissions.controller";
import { TeachingService } from "./teaching/teaching.service";
import { TeachingController } from "./teaching/teaching.controller";
import { PortalService } from "./portal/portal.service";
import { PortalController } from "./portal/portal.controller";
import { FinanceService } from "./finance/finance.service";
import { FinanceController } from "./finance/finance.controller";
import { StorageService } from "./uploads/storage.service";
import { UploadsService } from "./uploads/uploads.service";
import { UploadsController } from "./uploads/uploads.controller";
import { WorkspaceService } from "./workspace/workspace.service";
import { WorkspaceController } from "./workspace/workspace.controller";
import { GuidesService } from "./guides/guides.service";
import { GuidesController } from "./guides/guides.controller";
import { GeminiClient } from "./assistant/gemini.client";
import { AssistantService } from "./assistant/assistant.service";
import { AssistantController } from "./assistant/assistant.controller";
import { ReportsService } from "./reports/reports.service";
import { ReportsController } from "./reports/reports.controller";
import { HealthController } from "./common/health.controller";
import { SetupService } from "./setup/setup.service";

/**
 * The whole API in one module: every controller (URL handlers) and service (the work behind them).
 * Folders under src/ group each area; this file just wires them together.
 */
@Module({
  imports: [
    PrismaModule,
    EventsModule,
    EmailModule,
    ScheduleModule.forRoot(),
    // A general per-address limit; sign-in and public forms have tighter limits of their own.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: Number(process.env.RATE_LIMIT_PER_MINUTE) || 600 }]),
    JwtModule.register({ global: true, secret: process.env.JWT_SECRET || "development-only-secret-change-me-please-32chars" }),
  ],
  controllers: [
    HealthController,
    SignInController,
    AuthController,
    StudentAccountController,
    SiteController,
    PublicResourcesController,
    PublicAdmissionsController,
    FeedsController,
    AssistantController,
    ResourcesController,
    AdmissionsController,
    TeachingController,
    PortalController,
    FinanceController,
    StaffController,
    HrController,
    MessagingController,
    ActivityController,
    WorkspaceController,
    GuidesController,
    ReportsController,
    UploadsController,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    SessionService,
    AuthService,
    StudentAuthService,
    SocialIdentityService,
    JwtAuthGuard,
    RolesGuard,
    ActivityService,
    WebhooksService,
    NotificationsService,
    MessagingService,
    ResourceService,
    SiteContentService,
    StaffService,
    HrService,
    AdmissionsService,
    TeachingService,
    PortalService,
    FinanceService,
    StorageService,
    UploadsService,
    WorkspaceService,
    GuidesService,
    GeminiClient,
    AssistantService,
    ReportsService,
    SetupService,
  ],
})
export class AppModule {}
