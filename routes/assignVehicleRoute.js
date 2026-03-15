import express from "express";
import { assignVehicle } from "../controllers/assignVehicleController.js";


const router = express.Router();
router.post("/assign-vehicle", assignVehicle);

export default router;
