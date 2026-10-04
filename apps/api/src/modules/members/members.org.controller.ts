import type { NextFunction, Request, Response } from "express";
import type { AssignCustomRoleRequest, CreateCustomRoleRequest, InviteMemberRequest, ChangeRoleRequest, UpdateCustomRoleRequest } from "@repo/validator";
import * as membersService from "./members.service";
import * as rolesService from "./roles.service";
import { ctx } from "@/middlewares/request-context.middleware";


export const listMembers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await membersService.listMembers(ctx(req), req.params.id as string));
  } catch (error) {
    next(error);
  }
};

export const inviteMember = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(201).json(await membersService.inviteMember(ctx(req), req.params.id as string, req.body as InviteMemberRequest));
  } catch (error) {
    next(error);
  }
};

export const cancelInvite = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await membersService.cancelInvite(ctx(req), req.params.id as string, req.params.mid as string));
  } catch (error) {
    next(error);
  }
};

export const changeRole = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await membersService.changeRole(ctx(req), req.params.id as string, req.params.mid as string, req.body as ChangeRoleRequest));
  } catch (error) {
    next(error);
  }
};

export const removeMember = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await membersService.removeMember(ctx(req), req.params.id as string, req.params.mid as string));
  } catch (error) {
    next(error);
  }
};

export const confirmRemoval = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await membersService.decideRemoval(ctx(req), req.params.id as string, req.params.mid as string, "confirm"));
  } catch (error) {
    next(error);
  }
};

export const cancelRemoval = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await membersService.decideRemoval(ctx(req), req.params.id as string, req.params.mid as string, "cancel"));
  } catch (error) {
    next(error);
  }
};

export const listRoles = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await rolesService.listRoles(ctx(req), req.params.id as string));
  } catch (error) {
    next(error);
  }
};

export const createRole = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(201).json(await rolesService.createRole(ctx(req), req.params.id as string, req.body as CreateCustomRoleRequest));
  } catch (error) {
    next(error);
  }
};

export const updateRole = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await rolesService.updateRole(ctx(req), req.params.id as string, req.params.rid as string, req.body as UpdateCustomRoleRequest));
  } catch (error) {
    next(error);
  }
};

export const archiveRole = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await rolesService.archiveRole(ctx(req), req.params.id as string, req.params.rid as string));
  } catch (error) {
    next(error);
  }
};

export const assignRole = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await rolesService.assignRole(ctx(req), req.params.id as string, req.params.mid as string, req.body as AssignCustomRoleRequest));
  } catch (error) {
    next(error);
  }
};
