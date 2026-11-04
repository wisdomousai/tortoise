import type { SqlDriver, SqlValue } from '@tortoise/adapters/sql-driver';
import { openDatabaseSync } from 'expo-sqlite';

/**
 * A new `expo-sqlite` connection as a `SqlDriver`. `useNewConnection` matters: Expo otherwise
 * shares one cached connection per name, and the ownership lock must be a connection of its own.
 * Synchronous calls block the JavaScript thread briefly; snapshot documents are small.
 */
export function expoSqlDriver(name: string): SqlDriver {
  const db = openDatabaseSync(name, { useNewConnection: true });
  return {
    exec: (sql) => db.execSync(sql),
    get: <Row>(sql: string, ...params: SqlValue[]) => db.getFirstSync<Row>(sql, ...params),
    run: (sql, ...params) => void db.runSync(sql, ...params),
    close: () => db.closeSync(),
  };
}
