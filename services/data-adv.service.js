/* =========================
   VALIDATE
========================= */
export function validateHead(head) {
  const tel = String(head.tel1 ?? "").trim();

  if (!/^\d{1,10}$/.test(tel)) {
    const err = new Error("INVALID_TEL");
    err.code = "INVALID_TEL";
    throw err;
  }
}

export function generateSerialId() {
  return `SN-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function getPackageMap(conn, detail) {
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

export async function getWarehouse(conn, head) {
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

export async function generateDo(conn) {
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

export async function checkDuplicateSN(conn, serials) {
  if (serials.length === 0) return [];

  const [rows] = await conn.query(
    `
    SELECT serial_no
    FROM data_adv_sn
    WHERE serial_no IN (?)
    AND record_status = 'ACTIVE'
    AND (product_status_id IS NULL OR product_status_id != 18)
    `,
    [serials],
  );

  return rows.map((r) => r.serial_no);
}

/* =========================
   INSERT HEAD
========================= */
export async function insertDataAdv(conn, head, sendId) {
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

    do_no: head.do_no,
    warehouse_id: head.warehouse_id,
    warehouse_name: head.warehouse_name,
  });

  return res.insertId;
}

/* =========================
   INSERT PACKAGES (BATCH)
========================= */
export async function insertDataAdvPackages(
  conn,
  dataAdvId,
  detail,
  packageMap,
) {
  const values = detail.map((d) => {
    const pkg = packageMap[d.packageId];

    return [
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
      pkg.package_price,
    ];
  });

  if (values.length === 0) return;

  await conn.query(
    `
    INSERT INTO data_adv_packages (
      data_adv_id,
      package_id,
      package_detail_id,
      qty_of_serial,
      cost_difference,
      height,
      width,
      length,
      weight,
      size_type,
      q,
      type_send,
      price
    ) VALUES ?
    `,
    [values],
  );
}

/* =========================
   INSERT SERIAL + DUP CHECK
========================= */
export async function insertDataAdvSN(conn, dataAdvId, detail) {
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

export async function insertLogs(
  conn,
  serials,
  head,
  sendId,
  dupSet = null,
  groupReason = null,
) {
  const values = serials.map((sn) => {
    let reason = "OK";

    if (groupReason) {
      reason = groupReason;
    } else if (dupSet && dupSet.has(sn)) {
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

export async function insertPending(
  conn,
  { head, detail, sendId, error, dupSet },
) {
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
    if (!Array.isArray(d.serialNo)) continue;

    for (const sn of d.serialNo) {
      let reason = error;

      if (error === "DUPLICATE_SN") {
        if (dupSet && dupSet.has(sn)) {
          reason = "DUPLICATE_SN";
        } else {
          reason = "OK";
        }
      }

      items.push([
        pendingId,
        sn,
        d.packageId,
        d.packageDetailId,
        reason,
      ]);
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