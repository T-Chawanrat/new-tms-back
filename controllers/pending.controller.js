import db from "../config/db.js";

export const getPendingList = async (req, res) => {
  let conn;

  try {
    conn = await db.getConnection();

    const [rows] = await conn.query(`
      SELECT 
        p.id,
        p.reference_no,
        p.send_id,
        p.error_summary,
        p.created_at,
        COUNT(i.id) AS total,
        SUM(CASE WHEN i.reason != 'OK' THEN 1 ELSE 0 END) AS error_count
      FROM data_adv_pending p
      LEFT JOIN data_adv_pending_item i 
        ON p.id = i.pending_id
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `);

    res.json(rows);
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  } finally {
    if (conn) conn.release();
  }
};

export const getPendingDetail = async (req, res) => {
  let conn;

  try {
    conn = await db.getConnection();

    const { id } = req.params;

    const [[pending]] = await conn.query(
      `
      SELECT *
      FROM data_adv_pending
      WHERE id = ?
      `,
      [id],
    );

    if (!pending) {
      return res.status(404).json({
        message: "NOT_FOUND",
      });
    }

    const [items] = await conn.query(
      `
      SELECT 
        id,
        serial_no,
        package_id,
        package_detail_id,
        reason
      FROM data_adv_pending_item
      WHERE pending_id = ?
      ORDER BY id ASC
      `,
      [id],
    );

    res.json({
      pending,
      items,
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  } finally {
    if (conn) conn.release();
  }
};