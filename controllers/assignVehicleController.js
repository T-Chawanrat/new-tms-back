import db from "../config/db.js";

export const assignVehicle = async (req, res) => {
  let connection;

  try {
    connection = await db.getConnection();

    const { doList, driver_id, vehicle_id } = req.body;

    if (!Array.isArray(doList) || doList.length === 0) {
      return res.status(400).json({ message: "ไม่พบ DO" });
    }

    await connection.query(
      `
      UPDATE bills_data
      SET driver_id = ?, vehicle_id = ?
      WHERE do IN (?)
      `,
      [driver_id, vehicle_id, doList],
    );

    res.json({
      message: "assign รถสำเร็จ",
    });
  } catch (err) {
    console.error("ASSIGN VEHICLE ERROR:", err);
    res.status(500).json({ message: "assign รถไม่สำเร็จ" });
  } finally {
    if (connection) connection.release();
  }
};