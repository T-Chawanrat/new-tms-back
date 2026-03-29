import express from "express";
import {
  getPendingList,
  getPendingDetail,
} from "../controllers/pending.controller.js";

const router = express.Router();

router.get("/", getPendingList);
router.get("/:id", getPendingDetail);

export default router;