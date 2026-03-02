import db from "../config/db.js";

export const getDuplicateSerials = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        id,
        serial_no,
        send_id,
        reference_no,
        reason,
        payload,
        created_at
      FROM duplicate_serials
      ORDER BY created_at DESC
    `);

    const data = rows.map((row) => {
      let payload = {};
      try {
        payload = JSON.parse(row.payload);
      } catch {}

      return {
        id: row.id,
        created_at: row.created_at,
        serial_no: row.serial_no,
        reason: row.reason,

        // 🔹 summary
        send_id: payload.sendId,
        reference_no: payload.head?.referenceNo,
        recipient_name: payload.head?.recipientName,
        address: payload.head?.address,
        subdistrict: payload.head?.subdistrict,
        district: payload.head?.district,
        province: payload.head?.province,
        zipCode: payload.head?.zipCode,
        delivery_date: payload.head?.deliveryDate,

        // 🔹 head
        head: payload.head || {},

        // 🔹 detail
        detail: payload.detail || [],
      };
    });

    res.json({
      success: true,
      count: data.length,
      data,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
};
