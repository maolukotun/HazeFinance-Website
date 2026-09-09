// SPDX-License-Identifier: MIT

/** @param {import("../../aggregation/store.js").ProfileStore} store */
export function makeHealthHandler(store) {
  /**
   * @param {import("node:http").IncomingMessage} _req
   * @param {import("node:http").ServerResponse} res
   */
  return function handleHealth(_req, res) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok", profileCount: store.size() }));
  };
}
