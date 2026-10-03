import type { NextFunction, Request, Response } from "express";
import { listApplicationsQuerySchema, type TransitionApplicationRequest, type ApplicationNoteRequest, type PlatformRolesResponse, type GrantRoleRequest } from "@repo/validator";
import * as applicationsService from "./applications.service";
import * as platformRolesService from "./platform-roles.service";

const ctx = (req: Request) => ({ userId: req.auth!.userId, meta: req.ctx });

const actor = (req: Request) => ({ userId: req.auth!.userId, requestId: req.ctx.requestId });

export const listApplications = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await applicationsService.listApplications(listApplicationsQuerySchema.parse(req.query)));
  } catch (error) {
    next(error);
  }
};

export const getApplicationDetail = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await applicationsService.getApplicationDetail(req.params.id as string));
  } catch (error) {
    next(error);
  }
};

export const transitionApplication = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await applicationsService.transitionApplication(ctx(req), req.params.id as string, req.body as TransitionApplicationRequest));
  } catch (error) {
    next(error);
  }
};

export const addApplicationNote = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(201).json(await applicationsService.addApplicationNote(ctx(req), req.params.id as string, (req.body as ApplicationNoteRequest).internalNote));
  } catch (error) {
    next(error);
  }
};

export const listRoles = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const body: PlatformRolesResponse = { roles: await platformRolesService.listRoles() };
    res.json(body);
  } catch (error) {
    next(error);
  }
};

export const grantRole = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId, role } = req.body as GrantRoleRequest;
    res.status(201).json(await platformRolesService.grantRole(actor(req), userId, role));
  } catch (error) {
    next(error);
  }
};

export const revokeRole = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await platformRolesService.revokeRole(actor(req), req.params.id as string);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
};
