import express from "express";
import {
  createBillAdv,
  insertDuplicateFromBody,
  getBillsAdv,
  getDuplicateData,
  fixDuplicate,
} from "../controllers/shipmentController.js";

const router = express.Router();
router.post("/create-adv", createBillAdv);
router.post("/insert-duplicate", insertDuplicateFromBody);
router.get("/get-bills-adv", getBillsAdv);
router.get("/get-dup-data", getDuplicateData);
router.post("/fix-duplicate", fixDuplicate);

export default router;
