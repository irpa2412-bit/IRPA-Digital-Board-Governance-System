// ES-module test/runtime entrypoint for the queue implementation.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { queueInductionEmail, retry } = require("./queueInductionEmail.js");
export { queueInductionEmail, retry };
