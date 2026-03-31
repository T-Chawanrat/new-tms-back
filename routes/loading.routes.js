import express from "express";
import { getLoadingSerials } from "../controllers/loading.controller.js";

const router = express.Router();

router.get("/loading-serials", getLoadingSerials);

export default router;