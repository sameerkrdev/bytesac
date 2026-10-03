import { addContactRequestSchema, verifyContactRequestSchema, z, type AddContactRequest, type VerifyContactRequest } from "@repo/validator";
import { Router, type Request } from "express";
import { requireSession } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { addContact, resendContact, verifyContact } from "@/services/contacts";

const idParam = z.object({ id: z.uuid() });
const ctx = (req: Request) => ({ userId: req.auth!.userId, sessionId: req.auth!.sessionId, meta: req.ctx });

export const contactsRouter = Router();
contactsRouter.use(requireSession);

contactsRouter.post("/", validate({ body: addContactRequestSchema }), async (req, res) => {
  const body = req.body as AddContactRequest;
  res.status(201).json(await addContact(ctx(req), { type: body.type, rawValue: body.value }));
});

contactsRouter.post("/:id/verify", validate({ params: idParam, body: verifyContactRequestSchema }), async (req, res) => {
  const { code } = req.body as VerifyContactRequest;
  res.json(await verifyContact(ctx(req), { contactId: (req.params.id as string), code }));
});

contactsRouter.post("/:id/resend", validate({ params: idParam }), async (req, res) => {
  res.json(await resendContact(ctx(req), (req.params.id as string)));
});
