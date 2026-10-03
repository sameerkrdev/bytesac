import express from "express";
import { markReadSchema, pushTokenSchema } from "@repo/validator";
import { validate } from "@/middlewares/validate.middleware";
import { listNotifications, markNotificationsRead, registerPushToken, revokePushToken } from "./notifications.me.controller";

const router: express.Router = express.Router();

router.get("/notifications", listNotifications);

router.post("/notifications/read", validate({ body: markReadSchema }), markNotificationsRead);

router.post("/push-tokens", validate({ body: pushTokenSchema }), registerPushToken);

router.post("/push-tokens/revoke", validate({ body: pushTokenSchema.pick({ token: true }) }), revokePushToken);

export default router;
