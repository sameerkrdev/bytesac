import type { NextFunction, Request, Response } from "express";
import type { AddContactRequest, VerifyContactRequest } from "@repo/validator";
import * as contactsService from "./contacts.service";

const ctx = (req: Request) => ({ userId: req.auth!.userId, sessionId: req.auth!.sessionId, meta: req.ctx });

export const addContact = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body as AddContactRequest;
    res.status(201).json(await contactsService.addContact(ctx(req), { type: body.type, rawValue: body.value }));
  } catch (error) {
    next(error);
  }
};

export const verifyContact = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code } = req.body as VerifyContactRequest;
    res.json(await contactsService.verifyContact(ctx(req), { contactId: (req.params.id as string), code }));
  } catch (error) {
    next(error);
  }
};

export const resendContact = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await contactsService.resendContact(ctx(req), (req.params.id as string)));
  } catch (error) {
    next(error);
  }
};
