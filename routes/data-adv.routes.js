import express from "express";
import {
  createDataAdv,
  getDataAdv,
  getDataAdvDetail,
} from "../controllers/data-adv.controller.js";

const router = express.Router();

router.post("/", createDataAdv);
router.get("/", getDataAdv);
router.get("/:id", getDataAdvDetail);

export default router;