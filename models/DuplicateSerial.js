// models/DuplicateSerial.js
import mongoose from "mongoose";

const DuplicateSerialSchema = new mongoose.Schema(
  {
    serialNo: String,
    sendId: String,
    referenceNo: String,
    payload: String,
    payloadHash: String,
    reason: String, // DUP_IN_REQUEST | DUP_IN_SYSTEM
  },
  { timestamps: true }
);

export default mongoose.model("DuplicateSerial", DuplicateSerialSchema);
