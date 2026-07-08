/**
 * Mongoose connection with retry. Works against MongoDB 5+, MongoDB Atlas,
 * and MongoDB-wire-compatible servers (FerretDB was used for offline testing).
 */
const mongoose = require('mongoose');
const config = require('./index');
const log = require('../utils/logger')('db');

const MAX_RETRIES = 5;

async function connect() {
  mongoose.set('strictQuery', true);
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await mongoose.connect(config.mongoUri, {
        serverSelectionTimeoutMS: 8000,
      });
      log.info(`Connected to MongoDB (${redact(config.mongoUri)})`);
      return mongoose.connection;
    } catch (err) {
      const wait = Math.min(2 ** attempt, 30);
      log.error(
        `MongoDB connect attempt ${attempt}/${MAX_RETRIES} failed: ${err.message}` +
          (attempt < MAX_RETRIES ? ` - retrying in ${wait}s` : '')
      );
      if (attempt === MAX_RETRIES) throw err;
      await new Promise((r) => setTimeout(r, wait * 1000));
    }
  }
}

/** Hide credentials when logging the connection string. */
function redact(uri) {
  return uri.replace(/\/\/([^:@/]+):([^@/]+)@/, '//$1:***@');
}

async function disconnect() {
  await mongoose.disconnect();
}

module.exports = { connect, disconnect };
