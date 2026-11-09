/**
 * Shared listen helper for the local servers: bind 127.0.0.1 with port fallback.
 *
 * @module server/listen
 */

export const HOST = '127.0.0.1';
export const PORT_ATTEMPTS = 20;

/**
 * Listen on `HOST`, trying `port`, `port+1`, ... (port 0: the OS picks, no fallback).
 * @param {import('node:http').Server} server
 * @param {number} port
 * @returns {Promise<number>} the bound port
 */
export async function listen(server, port) {
  const attempts = port === 0 ? 1 : PORT_ATTEMPTS;
  for (let i = 0; i < attempts; i++) {
    try {
      await new Promise((resolve, reject) => {
        const onError = (err) => { server.off('listening', onListening); reject(err); };
        const onListening = () => { server.off('error', onError); resolve(); };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port + i, HOST);
      });
      return server.address().port;
    } catch (err) {
      if (err.code !== 'EADDRINUSE' || i === attempts - 1) throw err;
    }
  }
  throw new Error('unreachable');
}
