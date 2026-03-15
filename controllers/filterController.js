import db from "../config/db.js";

export const getCustomers = async (req, res) => {
  try {
    const sql = `
      SELECT *
      FROM xsendwork_tmg.um_customers 
      ORDER BY customer_name ASC
    `;
    const [rows] = await db.query(sql);

    res.json({
      data: rows,
      count: rows.length,
    });
  } catch (err) {
    console.error("getCustomers error:", err);
    res.status(500).json({ message: "An error occurred" });
  }
};

export const getDropdownWarehouse = async (req, res) => {
  try {
    const sql = `
      SELECT *
      FROM xsendwork_tmg.mm_warehouses
      `;
    const [rows] = await db.query(sql);

    res.json({
      data: rows,
      count: rows.length,
    });
  } catch (err) {
    console.error("getDropdownWarehouse error:", err);
    res.status(500).json({ message: "An error occurred" });
  }
};

export const getWarehouses = async (req, res) => {
  try {
    const { zip_code } = req.query; 

    let sql = `
      SELECT *
      FROM xsendwork_tmg.master_warehouses
    `;
    const params = [];

    if (zip_code) {
      sql += ` WHERE zip_code = ?`;
      params.push(zip_code);
    }

    const [rows] = await db.query(sql, params);

    res.json({
      data: rows,
      count: rows.length,
    });
  } catch (err) {
    console.error("getWarehouses error:", err);
    res.status(500).json({ message: "An error occurred" });
  }
};

export const searchAddress = async (req, res) => {
  try {
    const { keyword } = req.query;

    if (!keyword || String(keyword).trim().length < 2) {
      return res.json({ data: [], count: 0 });
    }

    const kw = `%${keyword.trim()}%`;

    const sql = `
      SELECT
        id,
        tambon_id,
        tambon_name_th,
        ampur_id,
        ampur_name_th,
        province_id,
        province_name_th,
        zip_code,
        warehouse_id,
        warehouse_code,
        warehouse_name
      FROM xsendwork_tmg.master_warehouses
      WHERE
        tambon_name_th LIKE ?
        OR ampur_name_th LIKE ?
        OR province_name_th LIKE ?
        OR zip_code LIKE ?
      LIMIT 50
    `;

    const params = [kw, kw, kw, kw];

    const [rows] = await db.query(sql, params);

    res.json({
      data: rows,
      count: rows.length,
    });
  } catch (err) {
    console.error("searchAddress error:", err);
    res.status(500).json({ message: "An error occurred" });
  }
};

export const getDrivers = async (req, res) => {
  let connection;

  try {
    connection = await db.getConnection();

    const [rows] = await connection.query(`
      SELECT 
        id,
        CONCAT(first_name, ' ', last_name) AS name
      FROM mm_drivers
      ORDER BY first_name
    `);

    res.json(rows);
  } catch (err) {
    console.error("GET DRIVERS ERROR:", err);
    res.status(500).json({ message: "โหลด drivers ไม่สำเร็จ" });
  } finally {
    if (connection) connection.release();
  }
};

export const getVehicleTypes = async (req, res) => {
  let connection;

  try {
    connection = await db.getConnection();

    const [rows] = await connection.query(`
      SELECT 
        id,
        type_name
      FROM mm_vehicle_types
      ORDER BY type_name
    `);

    res.json(rows);
  } catch (err) {
    console.error("GET VEHICLE TYPES ERROR:", err);
    res.status(500).json({ message: "โหลด vehicle types ไม่สำเร็จ" });
  } finally {
    if (connection) connection.release();
  }
};

export const getVehicles = async (req, res) => {
  let connection;

  try {
    connection = await db.getConnection();

    const [rows] = await connection.query(`
      SELECT 
        v.id,
        v.brand,
        v.license_plate,
        vt.type_name
      FROM mm_vehicles v
      LEFT JOIN mm_vehicle_types vt 
        ON v.vehicle_type_id = vt.id
      ORDER BY v.license_plate
    `);

    res.json(rows);
  } catch (err) {
    console.error("GET VEHICLES ERROR:", err);
    res.status(500).json({ message: "โหลด vehicles ไม่สำเร็จ" });
  } finally {
    if (connection) connection.release();
  }
};
