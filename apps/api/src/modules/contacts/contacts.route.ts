import express from "express";
import { addContactRequestSchema, verifyContactRequestSchema, z } from "@repo/validator";
import { requireSession } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { addContact, resendContact, verifyContact } from "./contacts.controller";

const idParam = z.object({ id: z.uuid() });

const router: express.Router = express.Router();

router.use(requireSession);

router.post("/", validate({ body: addContactRequestSchema }), addContact);

router.post("/:id/verify", validate({ params: idParam, body: verifyContactRequestSchema }), verifyContact);

router.post("/:id/resend", validate({ params: idParam }), resendContact);

export default router;
