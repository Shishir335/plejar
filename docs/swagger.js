/**
 * OpenAPI 3.0 Specification and Swagger UI generator for Plezar
 */
const { buildCatalog } = require('../utils/routeCatalog');

// Handcrafted, richly detailed documentation for the primary endpoints
const corePaths = {
  '/api/v1/health': {
    get: {
      tags: ['System & Health'],
      summary: 'API Health Check',
      description: 'Returns server operational status, environment, and current timestamp.',
      responses: {
        200: {
          description: 'Server is healthy',
          content: {
            'application/json': {
              example: {
                status: 'success',
                message: 'API is healthy and operational',
                timestamp: '2026-10-27T00:00:00.000Z',
                environment: 'development'
              }
            }
          }
        }
      }
    }
  },

  // --- AUTHENTICATION & USERS ---
  '/api/v1/users/signup': {
    post: {
      tags: ['Authentication & Users'],
      summary: 'Register a new user account',
      description: 'Creates a standard user account and returns a JWT authentication cookie and token.',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['name', 'email', 'password', 'confirmPassword'],
              properties: {
                name: { type: 'string', example: 'Rahim Ahmed' },
                email: { type: 'string', format: 'email', example: 'rahim@example.com' },
                password: { type: 'string', format: 'password', minLength: 8, example: 'Pass1234!' },
                confirmPassword: { type: 'string', format: 'password', minLength: 8, example: 'Pass1234!' }
              }
            }
          }
        }
      },
      responses: {
        201: { description: 'Account registered successfully' },
        400: { description: 'Invalid input or validation error' }
      }
    }
  },

  '/api/v1/users/login': {
    post: {
      tags: ['Authentication & Users'],
      summary: 'Sign in to an existing account',
      description: 'Authenticates with email and password. Returns JWT token and sets the HTTP-only cookie.',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['email', 'password'],
              properties: {
                email: { type: 'string', format: 'email', example: 'admin@plezar.com' },
                password: { type: 'string', format: 'password', example: 'Secret123!' }
              }
            }
          }
        }
      },
      responses: {
        200: {
          description: 'Authenticated successfully',
          content: {
            'application/json': {
              example: {
                status: 'success',
                token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
                data: {
                  user: {
                    id: '671abc1234567890abcdef12',
                    name: 'Admin User',
                    email: 'admin@plezar.com',
                    role: 'admin'
                  }
                }
              }
            }
          }
        },
        401: { description: 'Incorrect email or password' }
      }
    }
  },

  '/api/v1/users/logout': {
    get: {
      tags: ['Authentication & Users'],
      summary: 'Sign out and clear session cookie',
      responses: {
        200: { description: 'Logged out successfully' }
      }
    }
  },

  '/api/v1/users/me': {
    get: {
      tags: ['Authentication & Users'],
      summary: 'Get current user profile',
      security: [{ bearerAuth: [] }, { cookieAuth: [] }],
      responses: {
        200: { description: 'User profile retrieved successfully' },
        401: { description: 'Unauthorized' }
      }
    }
  },

  '/api/v1/users/updateMe': {
    patch: {
      tags: ['Authentication & Users'],
      summary: 'Update current user profile info',
      security: [{ bearerAuth: [] }],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                name: { type: 'string', example: 'Rahim Updated' },
                email: { type: 'string', format: 'email', example: 'newemail@example.com' }
              }
            }
          }
        }
      },
      responses: {
        200: { description: 'Profile updated' }
      }
    }
  },

  '/api/v1/users/changePassword': {
    patch: {
      tags: ['Authentication & Users'],
      summary: 'Change password while signed in',
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['currentPassword', 'password', 'confirmPassword'],
              properties: {
                currentPassword: { type: 'string', format: 'password' },
                password: { type: 'string', format: 'password', minLength: 8 },
                confirmPassword: { type: 'string', format: 'password', minLength: 8 }
              }
            }
          }
        }
      },
      responses: {
        200: { description: 'Password changed successfully' }
      }
    }
  },

  '/api/v1/users/forgotPassword': {
    post: {
      tags: ['Authentication & Users'],
      summary: 'Request password reset token via email',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['email'],
              properties: {
                email: { type: 'string', format: 'email', example: 'user@example.com' }
              }
            }
          }
        }
      },
      responses: {
        200: { description: 'Reset token dispatched to email' }
      }
    }
  },

  '/api/v1/users/resetPassword/{token}': {
    patch: {
      tags: ['Authentication & Users'],
      summary: 'Reset password using email token',
      parameters: [
        {
          name: 'token',
          in: 'path',
          required: true,
          schema: { type: 'string' }
        }
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['password', 'confirmPassword'],
              properties: {
                password: { type: 'string', minLength: 8 },
                confirmPassword: { type: 'string', minLength: 8 }
              }
            }
          }
        }
      },
      responses: {
        200: { description: 'Password reset successfully' }
      }
    }
  },

  '/api/v1/users/check-email': {
    get: {
      tags: ['Authentication & Users'],
      summary: 'Check if an email is available for registration',
      parameters: [
        {
          name: 'email',
          in: 'query',
          required: true,
          schema: { type: 'string', format: 'email' }
        }
      ],
      responses: {
        200: { description: 'Availability status' }
      }
    }
  },

  // --- NEWSLETTER & SUBSCRIBERS ---
  '/api/v1/subscribers': {
    post: {
      tags: ['Newsletter & Subscribers'],
      summary: 'Subscribe email to drops / newsletter',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['email'],
              properties: {
                email: { type: 'string', format: 'email', example: 'traveler@gmail.com' },
                source: { type: 'string', example: 'landing' }
              }
            }
          }
        }
      },
      responses: {
        201: { description: 'Subscribed successfully' }
      }
    },
    get: {
      tags: ['Newsletter & Subscribers'],
      summary: 'List subscribers (Admin/Manager)',
      security: [{ bearerAuth: [] }],
      responses: {
        200: { description: 'Subscribers list' }
      }
    }
  },

  '/api/v1/subscribers/export': {
    get: {
      tags: ['Newsletter & Subscribers'],
      summary: 'Export subscribers as CSV (Admin/Manager)',
      security: [{ bearerAuth: [] }],
      responses: {
        200: { description: 'CSV file download' }
      }
    }
  },

  // --- AGENCY / VENDOR MEMBERSHIP APPLICATIONS ---
  '/api/v1/applications/categories': {
    get: {
      tags: ['Vendor Applications'],
      summary: 'Get vendor application categories',
      responses: {
        200: { description: 'List of vendor categories' }
      }
    }
  },

  '/api/v1/applications/status': {
    post: {
      tags: ['Vendor Applications'],
      summary: 'Check status of an agency membership application',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['referenceNumber', 'phone'],
              properties: {
                referenceNumber: { type: 'string', example: 'PLZ-2026-1234' },
                phone: { type: 'string', example: '+8801700000000' }
              }
            }
          }
        }
      },
      responses: {
        200: { description: 'Application status and timeline' }
      }
    }
  },

  // --- VENDOR / AGENCY PANEL ---
  '/api/v1/agency/me': {
    get: {
      tags: ['Vendor Panel (Agency)'],
      summary: 'Get agency profile for signed-in vendor',
      security: [{ bearerAuth: [] }],
      responses: {
        200: { description: 'Agency profile details' }
      }
    },
    patch: {
      tags: ['Vendor Panel (Agency)'],
      summary: 'Update agency details (Owner only)',
      security: [{ bearerAuth: [] }],
      responses: {
        200: { description: 'Updated agency profile' }
      }
    }
  },

  '/api/v1/agency/me/packages': {
    get: {
      tags: ['Vendor Panel (Agency)'],
      summary: 'List packages / tour events managed by agency',
      security: [{ bearerAuth: [] }],
      responses: {
        200: { description: 'List of tour packages' }
      }
    },
    post: {
      tags: ['Vendor Panel (Agency)'],
      summary: 'Create a new tour package / event',
      security: [{ bearerAuth: [] }],
      responses: {
        201: { description: 'Package created successfully' }
      }
    }
  },

  '/api/v1/agency/me/guides': {
    get: {
      tags: ['Vendor Panel (Agency)'],
      summary: 'List tour guides employed by agency',
      security: [{ bearerAuth: [] }],
      responses: {
        200: { description: 'List of guides' }
      }
    }
  },

  '/api/v1/agency/me/bookings': {
    get: {
      tags: ['Vendor Panel (Agency)'],
      summary: 'List bookings placed on agency tour packages',
      security: [{ bearerAuth: [] }],
      responses: {
        200: { description: 'List of bookings' }
      }
    }
  },

  '/api/v1/agency/me/earnings': {
    get: {
      tags: ['Vendor Panel (Agency)'],
      summary: 'Get agency earnings and balance summary (Owner only)',
      security: [{ bearerAuth: [] }],
      responses: {
        200: { description: 'Earnings breakdown' }
      }
    }
  },

  '/api/v1/agency/me/payouts': {
    get: {
      tags: ['Vendor Panel (Agency)'],
      summary: 'List payout history (Owner only)',
      security: [{ bearerAuth: [] }],
      responses: {
        200: { description: 'List of payouts' }
      }
    },
    post: {
      tags: ['Vendor Panel (Agency)'],
      summary: 'Request a new payout withdrawal (Owner only)',
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['amount', 'paymentMethod'],
              properties: {
                amount: { type: 'number', example: 5000 },
                paymentMethod: { type: 'string', example: 'bkash' },
                accountNumber: { type: 'string', example: '01700000000' }
              }
            }
          }
        }
      },
      responses: {
        201: { description: 'Payout request initiated' }
      }
    }
  },

  // --- TRAVELER PUBLIC DISCOVERY (TOURS & DESTINATIONS) ---
  '/api/v1/destinations': {
    get: {
      tags: ['Destinations & Geography'],
      summary: 'List published destinations',
      responses: {
        200: { description: 'List of destinations' }
      }
    }
  },

  '/api/v1/destination-categories': {
    get: {
      tags: ['Destinations & Geography'],
      summary: 'List destination categories (e.g. Beaches, Hills, Heritage)',
      responses: {
        200: { description: 'Categories list' }
      }
    }
  },

  '/api/v1/tours': {
    get: {
      tags: ['Tours & Travel Discovery'],
      summary: 'Browse tours with filtering and search',
      parameters: [
        { name: 'search', in: 'query', schema: { type: 'string' }, description: 'Search term' },
        { name: 'destination', in: 'query', schema: { type: 'string' } },
        { name: 'sort', in: 'query', schema: { type: 'string' } }
      ],
      responses: {
        200: { description: 'List of tours matching query' }
      }
    }
  },

  '/api/v1/tours/home': {
    get: {
      tags: ['Tours & Travel Discovery'],
      summary: 'Aggregated home data for the Tours screen in the mobile app',
      responses: {
        200: { description: 'Home screen payload' }
      }
    }
  },

  '/api/v1/hotels': {
    get: {
      tags: ['Tours & Travel Discovery'],
      summary: 'List bookable hotels',
      responses: {
        200: { description: 'List of hotels' }
      }
    }
  },

  // --- BOOKINGS, REVIEWS & COMPLAINTS ---
  '/api/v1/bookings': {
    post: {
      tags: ['Bookings & Travel Records'],
      summary: 'Create a new tour booking',
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['packageId', 'seats', 'primaryContact'],
              properties: {
                packageId: { type: 'string', example: '671abc1234567890abcdef12' },
                seats: { type: 'integer', example: 2 },
                primaryContact: {
                  type: 'object',
                  properties: {
                    name: { type: 'string', example: 'Karim Ullah' },
                    phone: { type: 'string', example: '+8801800000000' }
                  }
                }
              }
            }
          }
        }
      },
      responses: {
        201: { description: 'Booking created' }
      }
    }
  },

  '/api/v1/bookings/mine': {
    get: {
      tags: ['Bookings & Travel Records'],
      summary: 'List all bookings for current traveler',
      security: [{ bearerAuth: [] }],
      responses: {
        200: { description: 'Traveler bookings' }
      }
    }
  },

  '/api/v1/reviews': {
    post: {
      tags: ['Reviews & Feedback'],
      summary: 'Submit a tour review and rating',
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['tourId', 'rating', 'review'],
              properties: {
                tourId: { type: 'string', example: '671abc1234567890abcdef12' },
                rating: { type: 'number', minimum: 1, maximum: 5, example: 5 },
                review: { type: 'string', example: 'Fantastic experience! Clean hotels and great guide.' }
              }
            }
          }
        }
      },
      responses: {
        201: { description: 'Review posted' }
      }
    }
  },

  '/api/v1/complaints': {
    post: {
      tags: ['Reviews & Feedback'],
      summary: 'Lodge a complaint or dispute regarding a booking',
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['bookingId', 'subject', 'description'],
              properties: {
                bookingId: { type: 'string' },
                subject: { type: 'string', example: 'Tour bus was delayed 3 hours' },
                description: { type: 'string', example: 'Full details of incident...' }
              }
            }
          }
        }
      },
      responses: {
        201: { description: 'Complaint filed' }
      }
    }
  },

  // --- ADMIN SYSTEM & MANAGEMENT ---
  '/api/v1/admin/system/endpoints': {
    get: {
      tags: ['Admin Console'],
      summary: 'List all server endpoints and permissions catalog',
      security: [{ bearerAuth: [] }],
      responses: {
        200: { description: 'Endpoint catalog' }
      }
    }
  },

  '/api/v1/admin/users': {
    get: {
      tags: ['Admin Console'],
      summary: 'List all registered users (Admin only)',
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'role', in: 'query', schema: { type: 'string' } },
        { name: 'search', in: 'query', schema: { type: 'string' } },
        { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
        { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } }
      ],
      responses: {
        200: { description: 'User directory' }
      }
    }
  },

  '/api/v1/admin/vendors': {
    get: {
      tags: ['Admin Console'],
      summary: 'List all registered agencies/vendors (Admin only)',
      security: [{ bearerAuth: [] }],
      responses: {
        200: { description: 'Vendors list' }
      }
    }
  },

  '/api/v1/admin/applications': {
    get: {
      tags: ['Admin Console'],
      summary: 'List submitted agency applications (Admin only)',
      security: [{ bearerAuth: [] }],
      responses: {
        200: { description: 'Applications list' }
      }
    }
  }
};

/**
 * Automatically merges dynamic endpoints discovered from Express's route table
 * so that any newly created endpoint is automatically available to test!
 */
function getSwaggerSpec(app) {
  const paths = { ...corePaths };

  try {
    if (app && app._router) {
      const catalog = buildCatalog(app);
      if (catalog && catalog.categories) {
        catalog.categories.forEach(cat => {
          cat.endpoints.forEach(ep => {
            // Convert Express params (:id) to OpenAPI format ({id})
            const openApiPath = ep.path.replace(/:([a-zA-Z0-9_]+)/g, '{$1}');
            const method = ep.method.toLowerCase();

            if (!paths[openApiPath]) {
              paths[openApiPath] = {};
            }

            if (!paths[openApiPath][method]) {
              // Extract path parameters
              const paramMatches = ep.path.match(/:([a-zA-Z0-9_]+)/g) || [];
              const parameters = paramMatches.map(p => ({
                name: p.slice(1),
                in: 'path',
                required: true,
                schema: { type: 'string' }
              }));

              const isProtected = ep.access && ep.access !== 'public';
              const security = isProtected ? [{ bearerAuth: [] }] : [];

              paths[openApiPath][method] = {
                tags: [cat.name || 'General'],
                summary: `${ep.method} ${ep.path}`,
                description: `Access: **${ep.label || ep.access || 'Public'}**`,
                parameters: parameters.length ? parameters : undefined,
                security: security.length ? security : undefined,
                responses: {
                  200: { description: 'Successful response' },
                  401: isProtected ? { description: 'Unauthorized' } : undefined
                }
              };
            }
          });
        });
      }
    }
  } catch (err) {
    console.warn('[SWAGGER WARNING] Error syncing dynamic routes:', err.message);
  }

  return {
    openapi: '3.0.0',
    info: {
      title: 'Plezar REST API Documentation',
      version: '1.0.0',
      description: `
### Interactive API Testing Dashboard
Test any Plezar API endpoint directly from your browser.

#### How to test protected endpoints:
1. Call **\`POST /api/v1/users/login\`** below with your credentials.
2. Copy the \`token\` from the response.
3. Click the green **Authorize 🔓** button at the top right of this page.
4. Paste the token into the **bearerAuth** box and click **Authorize**.
5. You can now execute all vendor, traveler, and admin endpoints with one click!
      `
    },
    servers: [
      {
        url: '/',
        description: 'Current Environment (Local or Production)'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Paste your JWT token here (without the "Bearer " prefix).'
        },
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'jwt',
          description: 'HTTP-only session cookie'
        }
      }
    },
    paths
  };
}

module.exports = { getSwaggerSpec };
