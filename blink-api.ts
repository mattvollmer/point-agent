// Wrapper to force Node.js client import
// We use createRequire to load the CommonJS version which is definitely Node.js
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const Client = require("@blink.so/api");

export default Client.default || Client;
