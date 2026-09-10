// Every suite in this project talks to one shared mongodb-memory-server replica set
// (started once in jest.global-setup.js, because spinning one up per suite is slow).
// Sharing the *server* is fine; sharing the *database* is not — suites that create
// fixtures with the same _id, or that read collection-wide (findAll, replay,
// check-invariants), would otherwise see each other's leftovers, making the run
// order-dependent and flaky.
//
// So: rewrite MONGO_URI here, before the test module is imported, to point at a
// database named after the test file. Suites stay isolated without every one of them
// having to remember to clean up every collection it touches.
const path = require('path');

const base = process.env.MONGO_URI;
if (base) {
  const testPath = expect.getState().testPath ?? 'unknown';
  const dbName = `test_${path.basename(testPath).replace(/[^a-zA-Z0-9]/g, '_')}`;
  const uri = new URL(base);
  uri.pathname = `/${dbName}`;
  process.env.MONGO_URI = uri.toString();
}
