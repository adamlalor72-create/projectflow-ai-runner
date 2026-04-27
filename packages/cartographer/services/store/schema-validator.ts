import Ajv from "ajv";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.resolve(__dirname, "../../schemas/ui-map.schema.json");

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
export const validateUIMap = ajv.compile(schema);
