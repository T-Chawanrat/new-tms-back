import db from "../config/db.js";

export const getLoadingSerials = async (req, res) => {
  let conn;

  try {
    conn = await db.getConnection();

    const { recipient_name = "", warehouse_name = "" } = req.query;

    let sql = `
      SELECT
        das.id,
        das.serial_no,
        da.recipient_name,
        da.warehouse_name
      FROM data_adv_sn das
      INNER JOIN data_adv da
        ON da.id = das.data_adv_id
      WHERE 1 = 1
    `;

    const params = [];

    if (recipient_name) {
      sql += ` AND da.recipient_name LIKE ?`;
      params.push(`%${recipient_name}%`);
    }

    if (warehouse_name) {
      sql += ` AND da.warehouse_name LIKE ?`;
      params.push(`%${warehouse_name}%`);
    }

    sql += `
      ORDER BY das.created_at DESC
      LIMIT 1000
    `;

    const [rows] = await conn.query(sql, params);
    res.status(200).json({
      success: true,
      data: rows,
    });
  } catch (err) {
    console.error("getLoadingSerials error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch serials",
      error: err.message,
    });
  } finally {
    if (conn) conn.release();
  }
};
