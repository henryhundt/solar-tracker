import { z } from 'zod';
import { insertSiteSchema, readings, type AuthSessionResponse, type PublicSite } from './schema';
import { eGaugeRegisterInspectionSchema } from './egauge';

// ============================================
// SHARED ERROR SCHEMAS
// ============================================
export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
  unauthorized: z.object({
    message: z.string(),
  }),
};

export const authSessionResponseSchema = z.object({
  authEnabled: z.boolean(),
  authenticated: z.boolean(),
  username: z.string().optional(),
}) satisfies z.ZodType<AuthSessionResponse>;

// ============================================
// API CONTRACT
// ============================================
export const api = {
  auth: {
    session: {
      method: 'GET' as const,
      path: '/api/auth/session',
      responses: {
        200: authSessionResponseSchema,
      },
    },
    login: {
      method: 'POST' as const,
      path: '/api/auth/login',
      input: z.object({
        username: z.string().min(1, "Username is required"),
        password: z.string().min(1, "Password is required"),
      }),
      responses: {
        200: authSessionResponseSchema,
        400: errorSchemas.validation,
        401: errorSchemas.unauthorized,
      },
    },
    logout: {
      method: 'POST' as const,
      path: '/api/auth/logout',
      responses: {
        200: authSessionResponseSchema,
      },
    },
  },
  sites: {
    list: {
      method: 'GET' as const,
      path: '/api/sites',
      input: z.object({
        includeArchived: z.coerce.boolean().optional(),
      }).optional(),
      responses: {
        200: z.array(z.custom<PublicSite>()),
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/sites/:id',
      responses: {
        200: z.custom<PublicSite>(),
        404: errorSchemas.notFound,
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/sites',
      input: insertSiteSchema,
      responses: {
        201: z.custom<PublicSite>(),
        400: errorSchemas.validation,
      },
    },
    update: {
      method: 'PUT' as const,
      path: '/api/sites/:id',
      input: insertSiteSchema.partial(),
      responses: {
        200: z.custom<PublicSite>(),
        400: errorSchemas.validation,
        404: errorSchemas.notFound,
      },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/sites/:id',
      responses: {
        204: z.void(),
        404: errorSchemas.notFound,
        409: errorSchemas.internal,
      },
    },
    archive: {
      method: 'POST' as const,
      path: '/api/sites/:id/archive',
      responses: {
        200: z.custom<PublicSite>(),
        404: errorSchemas.notFound,
        409: errorSchemas.internal,
      },
    },
    restore: {
      method: 'POST' as const,
      path: '/api/sites/:id/restore',
      responses: {
        200: z.custom<PublicSite>(),
        404: errorSchemas.notFound,
      },
    },
    scrape: {
      method: 'POST' as const,
      path: '/api/sites/:id/scrape',
      responses: {
        200: z.object({
          message: z.string(),
          success: z.boolean(),
          readingsCount: z.number().optional(),
        }),
        409: z.object({
          message: z.string(),
          success: z.boolean(),
        }),
        404: errorSchemas.notFound,
        500: errorSchemas.internal,
      },
    },
  },
  readings: {
    list: {
      method: 'GET' as const,
      path: '/api/readings',
      input: z.object({
        siteId: z.coerce.number().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
      }).optional(),
      responses: {
        200: z.array(z.custom<typeof readings.$inferSelect>()),
      },
    },
    export: {
      method: 'GET' as const,
      path: '/api/readings/export',
      input: z.object({
        siteId: z.coerce.number().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
      }).optional(),
      responses: {
        200: z.string(),
      },
    },
  },
  egauge: {
    test: {
      method: 'POST' as const,
      path: '/api/egauge/test',
      input: z.object({
        url: z.string().optional().default(""),
        username: z.string().optional().default(""),
        password: z.string().optional().default(""),
        credentialKey: z.string().optional().default(""),
      }),
      responses: {
        200: z.object({
          success: z.boolean(),
          error: z.string().optional(),
          registers: z.array(eGaugeRegisterInspectionSchema).optional(),
        }),
        400: errorSchemas.validation,
      },
    },
  },
};

// ============================================
// HELPER
// ============================================
export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}
