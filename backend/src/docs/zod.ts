import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

// Extiende zod con `.openapi()` una sola vez para toda la aplicación.
extendZodWithOpenApi(z);

export { z };
