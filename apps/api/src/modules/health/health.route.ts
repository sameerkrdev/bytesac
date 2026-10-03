import express from "express";
import { getHealth } from "./health.controller";

const router: express.Router = express.Router();

router.get("/", getHealth);

export default router;
