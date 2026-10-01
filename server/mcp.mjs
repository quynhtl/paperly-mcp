// The Model Context Protocol, as much of it as a server that only offers tools
// needs: JSON-RPC 2.0 messages, one per line, on stdin and stdout.
//
// Written out rather than taken from the SDK so the server has no
// dependencies: nothing is downloaded when the plugin is installed, and every
// line that runs is in this repository. Logging goes to stderr, because
// stdout belongs to the protocol.

// Newest first. A client asking for one of these gets it; any other gets the newest.
export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

/** An error a tool reports to the model, as opposed to a bug. */
export class ToolError extends Error {}

/**
 * Checks arguments against the small part of JSON Schema the tools use:
 * required properties, types, enums, string and array lengths, and numeric
 * bounds. Returns a message, or null when they are fine.
 */
export function checkArguments(schema, args) {
  if (args === undefined || args === null) {
    args = {};
  }
  if (typeof args !== "object" || Array.isArray(args)) {
    return "The arguments must be an object.";
  }
  for (const name of schema.required || []) {
    if (args[name] === undefined) {
      return `"${name}" is required.`;
    }
  }
  for (const [name, value] of Object.entries(args)) {
    const property = schema.properties?.[name];
    if (!property) {
      if (schema.additionalProperties === false) {
        return `"${name}" is not an argument of this tool.`;
      }
      continue;
    }
    const problem = checkValue(property, value, name);
    if (problem) {
      return problem;
    }
  }
  return null;
}

function checkValue(schema, value, name) {
  switch (schema.type) {
    case "string":
      if (typeof value !== "string") return `"${name}" must be a string.`;
      if (schema.minLength !== undefined && value.length < schema.minLength) return `"${name}" is too short.`;
      if (schema.maxLength !== undefined && value.length > schema.maxLength) return `"${name}" is too long.`;
      if (schema.enum && !schema.enum.includes(value)) return `"${name}" must be one of: ${schema.enum.join(", ")}.`;
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) return `"${name}" is not in the expected format.`;
      return null;
    case "integer":
      if (!Number.isInteger(value)) return `"${name}" must be a whole number.`;
      if (schema.minimum !== undefined && value < schema.minimum) return `"${name}" must be at least ${schema.minimum}.`;
      if (schema.maximum !== undefined && value > schema.maximum) return `"${name}" must be at most ${schema.maximum}.`;
      return null;
    case "boolean":
      return typeof value === "boolean" ? null : `"${name}" must be true or false.`;
    case "array":
      if (!Array.isArray(value)) return `"${name}" must be a list.`;
      if (schema.minItems !== undefined && value.length < schema.minItems) return `"${name}" needs at least ${schema.minItems} entries.`;
      if (schema.maxItems !== undefined && value.length > schema.maxItems) return `"${name}" takes at most ${schema.maxItems} entries.`;
      for (const [i, item] of value.entries()) {
        const problem = checkValue(schema.items, item, `${name}[${i}]`);
        if (problem) return problem;
      }
      return null;
    default:
      return null;
  }
}

export class McpServer {
  constructor({ name, title, version, instructions, log = (...args) => console.error(...args) }) {
    this.info = { name, title, version };
    this.instructions = instructions;
    this.log = log;
    this.tools = new Map();
  }

  /**
   * Adds a tool. `run(args)` returns the text for the model, or throws a
   * ToolError with what went wrong.
   */
  tool({ name, title, description, inputSchema, annotations = {}, run }) {
    this.tools.set(name, { name, title, description, inputSchema, annotations: { title, ...annotations }, run });
  }

  /** One message in, its response out (null for a notification). */
  async handle(message) {
    if (!message || typeof message !== "object" || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
      return error(message?.id ?? null, INVALID_REQUEST, "Not a JSON-RPC 2.0 request");
    }
    const { id, method, params } = message;
    const isNotification = id === undefined;
    try {
      const result = await this.dispatch(method, params || {});
      if (isNotification) {
        return null;
      }
      if (result === undefined) {
        return error(id, METHOD_NOT_FOUND, `Method not found: ${method}`);
      }
      return { jsonrpc: "2.0", id, result };
    } catch (e) {
      if (isNotification) {
        return null;
      }
      if (e instanceof RpcError) {
        return error(id, e.code, e.message);
      }
      this.log(`${method} failed:`, e);
      return error(id, INTERNAL_ERROR, "Internal error");
    }
  }

  async dispatch(method, params) {
    switch (method) {
      case "initialize": {
        const asked = params.protocolVersion;
        return {
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: this.info,
          ...(this.instructions && { instructions: this.instructions }),
        };
      }
      case "ping":
        return {};
      case "tools/list":
        return {
          tools: [...this.tools.values()].map(({ name, title, description, inputSchema, annotations }) => ({
            name,
            title,
            description,
            inputSchema,
            annotations,
          })),
        };
      case "tools/call":
        return this.call(params);
      default:
        // Notifications (initialized, cancelled, ...) need no answer
        return method.startsWith("notifications/") ? {} : undefined;
    }
  }

  async call({ name, arguments: args }) {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new RpcError(INVALID_PARAMS, `Unknown tool: ${name}`);
    }
    // Mistakes a model can fix go back to it as a tool error, not a protocol one
    const problem = checkArguments(tool.inputSchema, args);
    if (problem) {
      return { content: [{ type: "text", text: problem }], isError: true };
    }
    try {
      const text = await tool.run(args || {});
      return { content: [{ type: "text", text }], isError: false };
    } catch (e) {
      if (e instanceof ToolError) {
        return { content: [{ type: "text", text: e.message }], isError: true };
      }
      this.log(`${name} failed:`, e);
      return { content: [{ type: "text", text: `${name} failed: ${e.message}` }], isError: true };
    }
  }

  /** Serves on a pair of streams until the input ends. */
  listen(input = process.stdin, output = process.stdout) {
    let buffer = "";
    let queue = Promise.resolve();
    input.setEncoding("utf8");
    input.on("data", (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) {
          // In order: a response never overtakes the one before it
          queue = queue.then(() => this.receive(line, output));
        }
      }
    });
    return new Promise((resolve) => input.on("end", () => queue.then(resolve)));
  }

  async receive(line, output) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      output.write(`${JSON.stringify(error(null, PARSE_ERROR, "Parse error"))}\n`);
      return;
    }
    // Batches belong to older protocol versions; answer each part
    const responses = Array.isArray(message)
      ? (await Promise.all(message.map((m) => this.handle(m)))).filter(Boolean)
      : [await this.handle(message)].filter(Boolean);
    if (Array.isArray(message) && responses.length) {
      output.write(`${JSON.stringify(responses)}\n`);
    } else if (responses.length) {
      output.write(`${JSON.stringify(responses[0])}\n`);
    }
  }
}

class RpcError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function error(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}
