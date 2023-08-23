import { createRoute } from "../../../lib/api";
import { redis } from "../../../lib/server/redis";
import { ApiError } from "../../../lib/shared/errors";
import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { getErrorMessage, getLog } from "juava";
import { patchEvent, sendEventToBulker, setResponseHeaders } from "./[...type]";
import { z } from "zod";

export default createRoute()
  .POST({
    auth: false,
    body: z.any(),
  })
  .handler(async ({ body, req, res }) => {
    //make sure that redis is initialized
    await redis.waitInit();

    const { batch } = body;
    if (!batch) {
      throw new ApiError("Payload should contain `batch` node", { status: 400 });
    }

    if (!Array.isArray(batch)) {
      throw new ApiError("`batch` node should be an array", { status: 400 });
    }

    const size = (batch as any[]).length;
    setResponseHeaders({ req, res });
    let okEvents = 0;
    const errors: string[] = [];
    for (let i = 0; i < size; i++) {
      const _event = (batch as any[])[i];
      const event = _event as AnalyticsServerEvent;
      try {
        const ingestType = "s2s";
        patchEvent(event, "event", req, ingestType);
        await sendEventToBulker(req, ingestType, event);
        okEvents++;
      } catch (e) {
        getLog().atWarn().log(`Failed to process event ${i} / ${size} `, e);
        errors.push(getErrorMessage(e));
      }
    }
    if (okEvents == size) {
      return { ok: true, receivedEvents: size, okEvents: size };
    } else if (okEvents === 0) {
      return { ok: false, receivedEvents: size, okEvents, errors };
    }
  })
  .toNextApiHandler();
