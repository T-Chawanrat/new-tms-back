// models/Shipment.js
import mongoose from "mongoose";

const DetailSchema = new mongoose.Schema(
  {
    packageId: Number,
    packageDetailId: Number,
    qtyOfSerial: Number,
    costDifference: Number,
    height: Number,
    width: Number,
    length: Number,
    weight: Number,
    serialNo: [String],
    size_type: String,
    q: Number,
  },
  { _id: false }
);

const ShipmentSchema = new mongoose.Schema(
  {
    sendId: { type: String, required: true, unique: true },

    head: {
      referenceNo: String,
      deliveryStatus: Number,
      deliveryDate: String,
      reference: String,
      shipperId: String,
      recipientCode: String,
      recipientName: String,
      recipientType: Number,
      address: String,
      subdistrict: String,
      district: String,
      province: String,
      zipCode: String,
      tel1: String,
      tel1Ext: String,
      tel2: String,
      tel2Ext: String,
      lineId: String,
      cod: Number,
      documentReturnId: Number,
      documentReturnDescription: String,
      paymentId: Number,
      qtyOfDetail: Number,
      isPickupCustomer: String,
    },

    detail: [DetailSchema],
  },
  { timestamps: true }
);

// index สำคัญมาก (แทน shipment_serials)
ShipmentSchema.index({ "detail.serialNo": 1 });

export default mongoose.model("Shipment", ShipmentSchema);
