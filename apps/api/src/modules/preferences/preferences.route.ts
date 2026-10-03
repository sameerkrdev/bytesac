import express from "express";
import { updateNotificationPreferencesSchema } from "@repo/validator";
import { requireSession } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { getPreferences, updatePreferences } from "./preferences.controller";

const router: express.Router = express.Router();

router.use(requireSession);

router.get("/", getPreferences);

router.patch("/", validate({ body: updateNotificationPreferencesSchema }), updatePreferences);

export default router;
