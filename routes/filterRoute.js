import express from "express";
import { getCustomers, getWarehouses, searchAddress, getDropdownWarehouse , getDrivers, getVehicleTypes, getVehicles} from "../controllers/filterController.js";

const router = express.Router();

router.get("/customers", getCustomers);
router.get("/select-warehouse", getDropdownWarehouse);
router.get("/warehouses", getWarehouses);
router.get("/address-search", searchAddress);
router.get("/drivers", getDrivers);
router.get("/vehicle-types", getVehicleTypes);
router.get("/vehicles", getVehicles);


export default router;