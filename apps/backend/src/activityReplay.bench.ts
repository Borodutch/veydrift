// Run manually: bun src/activityReplay.bench.ts
// Real indexer schema; measure both ordered cursor and actual V3 migration.
import { Database } from "bun:sqlite";
import { SettlementIndexer } from "./indexer";
for (const count of [100_000, 200_000, 400_000]) {
  const database = new Database(":memory:");
  const indexer = new SettlementIndexer({ async listSettledPlanetEvents(){return []}, async listDebrisFieldEvents(){return []}, async listMoonChanceReportEvents(){return []} }, 1n, {database,runStartupBackfill:false});
  const insert = database.query("INSERT INTO indexed_event_logs VALUES (?,?,?,?,0,?,?)");
  const event = JSON.stringify({topics:["0x000"],data:"0x",blockTimestamp:"0x1"});
  database.transaction(() => {
    for(let i=0;i<count;i++) insert.run(String(i),"tx"+i,String(i%10),String(Math.floor(i/10)),event,"now");
  })();
  const sql="SELECT event_id, event_json FROM indexed_event_logs WHERE removed = 0 ORDER BY CAST(block_number AS INTEGER), length(log_index), log_index, event_id";
  const start=performance.now(); let visited=0;
  for(const _row of database.query(sql).iterate()) visited++;
  const cursorMs=performance.now()-start;
  database.query("DELETE FROM indexer_metadata WHERE key = 'playerActivityFeedBackfilledV3'").run();
  const migrationStart=performance.now();
  (indexer as unknown as {backfillPlayerActivityFeed():void}).backfillPlayerActivityFeed();
  const migrationMs=performance.now()-migrationStart;
  if(visited!==count) throw new Error("cursor skipped rows");
  console.log(JSON.stringify({count,cursorMs:Math.round(cursorMs),migrationMs:Math.round(migrationMs)}));
  database.close();
}
