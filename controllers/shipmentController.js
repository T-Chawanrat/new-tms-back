import db from "../config/db.js";
import crypto from "crypto";

export const createShipment = async (req, res) => {
  let connection;

  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    const { sendId, head, detail } = req.body;

    // =========================
    // เก็บ payload + hash (สำหรับ duplicate log)
    // =========================
    const payload = JSON.stringify(req.body);
    const payloadHash = crypto
      .createHash("sha256")
      .update(payload)
      .digest("hex");

    // =========================
    // 1️⃣ Validate เบื้องต้น
    // =========================
    if (!sendId || !head || !Array.isArray(detail) || detail.length === 0) {
      return res.status(400).json({
        success: false,
        message: "ข้อมูล shipment ไม่ครบ",
      });
    }

    // =========================
    // 2️⃣ รวม serial ทั้งหมดจาก request
    // =========================
    const incomingSerials = [];

    detail.forEach((d) => {
      if (Array.isArray(d.serialNo)) {
        d.serialNo.forEach((s) => {
          if (s) incomingSerials.push(String(s).trim());
        });
      }
    });

    if (incomingSerials.length === 0) {
      return res.status(400).json({
        success: false,
        message: "ไม่พบ serialNo ใน request",
      });
    }

    // =========================
    // 3️⃣ เช็ค serial ซ้ำ "ภายใน request"
    // =========================
    const uniqueIncomingSerials = [...new Set(incomingSerials)];

    if (uniqueIncomingSerials.length !== incomingSerials.length) {
      const dupInRequest = incomingSerials.filter(
        (s, i) => incomingSerials.indexOf(s) !== i
      );

      const duplicateSerials = [...new Set(dupInRequest)];

      const logValues = duplicateSerials.map((s) => [
        s,
        sendId,
        head.referenceNo,
        payload,
        payloadHash,
        "DUP_IN_REQUEST",
      ]);

      // 🔥 log อยู่นอก transaction (ไม่โดน rollback)
      await db.query(
        `
        INSERT INTO duplicate_serials
        (serial_no, send_id, reference_no, payload, payload_hash, reason)
        VALUES ?
        `,
        [logValues]
      );

      await connection.rollback();
      return res.status(409).json({
        success: false,
        message: "พบ serial ซ้ำภายใน request",
        duplicateSerials,
      });
    }

    // =========================
    // 4️⃣ เช็ค serial ซ้ำ "ในระบบ"
    // =========================
    const [dupRows] = await connection.query(
      `
      SELECT serial_no
      FROM shipment_serials
      WHERE serial_no IN (?)
      `,
      [uniqueIncomingSerials]
    );

    if (dupRows.length > 0) {
      const duplicateSerials = dupRows.map((r) => r.serial_no);

      const logValues = duplicateSerials.map((s) => [
        s,
        sendId,
        head.referenceNo,
        payload,
        payloadHash,
        "DUP_IN_SYSTEM",
      ]);

      // 🔥 log อยู่นอก transaction
      await db.query(
        `
        INSERT INTO duplicate_serials
        (serial_no, send_id, reference_no, payload, payload_hash, reason)
        VALUES ?
        `,
        [logValues]
      );

      await connection.rollback();
      return res.status(409).json({
        success: false,
        message: "พบ serial ซ้ำในระบบ",
        duplicateSerials,
      });
    }

    // =========================
    // 5️⃣ Insert shipments
    // =========================
    const [shipmentResult] = await connection.query(
      `
      INSERT INTO shipments
      (
        send_id,
        reference_no,
        delivery_status,
        delivery_date,
        reference,
        shipper_id,
        recipient_code,
        recipient_name,
        recipient_type,
        address,
        subdistrict,
        district,
        province,
        zipcode,
        tel1,
        tel1_ext,
        tel2,
        tel2_ext,
        line_id,
        cod,
        document_return_id,
        document_return_description,
        payment_id,
        qty_of_detail,
        is_pickup_customer
      )
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `,
      [
        sendId,
        head.referenceNo,
        head.deliveryStatus,
        head.deliveryDate,
        head.reference,
        head.shipperId,
        head.recipientCode,
        head.recipientName,
        head.recipientType,
        head.address,
        head.subdistrict,
        head.district,
        head.province,
        head.zipCode,
        head.tel1,
        head.tel1Ext ?? null,
        head.tel2,
        head.tel2Ext ?? null,
        head.lineId,
        head.cod,
        head.documentReturnId ?? null,
        head.documentReturnDescription ?? null,
        head.paymentId,
        detail.length,
        head.isPickupCustomer,
      ]
    );

    const shipmentId = shipmentResult.insertId;

    // =========================
    // 6️⃣ Insert shipment_details + shipment_serials
    // =========================
    for (const d of detail) {
      if (
        Array.isArray(d.serialNo) &&
        d.qtyOfSerial !== d.serialNo.length
      ) {
        throw new Error("qtyOfSerial ไม่ตรงกับจำนวน serialNo");
      }

      const [detailResult] = await connection.query(
        `
        INSERT INTO shipment_details
        (
          shipment_id,
          package_id,
          package_detail_id,
          qty_of_serial,
          cost_difference,
          height,
          width,
          length,
          weight,
          size_type,
          q
        )
        VALUES (?,?,?,?,?,?,?,?,?,?,?)
        `,
        [
          shipmentId,
          d.packageId,
          d.packageDetailId,
          d.qtyOfSerial,
          d.costDifference,
          d.height,
          d.width,
          d.length,
          d.weight,
          d.size_type,
          d.q,
        ]
      );

      const shipmentDetailId = detailResult.insertId;

      if (Array.isArray(d.serialNo) && d.serialNo.length > 0) {
        const serialValues = d.serialNo.map((s) => [
          shipmentDetailId,
          String(s).trim(),
        ]);

        await connection.query(
          `
          INSERT INTO shipment_serials
          (shipment_detail_id, serial_no)
          VALUES ?
          `,
          [serialValues]
        );
      }
    }

    // =========================
    // 7️⃣ Commit
    // =========================
    await connection.commit();

    return res.status(201).json({
      success: true,
      message: "สร้าง shipment สำเร็จ",
      shipmentId,
    });
  } catch (err) {
    if (connection) await connection.rollback();

    console.error("createShipment error:", err);
    return res.status(500).json({
      success: false,
      message: "ไม่สามารถสร้าง shipment ได้",
      error: err.message,
    });
  } finally {
    if (connection) connection.release();
  }
};
