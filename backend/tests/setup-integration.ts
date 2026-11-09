import {
  requireTestDatabaseConfiguration,
  verifyTestDatabaseServer,
} from '../src/lib/test-database-guard.js';

const identity = requireTestDatabaseConfiguration({ allowDatabaseUrlMirror: true });
process.env.DATABASE_URL = identity.url;
process.env.NODE_ENV = 'test';
await verifyTestDatabaseServer(identity, { requireMarker: true });
