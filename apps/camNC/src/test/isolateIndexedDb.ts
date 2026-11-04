// Test files run in parallel on one browser origin, so they would share every IndexedDB database: a job left by one
// file renames the next one's ("kinderregal-eiche (8)"), and counting jobs races with the other files. Clearing it
// between files isn't safe while they run together, so each file gets its own databases.
const file = crypto.randomUUID();
const openDb = IDBFactory.prototype.open;
IDBFactory.prototype.open = function (name: string, version?: number) {
  return openDb.call(this, `${file}:${name}`, version);
};

export {};
