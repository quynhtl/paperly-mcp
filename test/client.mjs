// Starts the real server as Claude does -- `node server/index.mjs`, spoken to
// over stdin and stdout -- and sends it requests.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const SERVER = fileURLToPath(new URL("../server/index.mjs", import.meta.url));

export function startServer(env = {}) {
  const child = spawn(process.execPath, [SERVER], { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
  const waiting = new Map();
  const unmatched = [];
  let buffer = "";
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const message = JSON.parse(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      const resolve = waiting.get(message.id);
      if (resolve) {
        waiting.delete(message.id);
        resolve(message);
      } else {
        unmatched.push(message);
      }
    }
  });
  let nextID = 1;
  return {
    /** Sends a request and resolves to the whole response. */
    request(method, params) {
      const id = nextID++;
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      return new Promise((resolve) => waiting.set(id, resolve));
    },
    notify(method, params) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
    },
    /** Sends a raw line, for malformed input. Resolves to the next unmatched message. */
    async raw(line) {
      child.stdin.write(`${line}\n`);
      for (let i = 0; i < 100 && !unmatched.length; i++) {
        await new Promise((r) => setTimeout(r, 20));
      }
      return unmatched.shift();
    },
    /** Calls a tool and resolves to { text, isError }. */
    async call(name, args) {
      const { result, error } = await this.request("tools/call", { name, arguments: args });
      if (error) {
        return { error };
      }
      return { text: result.content.map((c) => c.text).join("\n"), isError: result.isError };
    },
    get stderr() {
      return stderr;
    },
    close() {
      child.stdin.end();
      return new Promise((resolve) => child.on("close", resolve));
    },
  };
}
