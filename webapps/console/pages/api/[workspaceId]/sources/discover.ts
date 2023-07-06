import { db } from "../../../../lib/server/db";
import { z } from "zod";
import { createRoute, verifyAccess } from "../../../../lib/api";
import { ServiceConfig } from "../../../../lib/schema";
import { requireDefined, rpc } from "juava";
import { tryManageOauthCreds } from "../../../../lib/server/oauth/services";
import { getServerLog } from "../../../../lib/server/log";
import { syncError } from "../../../../lib/shared/errors";

const log = getServerLog("sync-discover");

const resultType = z.object({
  ok: z.boolean(),
  pending: z.boolean().optional(),
  catalog: z.object({}).passthrough().optional(),
  error: z.string().optional(),
});

const queryType = z.object({
  workspaceId: z.string(),
  package: z.string(),
  version: z.string(),
  storageKey: z.string(),
});

type queryType = z.infer<typeof queryType>;

export default createRoute()
  .POST({
    auth: true,
    query: z.object({
      workspaceId: z.string(),
      storageKey: z.string(),
      refresh: z.boolean().optional(),
    }),
    body: ServiceConfig,
    result: resultType,
  })
  .handler(async ({ user, query, body, req }) => {
    const { workspaceId } = query;
    await verifyAccess(user, workspaceId);

    const syncURL = requireDefined(
      process.env.SYNCCTL_URL,
      `env SYNCCTL_URL is not set. Sync Controller is required to run sources`
    );
    if (!query.storageKey.startsWith(workspaceId)) {
      return { ok: false, error: "storageKey doesn't belong to the current workspace" };
    }
    const syncAuthKey = process.env.SYNCCTL_AUTH_KEY ?? "";
    const authHeaders: any = {};
    if (syncAuthKey) {
      authHeaders["Authorization"] = `Bearer ${syncAuthKey}`;
    }

    try {
      if (!query.refresh) {
        const res = await checkInDb({ ...query, package: body.package, version: body.version });
        if (res && !res.error) {
          return res;
        }
      }
      const checkRes = await rpc(syncURL + "/discover", {
        method: "POST",
        body: {
          config: await tryManageOauthCreds(body as ServiceConfig, req),
        },
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
        },
        query: {
          package: body.package,
          version: body.version,
          storageKey: query.storageKey,
        },
      });
      if (!checkRes.ok) {
        return { ok: false, error: checkRes.error ?? "unknown error" };
      } else {
        return { ok: false, pending: true };
      }
    } catch (e: any) {
      return syncError(
        log,
        `Error running discover`,
        e,
        false,
        `source: ${query.storageKey} workspace: ${workspaceId}`
      );
    }
  })
  .GET({
    auth: true,
    query: queryType,
    result: resultType,
  })
  .handler(async ({ user, query, body }) => {
    const { workspaceId } = query;
    await verifyAccess(user, workspaceId);
    if (!query.storageKey.startsWith(workspaceId)) {
      return { ok: false, error: "storageKey doesn't belong to the current workspace" };
    }
    try {
      const res = await checkInDb(query);
      if (res) {
        return res;
      } else {
        throw new Error("catalog not found in the database");
      }
    } catch (e: any) {
      return syncError(
        log,
        `Error running discover`,
        e,
        false,
        `source: ${query.storageKey} workspace: ${workspaceId}`
      );
    }
  })
  .toNextApiHandler();

async function checkInDb(query: queryType) {
  const res = await db
    .pgPool()
    .query(`select catalog, status, description from source_catalog where key = $1 and package = $2 and version = $3`, [
      query.storageKey,
      query.package,
      query.version,
    ]);
  if (res.rowCount === 1) {
    const status = res.rows[0].status;
    const catalog = res.rows[0].catalog;
    const description = res.rows[0].description;
    switch (status) {
      case "SUCCESS":
        return { ok: true, catalog: selectStreamsFromCatalog(catalog) };
      case "RUNNING":
        return { ok: false, pending: true };
      default:
        return { ok: false, error: description };
    }
  } else {
    return null;
  }
}

function selectStreamsFromCatalog(catalog: any): any {
  let streams: any[] = [];
  for (const stream of catalog.streams) {
    streams.push({
      sync_mode: stream.supported_sync_modes[0],
      destination_sync_mode: "overwrite",
      stream: { ...stream },
    });
  }
  return { streams };
}
