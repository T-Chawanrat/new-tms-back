import db from "../config/db.js";

import {
  validateHead,
  getPackageMap,
  getWarehouse,
  generateDo,
  checkDuplicateSN,
  insertLogs,
  insertPending,
  insertDataAdv,
  insertDataAdvPackages,
  insertDataAdvSN,
} from "../services/data-adv.service.js";

/* =========================
   CREATE MAIN API
========================= */
export const createDataAdv = async (req, res) => {
  let conn;

  try {
    const { head, detail, sendId } = req.body;

    conn = await db.getConnection();
    await conn.beginTransaction();

    if (!head || !Array.isArray(detail)) {
      throw new Error("INVALID_PAYLOAD");
    }

    // 🔥 รวม serial ไว้ก่อน (ใช้ทุก error)
    const allSerials = detail.flatMap((d) => d.serialNo || []);

    // 🔴 1. validate tel
    try {
      validateHead(head);
    } catch (err) {
      if (err.code === "INVALID_TEL") {
        await insertLogs(conn, allSerials, head, sendId, null, "INVALID_TEL");

        await insertPending(conn, {
          head,
          detail,
          sendId,
          error: "INVALID_TEL",
        });

        await conn.commit();
        return res.status(400).json({ message: "INVALID_TEL" });
      }
      throw err;
    }

    // 🔵 2. package
    const packageMap = await getPackageMap(conn, detail);

    // 🔵 3. warehouse
    const warehouse = await getWarehouse(conn, head);

    if (!warehouse) {
      await insertLogs(conn, allSerials, head, sendId, null, "INVALID_ADDRESS");

      await insertPending(conn, {
        head,
        detail,
        sendId,
        error: "INVALID_ADDRESS",
      });

      await conn.commit();
      return res.status(400).json({ message: "INVALID_ADDRESS" });
    }

    // 🔵 4. duplicate
    const dupSN = await checkDuplicateSN(conn, allSerials);

    if (dupSN.length > 0) {
      const dupSet = new Set(dupSN);

      await insertLogs(conn, allSerials, head, sendId, dupSet);

      await insertPending(conn, {
        head,
        detail,
        sendId,
        error: "DUPLICATE_SN",
        dupSet,
      });

      await conn.commit();
      return res.status(400).json({
        message: "DUPLICATE_SN",
        duplicates: dupSN,
      });
    }

    // 🔥 5. generate DO (ผ่านหมดแล้วเท่านั้น)
    const doNo = await generateDo(conn);

    // 🔥 6. insert head
    const dataAdvId = await insertDataAdv(
      conn,
      {
        ...head,
        do_no: doNo,
        warehouse_id: warehouse.warehouse_id,
        warehouse_name: warehouse.warehouse_name,
      },
      sendId,
    );

    // 🔵 7. packages
    await insertDataAdvPackages(conn, dataAdvId, detail, packageMap);

    // 🔵 8. serial
    await insertDataAdvSN(conn, dataAdvId, detail, head);

    await conn.commit();

    return res.json({
      success: true,
      do_no: doNo,
      data_adv_id: dataAdvId,
    });
  } catch (err) {
    if (conn) await conn.rollback();

    return res.status(400).json({
      message: err.message,
    });
  } finally {
    if (conn) conn.release();
  }
};

/* =========================
   GET LIST
========================= */
export const getDataAdv = async (req, res) => {
  let conn;

  try {
    conn = await db.getConnection();

    const [rows] = await conn.query(`
      SELECT 
        id,
        do_no,
        recipient_name,
        province,
        warehouse_name,
        send_id,
        created_at
      FROM data_adv
      ORDER BY created_at DESC
      LIMIT 50
    `);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  } finally {
    if (conn) conn.release();
  }
};

/* =========================
   GET DETAIL
========================= */
export const getDataAdvDetail = async (req, res) => {
  let conn;

  try {
    conn = await db.getConnection();
    const { id } = req.params;

    const [[head]] = await conn.query(`SELECT * FROM data_adv WHERE id = ?`, [
      id,
    ]);

    if (!head) {
      return res.status(404).json({ message: "NOT_FOUND" });
    }

    const [packages] = await conn.query(
      `
    SELECT 
      p.*,
      q.package_name
      FROM data_adv_packages p
      LEFT JOIN quotation_adv q
      ON p.package_id = q.package_id
      WHERE p.data_adv_id = ?
  `,
      [id],
    );

    const [sn] = await conn.query(
      `
      SELECT 
        s.id,
        s.serial_no,
        s.record_status,
        s.product_status_id,
        ps.status_name,
        s.created_at
      FROM data_adv_sn s
      LEFT JOIN m_product_status ps 
        ON s.product_status_id = ps.id
      WHERE s.data_adv_id = ?
    `,
      [id],
    );

    res.json({
      head,
      packages,
      sn,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  } finally {
    if (conn) conn.release();
  }
};
