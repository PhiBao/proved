/**
 * SHA-256 of the built WASM, as the lower-case hex the ecosystem uses.
 *
 * The ledger stores a contract's executable hash this way, which is why it is
 * the form worth printing: it can be compared with `getLedgerEntries` and with
 * the hash shown on a block explorer without reformatting anything.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

/** @param {string} path @returns {Promise<string>} */
export function hashFile(path) {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => h.update(chunk))
      .on("end", () => resolve(h.digest("hex")))
      .on("error", reject);
  });
}