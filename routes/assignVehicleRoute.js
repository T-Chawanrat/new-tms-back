import express from "express";
import { getAdvScan6w, update6wAccept } from "../controllers/assignVehicleController.js";



const router = express.Router();
router.get("/get-adv6w", getAdvScan6w);
router.post("/adv6w/accept", update6wAccept);

export default router;
