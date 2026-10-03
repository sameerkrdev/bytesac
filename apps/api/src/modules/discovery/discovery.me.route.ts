import express from "express";
import { managerProfileRequestSchema } from "@repo/validator";
import { validate } from "@/middlewares/validate.middleware";
import { getOwnProfile, publishProfile, saveOwnProfile, unpublishProfile } from "./discovery.me.controller";

const router: express.Router = express.Router();

router.get("/manager-profile", getOwnProfile);

router.put("/manager-profile", validate({ body: managerProfileRequestSchema }), saveOwnProfile);

router.post("/manager-profile/publish", publishProfile);

router.post("/manager-profile/unpublish", unpublishProfile);

export default router;
