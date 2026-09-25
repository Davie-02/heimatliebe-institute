import { Injectable, Logger } from "@nestjs/common";
import { createHmac } from "crypto";
import { lookup } from "dns/promises";
import { isIP } from "net";
import { PrismaService } from "../prisma/prisma.service";

/** Addresses a webhook must never reach: this machine, the private network, cloud metadata services. */
export function isPrivateAddress(ip: string): boolean {
  const v4 = ip.replace(/^::ffff:/, "");
  if (isIP(v4) === 4) {
    const [a, b] = v4.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const lower = ip.toLowerCase();
  return lower === "::1" || lower === "::" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80");
}

export function signPayload(secret: string, timestamp: string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

/**
 * Outgoing webhooks: when something happens (an application arrives, a payment is confirmed…),
 * every active webhook subscribed to that event gets a POST with a JSON body:
 *   { event, occurredAt, data }
 * and the headers
 *   X-Heimatliebe-Event:     the event name
 *   X-Heimatliebe-Timestamp: seconds since 1970
 *   X-Heimatliebe-Signature: sha256=<HMAC-SHA256 of "<timestamp>.<body>" with the webhook's secret>
 * so the receiver can prove the message came from us and isn't a replay.
 * Delivery happens in the background and never slows down the action that caused it.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(private readonly prisma: PrismaService) {}

  dispatch(event: string, data: unknown): void {
    void this.deliverAll(event, data).catch((error) => this.logger.warn(`Webhook dispatch failed: ${error instanceof Error ? error.message : error}`));
  }

  private async deliverAll(event: string, data: unknown): Promise<void> {
    const hooks = await this.prisma.webhook.findMany({ where: { active: true } });
    const matching = hooks.filter((hook) => hook.events.split(",").map((e) => e.trim()).some((e) => e === "*" || e === event || (e.endsWith(".*") && event.startsWith(e.slice(0, -1)))));
    await Promise.all(matching.map((hook) => this.deliver(hook, event, data)));
  }

  private async deliver(hook: { id: string; url: string; secret: string }, event: string, data: unknown): Promise<void> {
    let status: string;
    try {
      const url = new URL(hook.url);
      if (url.protocol !== "https:") throw new Error("only https addresses are allowed");
      const host = url.hostname.replace(/^\[|\]$/g, "");
      const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((entry) => entry.address);
      if (addresses.some(isPrivateAddress)) throw new Error("private network addresses are not allowed");

      const body = JSON.stringify({ event, occurredAt: new Date().toISOString(), data });
      const timestamp = String(Math.floor(Date.now() / 1000));
      const response = await fetch(url, {
        method: "POST",
        redirect: "manual",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Heimatliebe-Webhooks/1.0",
          "X-Heimatliebe-Event": event,
          "X-Heimatliebe-Timestamp": timestamp,
          "X-Heimatliebe-Signature": `sha256=${signPayload(hook.secret, timestamp, body)}`,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      status = `${response.status} ${response.ok ? "OK" : "failed"}`;
    } catch (error) {
      status = `error: ${error instanceof Error ? error.message : "unknown"}`.slice(0, 80);
    }
    await this.prisma.webhook.update({ where: { id: hook.id }, data: { lastStatus: status, lastSentAt: new Date() } }).catch(() => undefined);
  }
}
