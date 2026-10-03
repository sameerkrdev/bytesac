import type { RequestHandler } from "express";
import type { z } from "@repo/validator";

interface RequestSchemas {
  params?: z.ZodType<Record<string, string>>;
  body?: z.ZodType;
}

/** Parses params and body with zod; a ZodError is turned into a 400 by the error handler. */
export const validate = (schemas: RequestSchemas): RequestHandler => (req, _res, next) => {
  if (schemas.params) req.params = schemas.params.parse(req.params);
  if (schemas.body) req.body = schemas.body.parse(req.body);
  next();
};
