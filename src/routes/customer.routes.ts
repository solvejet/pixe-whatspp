// src/routes/customer.routes.ts

import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { CustomerController } from '@/controllers/customer.controller.js';
import { CustomerMiddleware } from '@/middleware/customer.middleware.js';
import { auth, checkRole } from '@/middleware/auth.middleware.js';
import { auditMiddleware } from '@/middleware/audit.middleware.js';
import { asyncHandler } from '@/middleware/error-handler.js';

const router: ExpressRouter = Router();
const customerController = new CustomerController();

// Schema management routes (admin only)
router
  .route('/schema')
  .get(auth, checkRole(['admin']), asyncHandler(customerController.getSchema))
  .put(
    auth,
    checkRole(['admin']),
    CustomerMiddleware.validateSchemaUpdate,
    auditMiddleware('schema.update', 'data'),
    asyncHandler(customerController.updateSchema),
  );

// Customer management routes
router
  .route('/')
  .post(
    auth,
    checkRole(['admin', 'staff']),
    CustomerMiddleware.validateCustomerCreate,
    auditMiddleware('customer.create', 'data'),
    asyncHandler(customerController.createCustomer),
  )
  .get(
    auth,
    checkRole(['admin', 'staff']),
    auditMiddleware('customer.list', 'data'),
    asyncHandler(customerController.getCustomers),
  );

router
  .route('/:id')
  .get(
    auth,
    checkRole(['admin', 'staff']),
    auditMiddleware('customer.view', 'data'),
    asyncHandler(customerController.getCustomer),
  )
  .put(
    auth,
    checkRole(['admin', 'staff']),
    CustomerMiddleware.validateCustomerUpdate,
    auditMiddleware('customer.update', 'data'),
    asyncHandler(customerController.updateCustomer),
  )
  .delete(
    auth,
    checkRole(['admin']),
    auditMiddleware('customer.delete', 'data'),
    asyncHandler(customerController.deleteCustomer),
  );

export default router;
