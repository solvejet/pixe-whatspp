// src/controllers/calls.controller.ts

import type { Response } from 'express';
import { Types } from 'mongoose';
import { Role } from '@/types/auth.js';
import { exotelService } from '@/services/exotel.service.js';
import { CallModel } from '@/models/call.model.js';
import { successResponse } from '@/middleware/error-handler.js';
import { AppError, ErrorCode } from '@/utils/error-service.js';
import { env } from '@/config/env.js';
import type {
  InitiateCallRequest,
  WebhookRequest,
  CustomerCallHistoryRequest,
  StaffCallHistoryRequest,
  CallByIdRequest,
  CallStatsRequest,
} from '@/types/call.js';

export class CallsController {
  /**
   * Initiate a call to customer
   * @route POST /api/calls/initiate
   */
  public initiateCall = async (req: InitiateCallRequest, res: Response): Promise<void> => {
    const userId = req.user?.userId;
    if (!userId) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 'User ID not found in request', 401);
    }

    // Validate user role
    const userRoles = req.user?.roles || [];
    if (!userRoles.some((role) => [Role.ADMIN, Role.STAFF].includes(role))) {
      throw new AppError(
        ErrorCode.INSUFFICIENT_PERMISSIONS,
        'Only admin or staff can initiate calls',
        403,
      );
    }

    // Validate customerId format
    if (!Types.ObjectId.isValid(req.body.customerId)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid customer ID format', 400);
    }

    // Validate phone number format
    if (!/^\+?[1-9]\d{1,14}$/.test(req.body.phoneNumber)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid phone number format', 400);
    }

    // Validate time limit if provided
    if (
      req.body.timeLimit &&
      (req.body.timeLimit < 60 || req.body.timeLimit > env.EXOTEL_MAX_CALL_DURATION)
    ) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Time limit must be between 60 and ${env.EXOTEL_MAX_CALL_DURATION} seconds`,
        400,
      );
    }

    const call = await exotelService.initiateCall({
      from: req.body.phoneNumber,
      to: userId,
      callerId: env.EXOTEL_CALLER_ID,
      customerId: new Types.ObjectId(req.body.customerId),
      staffId: new Types.ObjectId(userId),
      customField: req.body.customField,
      timeLimit: req.body.timeLimit,
      recordingFormat: req.body.recordingFormat || env.EXOTEL_RECORDING_FORMAT,
      recordingChannels: req.body.recordingChannels || env.EXOTEL_RECORDING_CHANNELS,
    });

    successResponse(res, { call }, 'Call initiated successfully', 201);
  };

  /**
   * Handle callback from Exotel
   * @route POST /api/calls/callback
   */
  public handleCallback = async (req: WebhookRequest, res: Response): Promise<void> => {
    try {
      await exotelService.handleCallback(req.body);
      successResponse(res, null, 'Callback processed successfully');
    } catch (error) {
      // Always return 200 for webhooks even if processing fails
      successResponse(
        res,
        { error: 'Webhook processing failed but acknowledged' },
        'Webhook received',
      );
      throw error; // Let error middleware handle logging
    }
  };

  /**
   * Get call history for a customer
   * @route GET /api/calls/customer/:customerId
   */
  public getCustomerCallHistory = async (
    req: CustomerCallHistoryRequest,
    res: Response,
  ): Promise<void> => {
    const { customerId } = req.params;
    const page = typeof req.query.page === 'string' ? parseInt(req.query.page, 10) : 1;
    const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 10;

    if (!Types.ObjectId.isValid(customerId)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid customer ID format', 400);
    }

    const query: Record<string, unknown> = { customerId: new Types.ObjectId(customerId) };

    // Add date range filter if provided
    if (req.query.startDate || req.query.endDate) {
      const dateRange: Record<string, Date> = {};
      if (req.query.startDate) {
        dateRange.$gte = new Date(req.query.startDate);
      }
      if (req.query.endDate) {
        dateRange.$lte = new Date(req.query.endDate);
      }
      query.startTime = dateRange;
    }

    // Add status filter if provided
    if (req.query.status) {
      query.status = req.query.status;
    }

    const calls = await CallModel.find(query)
      .sort({ startTime: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('staffId', 'firstName lastName email')
      .lean();

    const total = await CallModel.countDocuments(query);

    successResponse(res, {
      calls,
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  };

  /**
   * Get call history for logged-in staff/admin
   * @route GET /api/calls/staff
   */
  public getStaffCallHistory = async (
    req: StaffCallHistoryRequest,
    res: Response,
  ): Promise<void> => {
    const userId = req.user?.userId;
    if (!userId) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 'User ID not found in request', 401);
    }

    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;

    const query: Record<string, unknown> = { staffId: new Types.ObjectId(userId) };

    // Add date range filter if provided
    if (req.query.startDate || req.query.endDate) {
      const dateRange: Record<string, Date> = {};
      if (req.query.startDate) {
        dateRange.$gte = new Date(req.query.startDate);
      }
      if (req.query.endDate) {
        dateRange.$lte = new Date(req.query.endDate);
      }
      query.startTime = dateRange;
    }

    // Add status filter if provided
    if (req.query.status) {
      query.status = req.query.status;
    }

    const calls = await CallModel.find(query)
      .sort({ startTime: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('customerId', 'name phoneNumber')
      .lean();

    const total = await CallModel.countDocuments(query);

    successResponse(res, {
      calls,
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  };

  /**
   * Get call details by ID
   * @route GET /api/calls/:id
   */
  public getCallById = async (req: CallByIdRequest, res: Response): Promise<void> => {
    const { id } = req.params;

    if (!Types.ObjectId.isValid(id)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid call ID format', 400);
    }

    const call = await CallModel.findById(id)
      .populate('customerId', 'name phoneNumber')
      .populate('staffId', 'firstName lastName email')
      .lean();

    if (!call) {
      throw new AppError(ErrorCode.RESOURCE_NOT_FOUND, 'Call not found', 404);
    }

    successResponse(res, { call });
  };

  /**
   * Get call statistics
   * @route GET /api/calls/statistics
   */
  public getCallStatistics = async (req: CallStatsRequest, res: Response): Promise<void> => {
    const userId = req.user?.userId;
    if (!userId) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 'User ID not found in request', 401);
    }

    // Get date range from query params or default to last 30 days
    const endDate = req.query.endDate ? new Date(req.query.endDate) : new Date();
    const startDate = req.query.startDate
      ? new Date(req.query.startDate)
      : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

    const stats = await CallModel.aggregate([
      {
        $match: {
          staffId: new Types.ObjectId(userId),
          startTime: { $gte: startDate, $lte: endDate },
        },
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalDuration: { $sum: '$duration' },
          averageDuration: { $avg: '$duration' },
          totalCost: {
            $sum: {
              $cond: [{ $and: [{ $ne: ['$price', null] }, { $ne: ['$price', 0] }] }, '$price', 0],
            },
          },
        },
      },
      {
        $project: {
          status: '$_id',
          count: 1,
          totalDuration: 1,
          averageDuration: { $round: ['$averageDuration', 2] },
          totalCost: { $round: ['$totalCost', 2] },
        },
      },
    ]);

    // Add summary statistics
    const summary = await CallModel.aggregate([
      {
        $match: {
          staffId: new Types.ObjectId(userId),
          startTime: { $gte: startDate, $lte: endDate },
        },
      },
      {
        $group: {
          _id: null,
          totalCalls: { $sum: 1 },
          totalDuration: { $sum: '$duration' },
          totalCost: {
            $sum: {
              $cond: [{ $and: [{ $ne: ['$price', null] }, { $ne: ['$price', 0] }] }, '$price', 0],
            },
          },
          avgCallDuration: { $avg: '$duration' },
        },
      },
      {
        $project: {
          _id: 0,
          totalCalls: 1,
          totalDuration: 1,
          totalCost: { $round: ['$totalCost', 2] },
          avgCallDuration: { $round: ['$avgCallDuration', 2] },
        },
      },
    ]);

    successResponse(res, {
      byStatus: stats,
      summary: summary[0] || {
        totalCalls: 0,
        totalDuration: 0,
        totalCost: 0,
        avgCallDuration: 0,
      },
      dateRange: {
        start: startDate,
        end: endDate,
      },
    });
  };
}

export const callsController = new CallsController();
