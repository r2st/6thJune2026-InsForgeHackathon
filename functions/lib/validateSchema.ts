// Minimal JSON-Schema validator — just the keywords the Hush schemas use.
//
// We deliberately avoid pulling in ajv: edge functions deploy file-by-file
// with no bundler (see functions/README.md), and the contract surface is
// small and frozen. Supports: type, required, properties,
// additionalProperties:false, enum, maxLength, minLength, minimum, pattern.
// Throws on the first violation with a JSON-pointer-ish path so failures are
// debuggable; returns void on success.

export interface JsonSchema {
  type?: 'object' | 'array' | 'string' | 'integer' | 'number' | 'boolean' | 'null';
  required?: string[];
  properties?: Record<string, JsonSchema>;
  additionalProperties?: boolean;
  items?: JsonSchema;
  enum?: unknown[];
  maxLength?: number;
  minLength?: number;
  minimum?: number;
  pattern?: string;
  // Allowed but ignored (documentation-only keywords on our schemas):
  description?: string;
  [k: string]: unknown;
}

export class SchemaValidationError extends Error {
  constructor(message: string, readonly path: string) {
    super(`${path || '<root>'}: ${message}`);
    this.name = 'SchemaValidationError';
  }
}

export function validate(value: unknown, schema: JsonSchema, path = ''): void {
  if (schema.type !== undefined && !matchesType(value, schema.type)) {
    throw new SchemaValidationError(`expected type ${schema.type}`, path);
  }

  if (schema.enum && !schema.enum.some((e) => e === value)) {
    throw new SchemaValidationError(`value not in enum`, path);
  }

  if (typeof value === 'string') {
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      throw new SchemaValidationError(`longer than maxLength ${schema.maxLength}`, path);
    }
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      throw new SchemaValidationError(`shorter than minLength ${schema.minLength}`, path);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      throw new SchemaValidationError(`does not match pattern ${schema.pattern}`, path);
    }
  }

  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) {
    throw new SchemaValidationError(`below minimum ${schema.minimum}`, path);
  }

  if (schema.type === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new SchemaValidationError('expected object', path);
    }
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in obj)) throw new SchemaValidationError(`missing required field "${key}"`, path);
    }
    const props = schema.properties ?? {};
    for (const key of Object.keys(obj)) {
      const propSchema = props[key];
      if (propSchema !== undefined) {
        validate(obj[key], propSchema, path ? `${path}.${key}` : key);
      } else if (schema.additionalProperties === false) {
        throw new SchemaValidationError(`unexpected field "${key}"`, path);
      }
    }
  }

  if (schema.type === 'array' && schema.items && Array.isArray(value)) {
    value.forEach((item, i) => validate(item, schema.items!, `${path}[${i}]`));
  }
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'number':
      return typeof value === 'number';
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    default:
      return true;
  }
}
