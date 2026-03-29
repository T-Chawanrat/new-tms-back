import express from "express";
import {
  getLogsDataAdv,
  getLogsGroup,
  getLogsGroupList,
  fixDuplicate,
} from "../controllers/logs.controller.js";

const router = express.Router();

router.get("/", getLogsDataAdv);
router.get("/group", getLogsGroup);
router.get("/group-list", getLogsGroupList);
router.post("/fix-duplicate", fixDuplicate);

export default router;