import db from "../config/db.js";

/* =========================
   VALIDATE
========================= */
function validateHead(head) {
  const tel = String(head.tel1 ?? "").trim();

  if (!/^\d{1,10}$/.test(tel)) {
    const err = new Error("INVALID_TEL");
    err.code = "INVALID_TEL";
    throw err;
  }
}

function generateSerialId() {
  return `SN-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function getPackageMap(conn, detail) {
  const packageIds = [
    ...new Set(detail.map((d) => d.packageId).filter(Boolean)),
  ];

  if (packageIds.length === 0) {
    throw new Error("NO_PACKAGE_ID");
  }

  const [rows] = await conn.query(
    `
    SELECT package_id, package_name, group_id,
           group_bill AS group_name, package_price
    FROM quotation_adv
    WHERE package_id IN (?)
    `,
    [packageIds],
  );

  if (rows.length !== packageIds.length) {
    throw new Error("INVALID_PACKAGE_ID");
  }

  const map = {};
  for (const r of rows) {
    map[r.package_id] = r;
  }

  return map;
}

async function getWarehouse(conn, head) {
  const [rows] = await conn.query(
    `
    SELECT tambon_id, warehouse_id, warehouse_name
    FROM m_warehouses
    WHERE tambon_name_th = ?
    AND ampur_name_th = ?
    AND province_name_th = ?
    LIMIT 1
    `,
    [head.subdistrict, head.district, head.province],
  );

  return rows[0] || null;
}

async function generateDo(conn) {
  const now = new Date();

  const y = now.getFullYear().toString().slice(-2);
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");

  const datePart = `${y}${m}${d}`;

  const [rows] = await conn.query(
    `
    SELECT MAX(do_no) as lastDo
    FROM data_adv
    WHERE do_no LIKE ?
    `,
    [`ADV0001-${datePart}-%`],
  );

  let running = 1;

  if (rows[0].lastDo) {
    const last = rows[0].lastDo.split("-")[2];
    running = parseInt(last, 10) + 1;
  }

  return `ADV0001-${datePart}-${String(running).padStart(6, "0")}`;
}

async function checkDuplicateSN(conn, serials) {
  if (serials.length === 0) return [];

  const [rows] = await conn.query(
    `
  SELECT serial_no
  FROM data_adv_sn
  WHERE serial_no IN (?)
  AND record_status = 'ACTIVE'
  AND product_status_id != 18
  `,
    [serials],
  );

  return rows.map((r) => r.serial_no);
}

async function insertLogs(
  conn,
  serials,
  head,
  sendId,
  dupSet = null,
  groupReason = null,
) {
  const values = serials.map((sn) => {
    let reason = "OK";

    // 🔴 case: error ทั้งก้อน
    if (groupReason) {
      reason = groupReason;
    }

    // 🔵 case: duplicate แยก SN
    else if (dupSet && dupSet.has(sn)) {
      reason = "DUPLICATE_SN";
    }

    return [sn, head.referenceNo, reason, JSON.stringify({ head }), sendId];
  });

  await conn.query(
    `
    INSERT INTO logs_data_adv
    (serial_no, reference_no, reason, raw_data, send_id)
    VALUES ?
    `,
    [values],
  );
}

async function insertPending(conn, { head, detail, sendId, error, dupSet }) {
  const [result] = await conn.query(
    `
    INSERT INTO data_adv_pending
    (send_id, reference_no, error_summary, raw_data)
    VALUES (?, ?, ?, ?)
    `,
    [sendId, head.referenceNo, error, JSON.stringify({ head, detail })],
  );

  const pendingId = result.insertId;

  const items = [];

  for (const d of detail) {
    for (const sn of d.serialNo || []) {
      let reason = error;

      // 🔥 แยกเฉพาะกรณี duplicate
      if (error === "DUPLICATE_SN") {
        if (dupSet && dupSet.has(sn)) {
          reason = "DUPLICATE_SN";
        } else {
          reason = "OK"; // ✅ ตัวที่ไม่ซ้ำ
        }
      }

      items.push([pendingId, sn, d.packageId, d.packageDetailId, reason]);
    }
  }

  if (items.length > 0) {
    await conn.query(
      `
      INSERT INTO data_adv_pending_item
      (pending_id, serial_no, package_id, package_detail_id, reason)
      VALUES ?
      `,
      [items],
    );
  }
}

/* =========================
   INSERT HEAD
========================= */
async function insertDataAdv(conn, head, sendId) {
  const [res] = await conn.query(`INSERT INTO data_adv SET ?`, {
    reference_no: head.referenceNo,
    reference: head.reference,
    delivery_status: head.deliveryStatus,
    shipper_id: head.shipperId,

    recipient_code: head.recipientCode,
    recipient_name: head.recipientName,
    recipient_type: head.recipientType,

    address: head.address,
    sub_district: head.subdistrict,
    district: head.district,
    province: head.province,
    zipcode: head.zipCode,

    tel1: head.tel1,
    tel1_ext: head.tel1Ext,
    tel2: head.tel2,
    tel2_ext: head.tel2Ext,

    line_id: head.lineId,
    cod: head.cod,
    document_return_id: head.documentReturnId,
    document_return_description: head.documentReturnDescription,

    payment_id: head.paymentId,
    qty_of_detail: head.qtyOfDetail,
    is_pickup_customer: head.isPickupCustomer,

    send_id: sendId,

    // 🔥 เพิ่มตรงนี้
    do_no: head.do_no,
    warehouse_id: head.warehouse_id,
    warehouse_name: head.warehouse_name,
  });

  return res.insertId;
}

/* =========================
   INSERT PACKAGES (BATCH)
========================= */
async function insertDataAdvPackages(conn, dataAdvId, detail) {
  const values = detail.map((d) => [
    dataAdvId,
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
    d.type_send,
  ]);

  if (values.length === 0) return;

  await conn.query(
    `
    INSERT INTO data_adv_packages (
      data_adv_id, package_id, package_detail_id,
      qty_of_serial, cost_difference,
      height, width, length, weight,
      size_type, q, type_send
    ) VALUES ?
    `,
    [values],
  );
}

/* =========================
   INSERT SERIAL + DUP CHECK
========================= */
async function insertDataAdvSN(conn, dataAdvId, detail) {
  const insertValues = [];

  for (const d of detail) {
    if (!Array.isArray(d.serialNo)) continue;

    for (const sn of d.serialNo) {
      if (!sn) continue;

      insertValues.push([
        dataAdvId,
        d.packageId,
        d.packageDetailId,
        sn,
        generateSerialId(),
        "ACTIVE",
      ]);
    }
  }

  if (insertValues.length === 0) return;

  await conn.query(
    `
    INSERT INTO data_adv_sn (
      data_adv_id,
      package_id,
      package_detail_id,
      serial_no,
      serial_id,
      record_status
    ) VALUES ?
    `,
    [insertValues],
  );
}

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
    for (const d of detail) {
      const pkg = packageMap[d.packageId];

      await conn.query(`INSERT INTO data_adv_packages SET ?`, {
        data_adv_id: dataAdvId,
        package_id: d.packageId,
        package_detail_id: d.packageDetailId,
        qty_of_serial: d.qtyOfSerial,
        cost_difference: d.costDifference,
        height: d.height,
        width: d.width,
        length: d.length,
        weight: d.weight,
        size_type: d.size_type,
        q: d.q,
        type_send: d.type_send,
        price: pkg.package_price,
      });
    }

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
      `SELECT * FROM data_adv_packages WHERE data_adv_id = ?`,
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

    // 🔥 4. รวม serial ทั้ง group
    let allSerials = [];

    for (const l of logs) {
      allSerials.push(l.serial_no);
    }

    // 🔥 replace serial จาก frontend (ตัวที่แก้)
    const editedSerial = detail[0].serialNo[0];

    allSerials = allSerials.map((sn) =>
      sn === logs[0].serial_no ? editedSerial : sn,
    );

    // 🔥 5. check duplicate
    const [dup] = await conn.query(
      `
  SELECT serial_no
  FROM data_adv_sn
  WHERE serial_no IN (?)
  AND record_status = 'ACTIVE'
  AND product_status_id != 18
  `,
      [allSerials],
    );

    if (dup.length > 0) {
      throw new Error("DUPLICATE_SN");
    }

    // 🔥 6. create data_adv
    const dataAdvId = await insertDataAdv(
      conn,
      {
        ...head,
        warehouse_id: warehouseData.warehouse_id,
        warehouse_name: warehouseData.warehouse_name,
      },
      sendId,
    );

    // 🔥 7. packages
    await insertDataAdvPackages(conn, dataAdvId, detail);

    // 🔥 8. mark SN เก่าเป็น INVALID ก่อน
    await conn.query(
      `
  UPDATE data_adv_sn
  SET record_status = 'INVALID'
  WHERE serial_no IN (?)
  AND record_status = 'ACTIVE'
  `,
      [allSerials],
    );

    // 🔥 9. insert SN ใหม่
    const snValues = allSerials.map((sn) => [
      dataAdvId,
      detail[0].packageId,
      detail[0].packageDetailId,
      sn,
      generateSerialId(),
      "ACTIVE",
      1,
    ]);

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

    await conn.query(
      `
      INSERT INTO data_adv_sn (
        data_adv_id,
        package_id,
        package_detail_id,
        serial_no,
        serial_id,
        record_status
      ) VALUES ?
      `,
      [snValues],
    );

    // 🔥 9. mark logs = DONE
    await conn.query(
      `
      UPDATE logs_data_adv
      SET dup_status = 'FIXED'
      WHERE reference_no = ?
      AND send_id = ?
      `,
      [referenceNo, sendId],
    );

    // 🔥 10. log fix
    await conn.query(
      `
      INSERT INTO logs_data_adv_fix (
        old_reference,
        new_reference,
        fixed_by,
        send_id,
        created_at
      ) VALUES (?, ?, ?, ?, NOW())
      `,
      [referenceNo, referenceNo, fixedBy, sendId],
    );

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
