async function createStore(options = {}) {
  const { PostgresStore } = require("./postgres-store");
  return PostgresStore.create(options.postgres || {});
}

module.exports = {
  createStore,
};
