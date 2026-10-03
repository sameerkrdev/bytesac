import express from "express";
import { listMyInvitations } from "./members.me.controller";

const router: express.Router = express.Router();

router.get("/invitations", listMyInvitations);

export default router;
