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
    const {
      serials,
      accept_flag = "Y",
      driver_id,
      vehicle_id,
      user_id,
    } = req.body;

    if (!serials || !Array.isArray(serials) || serials.length === 0) {
      return res.status(400).json({
        success: false,
        message: "กรุณาระบุ serials เป็น array",
      });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    // ✅ UPDATE
    await connection.query(
      `
      UPDATE bills_data
      SET 
        truck6w_accept = ?,
        driver_id = ?,
        vehicle_id = ?,
        status_id = 5,
        status_name = 'พัสดุออกจากศูนย์'
      WHERE serial_no IN (?)
      `,
      [accept_flag, driver_id, vehicle_id, serials],
    );

    // ✅ INSERT LOG (เพิ่มตรงนี้)
    await connection.query(
      `
      INSERT INTO log_truck6w_accept (
        serial_no,
        user_id,
        action,
        driver_id,
        vehicle_id,
        status_id
      )
      VALUES ?
      `,
      [
        serials.map((serial) => [
          serial,
          user_id || null,
          "TRUCK6W_ACCEPT",
          driver_id,
          vehicle_id,
          5,
        ]),
      ],
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

export const getDcScan = async (req, res) => {
  let connection;

  try {
    const { truck6w_accept = "Y", dc_accept = "N" } = req.query;

    const currentUserId = req.user?.user_id || req.query.user_id;

    if (!currentUserId) {
      return res.status(400).json({
        success: false,
        message: "ต้องระบุ user_id หรือ login ก่อน",
      });
    }

    connection = await db.getConnection();

    const [rows] = await connection.query(
      `
      SELECT 
        b.id,
        b.do,
        b.serial_no,
        b.group_name,
        b.warehouse_name
      FROM bills_data b
      JOIN mm_user_dc d
        ON d.warehouse_id = b.warehouse_id   
      JOIN um_users u
        ON u.dc_id = d.id                    
      WHERE u.user_id = ?   
        AND u.role_id = 4
        AND b.dc_accept = ?
        AND b.truck6w_accept = ?
      ORDER BY b.id ASC
      `,
      [currentUserId, dc_accept, truck6w_accept],
    );

    res.status(200).json({
      success: true,
      data: rows,
    });
  } catch (err) {
    console.error("Error getBillsDC:", err);
    res.status(500).json({
      success: false,
      message: "ไม่สามารถดึงข้อมูล bills_data สำหรับ DC ได้",
      error: err.message,
    });
  } finally {
    if (connection) connection.release();
  }
};

export const updateDcAccept = async (req, res) => {
  let connection;

  try {
    const {
      serials,
      accept_flag = "Y",
      user_id,
    } = req.body;

    if (!serials || !Array.isArray(serials) || serials.length === 0) {
      return res.status(400).json({
        success: false,
        message: "กรุณาระบุ serials เป็น array",
      });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    // ✅ UPDATE (DC รับของ)
    await connection.query(
      `
      UPDATE bills_data
      SET 
        dc_accept = ?,
        status_id = 4,
        status_name = 'พัสดุถึง DC'
      WHERE serial_no IN (?)
      `,
      [accept_flag, serials],
    );

    // ✅ INSERT LOG (ทำเหมือน 6w แต่เป็น dc)
    await connection.query(
      `
      INSERT INTO log_dc_accept (
        serial_no,
        user_id,
        action,
        status_id
      )
      VALUES ?
      `,
      [
        serials.map((serial) => [
          serial,
          user_id || null,
          "DC_ACCEPT",
          6,
        ]),
      ],
    );

    await connection.commit();

    res.status(200).json({
      success: true,
      message: `อัปเดต dc_accept = '${accept_flag}' ให้ ${serials.length} รายการเรียบร้อย`,
    });
  } catch (err) {
    if (connection) await connection.rollback();

    console.error("Error updateDcAccept:", err);

    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการอัปเดต dc_accept",
      error: err.message,
    });
  } finally {
    if (connection) connection.release();
  }
};
