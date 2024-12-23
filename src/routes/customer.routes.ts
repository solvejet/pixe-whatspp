// src/routes/customer.routes.ts

import type {
  Router as ExpressRouter,
  Request,
  Response,
  NextFunction,
  RequestHandler,
} from 'express';
import { Router } from 'express';
import { CustomerController } from '@/controllers/customer.controller.js';
import { auth, checkPermission, rateLimit } from '@/middleware/auth.middleware.js';
import { auditMiddleware } from '@/middleware/audit.middleware.js';
import { validateRequest } from '@/middleware/validate-request.js';
import { customerSchemas } from '@/schemas/customer.schema.js';
import type { AuthenticatedRequest } from '@/types/auth.js';

/**
 * Initialize router with security settings
 */
const router: ExpressRouter = Router({
  strict: true,
  caseSensitive: true,
});

/**
 * Type-safe wrapper for controller methods
 */
function controllerHandler<T extends AuthenticatedRequest>(
  fn: (req: T, res: Response) => Promise<void>,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req as T, res)).catch(next);
  };
}

const customerController = new CustomerController();

/**
 * List and Search Routes
 * Place these before parameterized routes
 */

// Get customer statistics
router.get(
  '/statistics',
  auth,
  checkPermission(['customers:statistics']),
  validateRequest(customerSchemas.query.statistics),
  auditMiddleware('customer.statistics', 'data'),
  controllerHandler(customerController.getStatistics),
);

// List customer groups
router.get(
  '/groups',
  auth,
  checkPermission(['customer-groups:read']),
  validateRequest(customerSchemas.query.list),
  auditMiddleware('customer-group.list', 'data'),
  controllerHandler(customerController.listCustomerGroups),
);

/**
 * Batch Operations
 */

// Batch update customers
router.patch(
  '/batch',
  auth,
  checkPermission(['customers:batch-update']),
  rateLimit(20, 15 * 60), // 20 requests per 15 minutes
  validateRequest(customerSchemas.update),
  auditMiddleware('customer.batch-update', 'data'),
  controllerHandler(customerController.batchUpdateCustomers),
);

/**
 * Group Management Routes
 */

// Create customer group
router.post(
  '/groups',
  auth,
  checkPermission(['customer-groups:create']),
  rateLimit(50, 15 * 60),
  validateRequest(customerSchemas.group.create),
  auditMiddleware('customer-group.create', 'data'),
  controllerHandler(customerController.createCustomerGroup),
);

// Update customer group
router.put(
  '/groups/:id',
  auth,
  checkPermission(['customer-groups:update']),
  rateLimit(100, 15 * 60),
  validateRequest(customerSchemas.group.update),
  auditMiddleware('customer-group.update', 'data'),
  controllerHandler(customerController.updateCustomerGroup),
);

// Delete customer group
router.delete(
  '/groups/:id',
  auth,
  checkPermission(['customer-groups:delete']),
  rateLimit(20, 15 * 60),
  auditMiddleware('customer-group.delete', 'data'),
  controllerHandler(customerController.deleteCustomerGroup),
);

// Get customer group by ID
router.get(
  '/groups/:id',
  auth,
  checkPermission(['customer-groups:read']),
  auditMiddleware('customer-group.read', 'data'),
  controllerHandler(customerController.getCustomerGroupById),
);

// Add customers to group
router.post(
  '/groups/:id/customers',
  auth,
  checkPermission(['customer-groups:manage-members']),
  rateLimit(50, 15 * 60),
  validateRequest(customerSchemas.group.addCustomers),
  auditMiddleware('customer-group.add-customers', 'data'),
  controllerHandler(customerController.addCustomersToGroup),
);

// Remove customers from group
router.delete(
  '/groups/:id/customers',
  auth,
  checkPermission(['customer-groups:manage-members']),
  rateLimit(50, 15 * 60),
  validateRequest(customerSchemas.group.removeCustomers),
  auditMiddleware('customer-group.remove-customers', 'data'),
  controllerHandler(customerController.removeCustomersFromGroup),
);

/**
 * Individual Customer Routes
 */

// Create customer
router.post(
  '/',
  auth,
  checkPermission(['customers:create']),
  rateLimit(50, 15 * 60),
  validateRequest(customerSchemas.create),
  auditMiddleware('customer.create', 'data'),
  controllerHandler(customerController.createCustomer),
);

// Get customer by ID
router.get(
  '/:id',
  auth,
  checkPermission(['customers:read']),
  auditMiddleware('customer.read', 'data'),
  controllerHandler(customerController.getCustomerById),
);

// Update customer
router.put(
  '/:id',
  auth,
  checkPermission(['customers:update']),
  rateLimit(100, 15 * 60),
  validateRequest(customerSchemas.update),
  auditMiddleware('customer.update', 'data'),
  controllerHandler(customerController.updateCustomer),
);

// Delete customer
router.delete(
  '/:id',
  auth,
  checkPermission(['customers:delete']),
  rateLimit(20, 15 * 60),
  auditMiddleware('customer.delete', 'data'),
  controllerHandler(customerController.deleteCustomer),
);

router.get(
  '/',
  auth,
  checkPermission(['customers:read']),
  validateRequest(customerSchemas.query.list),
  auditMiddleware('customer.list', 'data'),
  controllerHandler(customerController.listCustomers),
);

export default router;
