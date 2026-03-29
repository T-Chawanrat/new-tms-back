import db from "../config/db.js";
import {
  generateDo,
  getPackageMap,
  insertDataAdv,
  insertDataAdvPackages,
  generateSerialId,
} from "../services/data-adv.service.js";

/* =========================
   GET LOGS DUPLICATE
========================= */
export const getLogsDataAdv = async (req, res) => {
  let conn;

  try {
    conn = await db.getConnection();

    const [rows] = await conn.query(`
      SELECT *
      FROM logs_data_adv
      WHERE dup_status IS NULL OR dup_status != 'FIXED'
      ORDER BY created_at DESC
      LIMIT 100
    `);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  } finally {
    if (conn) conn.release();
  }
};

export const getLogsGroup = async (req, res) => {
  let conn;

  try {
    conn = await db.getConnection();

    const { referenceNo, sendId } = req.query;

    if (!referenceNo || !sendId) {
      return res.status(400).json({
        message: "MISSING_REFERENCE_OR_SEND_ID",
      });
    }

    const [rows] = await conn.query(
      `
      SELECT *
      FROM logs_data_adv
      WHERE reference_no = ?
      AND send_id = ?
      `,
      [referenceNo, sendId],
    );

    res.json(rows);
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  } finally {
    if (conn) conn.release();
  }
};

export const getLogsGroupList = async (req, res) => {
  let conn;

  try {
    conn = await db.getConnection();

    const [rows] = await conn.query(`
      SELECT 
        reference_no,
        send_id,
        COUNT(*) as total,
        SUM(CASE WHEN reason != 'OK' THEN 1 ELSE 0 END) as error_count,
        MAX(created_at) as created_at
      FROM logs_data_adv
      WHERE dup_status IS NULL OR dup_status != 'FIXED'
      GROUP BY reference_no, send_id
      ORDER BY created_at DESC
    `);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  } finally {
    if (conn) conn.release();
  }
};

/* =========================
   FIX DUPLICATE
========================= */
export const fixDuplicate = async (req, res) => {
  let conn;

  try {
    conn = await db.getConnection();
    await conn.beginTransaction();

    const { referenceNo, sendId, head, detail, fixedBy } = req.body;

    if (!referenceNo || !sendId) {
      throw new Error("MISSING_GROUP_KEY");
    }

    // 🔥 1. ดึง group จาก logs
    const [logs] = await conn.query(
      `
      SELECT *
      FROM logs_data_adv
      WHERE reference_no = ?
      AND send_id = ?
      `,
      [referenceNo, sendId],
    );

    if (logs.length === 0) {
      throw new Error("NO_DATA_IN_LOGS");
    }

    // 🔥 2. validate เบอร์
    if (!head.tel1 || head.tel1.length < 9) {
      throw new Error("INVALID_TEL");
    }

    // 🔥 3. หา warehouse
    const [warehouse] = await conn.query(
      `
      SELECT warehouse_id, warehouse_name
      FROM m_warehouses
      WHERE tambon_name_th = ?
      AND ampur_name_th = ?
      AND province_name_th = ?
      LIMIT 1
      `,
      [head.subdistrict, head.district, head.province],
    );

    if (warehouse.length === 0) {
      throw new Error("INVALID_ADDRESS");
    }

    const warehouseData = warehouse[0];

    // 🔥 4. package map
    const packageMap = await getPackageMap(conn, detail);

    // 🔥 5. รวม serial ทั้ง group
    let allSerials = [];

    for (const l of logs) {
      allSerials.push(l.serial_no);
    }

    // 🔥 replace serial จาก frontend (ตัวที่แก้)
    const editedMap = new Map();

    for (const d of detail) {
      if (!Array.isArray(d.serialNo)) continue;

      for (const sn of d.serialNo) {
        editedMap.set(sn.old, sn.new);
      }
    }

    allSerials = allSerials.map((sn) => editedMap.get(sn) || sn);

    // 🔥 6. check duplicate
    const [dup] = await conn.query(
      `
      SELECT serial_no
      FROM data_adv_sn
      WHERE serial_no IN (?)
      AND record_status = 'ACTIVE'
      AND (product_status_id IS NULL OR product_status_id != 18)
      `,
      [allSerials],
    );

    if (dup.length > 0) {
      throw new Error("DUPLICATE_SN");
    }

    // 🔥 7. create data_adv
    const doNo = await generateDo(conn);

    const dataAdvId = await insertDataAdv(
      conn,
      {
        ...head,
        do_no: doNo,
        warehouse_id: warehouseData.warehouse_id,
        warehouse_name: warehouseData.warehouse_name,
      },
      sendId,
    );

    // 🔥 8. insert packages
    await insertDataAdvPackages(conn, dataAdvId, detail, packageMap);

    // 🔥 9. map SN → package
    const snPackageMap = new Map();

    for (const d of detail) {
      if (!Array.isArray(d.serialNo)) continue;

      for (const sn of d.serialNo) {
        const newSn = sn.new || sn;

        snPackageMap.set(newSn, {
          packageId: d.packageId,
          packageDetailId: d.packageDetailId,
        });
      }
    }

    // 🔥 10. insert SN ใหม่
    const snValues = allSerials.map((sn) => {
      const pkg = snPackageMap.get(sn);

      if (!pkg) {
        throw new Error(`PACKAGE_NOT_FOUND_FOR_SN: ${sn}`);
      }

      return [
        dataAdvId,
        pkg.packageId,
        pkg.packageDetailId,
        sn,
        generateSerialId(),
        "ACTIVE",
        1,
      ];
    });

    await conn.query(
      `
      INSERT INTO data_adv_sn (
        data_adv_id,
        package_id,
        package_detail_id,
        serial_no,
        serial_id,
        record_status,
        product_status_id
      ) VALUES ?
      `,
      [snValues],
    );

    // 🔥 11. log history
    const originalRawData = logs[0]?.raw_data
      ? typeof logs[0].raw_data === "string"
        ? JSON.parse(logs[0].raw_data || "{}")
        : logs[0].raw_data
      : {};

    const originalHead = originalRawData.head || {};

    const oldData = {
      tel1: originalHead.tel1 || "",
      subdistrict: originalHead.subdistrict || "",
      district: originalHead.district || "",
      province: originalHead.province || "",
      serials: logs.map((x) => x.serial_no),
    };

    const newData = {
      tel1: head.tel1 || "",
      subdistrict: head.subdistrict || "",
      district: head.district || "",
      province: head.province || "",
      serials: allSerials,
    };

    const reasons = [...new Set(logs.map((x) => x.reason).filter(Boolean))];

    await conn.query(
      `
  INSERT INTO logs_data_adv_fix (
    old_data,
    new_data,
    reason,
    fixed_by,
    send_id,
    created_at
  ) VALUES (?, ?, ?, ?, ?, NOW())
  `,
      [
        JSON.stringify(oldData),
        JSON.stringify(newData),
        reasons.join(","),
        fixedBy,
        sendId,
      ],
    );

    const [pendingRows] = await conn.query(
      `
    SELECT id
    FROM data_adv_pending
    WHERE reference_no = ?
    AND send_id = ?
    `,
      [referenceNo, sendId],
    );

    if (pendingRows.length > 0) {
      const pendingIds = pendingRows.map((x) => x.id);

      await conn.query(
        `
    DELETE FROM data_adv_pending_item
    WHERE pending_id IN (?)
    `,
        [pendingIds],
      );

      await conn.query(
        `
    DELETE FROM data_adv_pending
    WHERE id IN (?)
    `,
        [pendingIds],
      );
    }

    await conn.commit();

    res.json({
      success: true,
      message: "FIX SUCCESS",
    });
  } catch (err) {
    if (conn) await conn.rollback();

    res.status(400).json({
      message: err.message,
    });
  } finally {
    if (conn) conn.release();
  }
};
