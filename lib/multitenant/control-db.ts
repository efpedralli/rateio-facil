// lib/control-db.ts
import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __controlPool: Pool | undefined;
}

export const controlPool =
  global.__controlPool ??
  new Pool({
    connectionString: process.env.CONTROL_DATABASE_URL,
    max: 10,
  });

if (process.env.NODE_ENV !== "production") {
  global.__controlPool = controlPool;
}