import db from "../config/db.js";

export const getAdvScan6w = async (req, res) => {
  let connection;

  try {
    const { truck6w_accept = "N" } = req.query;

    connection = await db.getConnection();

    const [rows] = await connection.query(
      `
      SELECT
        id,
        do,
        serial_no,
        group_name,
        warehouse_name
      FROM bills_data
      WHERE truck6w_accept = ?
      ORDER BY id ASC
      LIMIT 100
      `,
      [truck6w_accept],
    );

    res.status(200).json({
      success: true,
      data: rows,
    });
  } catch (err) {
    console.error("Error getAdvScan6w:", err);
    res.status(500).json({
      success: false,
      message: "ไม่สามารถดึงข้อมูล bills_data สำหรับ AdvScan6w ได้",
      error: err.message,
    });
  } finally {
    if (connection) connection.release();
  }
};

export const update6wAccept = async (req, res) => {
  let connection;

  try {
    const { serials, accept_flag = "Y", driver_id, vehicle_id } = req.body;

    if (!serials || !Array.isArray(serials) || serials.length === 0) {
      return res.status(400).json({
        success: false,
        message: "กรุณาระบุ serials เป็น array",
      });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    await connection.query(
      `
      UPDATE bills_data
      SET 
        truck6w_accept = ?,
        driver_id = ?,
        vehicle_id = ?
        status_id = 5,
        status_name = 'พัสดุออกจากศูนย์'
      WHERE serial_no IN (?)
      `,
      [accept_flag, driver_id, vehicle_id, serials],
    );

    await connection.commit();

    res.status(200).json({
      success: true,
      message: `อัปเดต ${serials.length} รายการเรียบร้อย`,
    });
  } catch (err) {
    if (connection) await connection.rollback();

    console.error("Error update6wAccept:", err);

    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการอัปเดต 6w_accept",
      error: err.message,
    });
  } finally {
    if (connection) connection.release();
  }
};
