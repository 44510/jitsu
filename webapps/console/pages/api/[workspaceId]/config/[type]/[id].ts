import { Api, inferUrl, nextJsApiHandler, verifyAccess } from "../../../../../lib/api";
import { z } from "zod";
import { db } from "../../../../../lib/server/db";
import { getServerLog } from "../../../../../lib/server/log";
import { ApiError } from "../../../../../lib/shared/errors";
import { fastStore } from "../../../../../lib/server/fast-store";
import { getConfigObjectType, parseObject } from "../../../../../lib/schema/config-objects";
import { prepareZodObjectForDeserialization } from "../../../../../lib/zod";

function defaultMerge(a, b) {
  return { ...a, ...b };
}

const log = getServerLog("config-api");

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "20mb", // Set desired value here
    },
  },
};

export const api: Api = {
  url: inferUrl(__filename),
  GET: {
    auth: true,
    types: {
      query: z.object({ type: z.string(), workspaceId: z.string(), id: z.string() }),
    },
    handle: async ({ user, query: { id, workspaceId, type } }) => {
      await verifyAccess(user, workspaceId);
      const configObjectType = getConfigObjectType(type);
      const object = await db.prisma().configurationObject.findFirst({
        where: { workspaceId, id, deleted: false },
      });
      if (!object) {
        throw new ApiError(`${type} with id ${id} does not exist`, {}, { status: 400 });
      }
      const preFilter = { ...((object.config as any) || {}), workspaceId, id, type };
      return configObjectType.outputFilter(preFilter);
    },
  },
  PUT: {
    types: {
      query: z.object({ type: z.string(), workspaceId: z.string(), id: z.string() }),
    },
    auth: true,
    handle: async ({ user, body, query }) => {
      body = prepareZodObjectForDeserialization(body);
      const { id, workspaceId, type } = query;
      await verifyAccess(user, workspaceId);
      const configObjectType = getConfigObjectType(type);
      const object = await db.prisma().configurationObject.findFirst({
        where: { workspaceId: workspaceId, id, deleted: false },
      });
      if (!object) {
        throw new ApiError(`${type} with id ${id} does not exist`);
      }
      const data = parseObject(type, body);
      const merged = configObjectType.merge(object.config, data);
      const filtered = await configObjectType.inputFilter(merged, "update");

      delete filtered.id;
      delete filtered.workspaceId;
      await db.prisma().configurationObject.update({ where: { id }, data: { config: filtered } });
      await fastStore.fullRefresh();
    },
  },
  DELETE: {
    auth: true,
    types: {
      query: z.object({ type: z.string(), workspaceId: z.string(), id: z.string() }),
    },
    handle: async ({ user, body, query }) => {
      const { id, workspaceId, type } = query;
      await verifyAccess(user, workspaceId);
      const object = await db.prisma().configurationObject.findFirst({
        where: { workspaceId: workspaceId, id, deleted: false },
      });
      if (object) {
        await db.prisma().configurationObject.update({
          where: { id: object.id },
          data: { deleted: true },
        });
        await fastStore.fullRefresh();
        return { ...((object.config as any) || {}), workspaceId, id, type };
      }
    },
  },
};

export default nextJsApiHandler(api);
