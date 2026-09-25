/* Exporta la especificación OpenAPI a docs/openapi.json (importable en Postman/Insomnia). */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createApp } from '../src/app.js';
import { generateOpenApiDocument } from '../src/docs/registry.js';

createApp(); // registra todas las rutas en el registro OpenAPI
mkdirSync('../docs', { recursive: true });
writeFileSync('../docs/openapi.json', JSON.stringify(generateOpenApiDocument(), null, 2));
console.log('✅ docs/openapi.json generado');
process.exit(0);
