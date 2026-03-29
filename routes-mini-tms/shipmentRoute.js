// import express from "express";
// import {
//   createBillAdv,
//   insertDuplicateFromBody,
//   getBillsAdv,
//   getDuplicateData,
//   fixDuplicate,
//   createDataAdv,
// } from "../controllers/shipmentController.js";

// const router = express.Router();
// router.post("/create-adv", createBillAdv);
// router.post("/insert-duplicate", insertDuplicateFromBody);
// router.get("/get-bills-adv", getBillsAdv);
// router.get("/get-dup-data", getDuplicateData);
// router.post("/fix-duplicate", fixDuplicate);
// router.post("/create-data-adv", createDataAdv);

// export default router;

import express from "express";
import {
  createDataAdv,
  getDataAdv,
  getDataAdvDetail,
  getLogsDataAdv,
  fixDuplicate,
} from "../controllers/shipmentController copy.js";

const router = express.Router();

router.post("/data-adv", createDataAdv);
router.get("/data-adv", getDataAdv);
router.get("/data-adv/:id", getDataAdvDetail);
router.get("/logs-data-adv", getLogsDataAdv);
router.post("/fix-duplicate", fixDuplicate);

export default router;
