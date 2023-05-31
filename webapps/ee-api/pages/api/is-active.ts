import { NextApiRequest, NextApiResponse } from "next";
import { getLog } from "juava";
import { auth } from "../../lib/firebase-auth";
import { withErrorHandler } from "../../lib/error-handler";
import { telemetryDb } from "../../lib/services";

const log = getLog("/api/is-active");

const handler = async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Methods", "*");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Cache-Control", "private, max-age=3600");
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }
  const claims = await auth(req, res);
  if (!claims) {
    return;
  }
  log.atInfo().log("claims", JSON.stringify(claims));
  let uid = claims.uid;
  let projectId: string | null = null;
  let projectName: string | null = null;
  try {
    const pool = await telemetryDb.waitInit();
    // if (!uid) {
    //   const rows = await pool.query("select _uid from jitsu_configs_users_info where _email=$1 limit 1", [
    //     claims.email,
    //   ]);
    //   if (rows.rowCount === 0) {
    //     return { ok: true, uid: null, project: null };
    //   }
    //   uid = rows.rows[0]["_uid"];
    // }

    const projectRow = await pool.query(
      "select _project__id, p.name as name from jitsu_configs_users_info u left join jitsu_configs_projects p on p.id=u._project__id where u._uid=$1 limit 1",
      [uid]
    );
    if (projectRow.rowCount === 0) {
      return { ok: true, uid: uid, project: null, name: null, active: false };
    }
    projectId = projectRow.rows[0]["_project__id"];
    projectName = projectRow.rows[0]["name"];

    const isActiveRow = await pool.query(
      "select is_active from jitsu_classic_active_projects where project_id=$1 limit 1",
      [projectId]
    );
    if (isActiveRow.rowCount === 1) {
      return { ok: true, uid: uid, project: projectId, name: projectName, active: isActiveRow.rows[0]["is_active"] };
    }
    const countRows = await pool.query(
      `
          select coalesce(sum(value), 0) as events_count
          from (select to_date(lpad(REGEXP_REPLACE(eventn_ctx_event_id, '^.*month#(\\d{4})(\\d{2}):success/(\\d{1,2})$',
                                                  '\\3\\2\\1'), 8, '0'), 'DDMMYYY') dt,
                      value::int
               from jitsu_configs_daily_stat
               where eventn_ctx_event_id like 'daily_events:destination#' || $1 || '.%success/%'
                         ) q
          where q.dt > now() - interval '31 day'
       `,
      [projectId]
    );
    const eventsCount = countRows.rows[0]["events_count"];
    return { ok: true, uid: uid, project: projectId, name: projectName, active: eventsCount > 0 };
  } catch (e) {
    log.atError().log("error accessing telemetry db ", e);
    return {
      ok: false,
      uid: uid,
      project: projectId,
      name: projectName,
      active: null,
      error: "error accessing telemetry db",
    };
  }
};
export default withErrorHandler(handler);
