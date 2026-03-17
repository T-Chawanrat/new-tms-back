import express from "express";
import { getAdvScan6w, update6wAccept , getDcScan, updateDcAccept } from "../controllers/assignVehicleController.js";



const router = express.Router();
router.get("/get-adv6w", getAdvScan6w);
router.post("/adv6w/accept", update6wAccept);
router.get("/get-dc-scan", getDcScan);
router.post("/dc/accept", updateDcAccept);

export default router;
