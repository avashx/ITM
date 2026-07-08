/**
 * Socket.io hub. The rest of the app never touches socket.io directly -
 * it calls emit() here, which is a safe no-op until init() runs (this keeps
 * seed scripts and tests free of socket dependencies).
 *
 * Events emitted (see API.md for payloads):
 *   check:result           one probe finished
 *   service:status_change  a service transitioned status
 *   incident:opened / incident:closed
 *   alert:new              outage / recovery / ssl / surge alert raised
 *   grievance:new          a grievance was registered
 *   correlation:insight    correlation engine found a new pattern
 *   monitor:cycle          summary after each check cycle
 */
const { Server } = require('socket.io');
const log = require('../utils/logger')('socket');

let io = null;

function init(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: true }, // same-origin UI by default; relax via reverse proxy if needed
  });
  io.on('connection', (socket) => {
    log.debug(`client connected (${socket.id}), total=${io.engine.clientsCount}`);
    socket.on('disconnect', () => log.debug(`client disconnected (${socket.id})`));
  });
  log.info('Socket.io initialised');
  return io;
}

function emit(event, payload) {
  if (io) io.emit(event, payload);
}

function clientCount() {
  return io ? io.engine.clientsCount : 0;
}

module.exports = { init, emit, clientCount };
