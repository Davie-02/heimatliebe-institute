import { Controller, MessageEvent, ServiceUnavailableException, Sse } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { Observable, map } from "rxjs";
import { EventsService } from "./events.service";

@Controller("events")
@SkipThrottle()
export class EventsController {
  constructor(private readonly events: EventsService) {}

  // Public: carries topic names only, no content. Capped so a flood of connections can't exhaust a free-tier server.
  @Sse()
  stream(): Observable<MessageEvent> {
    if (this.events.isFull) throw new ServiceUnavailableException("Live updates are busy; pages will refresh on their own.");
    return this.events.stream().pipe(map((event) => ({ type: event.type, data: event.data }) as MessageEvent));
  }
}
