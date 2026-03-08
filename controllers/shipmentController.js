import db from "../config/db.js";
import { getPaginationParams } from "../utils/pagination.js";

export const insertDuplicateFromBody = async (
  connection,
  head,
  detail,
  sendId,
  status,
) => {
  const values = [];

  for (const d of detail) {
    if (!Array.isArray(d.serialNo)) continue;

    for (const sn of d.serialNo) {
      values.push([
        head.referenceNo ?? null,
        sn ?? null,
        head.reference ?? null,

        head.recipientCode ?? null,
        head.recipientName ?? null,
        head.tel1 ?? null,
        head.address ?? null,
        head.subdistrict ?? null,
        head.district ?? null,
        head.province ?? null,
        head.zipCode ?? null,

        status,

        head.deliveryStatus ?? null,
        head.shipperId ?? null,
        head.recipientType ?? null,
        head.tel1Ext ?? null,
        head.tel2 ?? null,
        head.tel2Ext ?? null,
        head.lineId ?? null,
        head.documentReturnId ?? null,
        head.documentReturnDescription ?? null,
        head.paymentId ?? null,
        head.qtyOfDetail ?? null,
        head.isPickupCustomer ?? null,

        sendId ?? null,

        d.packageId ?? null,
        d.packageDetailId ?? null,
        d.qtyOfSerial ?? null,
        d.height ?? null,
        d.width ?? null,
        d.length ?? null,
        d.weight ?? null,
        d.size_type ?? null,
        d.q ?? null,
        d.type_send ?? null,
      ]);
    }
  }

  if (values.length > 0) {
    await connection.query(
      `
      INSERT INTO duplicate_data (
        NO_BILL,
        SERIAL_NO,
        REFERENCE,

        RECIPIENT_CODE,
        RECIPIENT_NAME,
        RECIPIENT_TEL,
        RECIPIENT_ADDRESS,
        RECIPIENT_SUBDISTRICT,
        RECIPIENT_DISTRICT,
        RECIPIENT_PROVINCE,
        RECIPIENT_ZIPCODE,

        dup_status,

        delivery_status,
        shipper_id,
        recipient_type,
        tel1_ext,
        tel2,
        tel2_ext,
        line_id,
        document_return_id,
        document_return_description,
        payment_id,
        qty_of_detail,
        is_pickup_customer,

        send_id,

        package_id,
        package_detail_id,
        qty_of_serial,
        height,
        width,
        length,
        weight,
        size_type,
        q,
        type_send
      )
      VALUES ?
      `,
      [values],
    );
  }
};

export const createBillAdv = async (req, res) => {
  let connection;

  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    const { head, detail, sendId } = req.body;

    if (!head || !Array.isArray(detail)) {
      await connection.rollback();
      return res.status(400).json({
        message: "รูปแบบข้อมูลไม่ถูกต้อง",
      });
    }

    const tel = String(head.tel1 ?? "").trim();
    const telRegex = /^\d{1,10}$/;

    if (!telRegex.test(tel)) {
      await insertDuplicateFromBody(
        connection,
        head,
        detail,
        sendId,
        "INVALID_TEL",
      );

      await connection.commit();

      return res.status(400).json({
        message: "เบอร์โทรไม่ถูกต้อง",
      });
    }

    // =========================
    // 1️⃣ ดึง packageId
    // =========================
    const packageIds = [
      ...new Set(detail.map((d) => d.packageId).filter(Boolean)),
    ];

    if (packageIds.length === 0) {
      await connection.rollback();
      return res.status(400).json({
        message: "ไม่พบ packageId",
      });
    }

    // =========================
    // 2️⃣ Query quotation_adv
    // =========================
    const [packages] = await connection.query(
      `
      SELECT 
        package_id,
        package_name,
        group_id,
        group_bill AS group_name,
        package_price
      FROM quotation_adv
      WHERE package_id IN (?)
      `,
      [packageIds],
    );

    if (packages.length !== packageIds.length) {
      await connection.rollback();
      return res.status(400).json({
        message: "มี packageId บางรายการไม่พบใน quotation_adv",
      });
    }

    const packageMap = {};
    for (const p of packages) {
      packageMap[p.package_id] = p;
    }

    // =========================
    // 3️⃣ หา warehouse
    // =========================
    const [warehouses] = await connection.query(
      `
      SELECT tambon_id, warehouse_id, warehouse_name
      FROM master_warehouses
      WHERE tambon_name_th = ?
      AND ampur_name_th = ?
      AND province_name_th = ?
      LIMIT 1
      `,
      [head.subdistrict ?? null, head.district ?? null, head.province ?? null],
    );

    if (warehouses.length === 0) {
      await insertDuplicateFromBody(
        connection,
        head,
        detail,
        sendId,
        "INVALID_ADDRESS",
      );

      await connection.commit();

      return res.status(400).json({
        message: "ที่อยู่ผิด",
      });
    }

    const warehouse = warehouses[0];

    // =========================
    // 4️⃣ Generate REFERENCE
    // =========================
    const now = new Date();
    const year2 = now.getFullYear().toString().slice(-2);
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const datePart = `${year2}${month}${day}`;

    const [countResult] = await connection.query(
      `
      SELECT COUNT(*) as total
      FROM bills_data
      WHERE REFERENCE LIKE ?
      `,
      [`ADV0001-${datePart}-%`],
    );

    const running = String((countResult[0].total || 0) + 1).padStart(6, "0");
    const generatedReference = `ADV0001-${datePart}-${running}`;

    const insertValues = [];

    // =========================
    // 5️⃣ Build insertValues
    // =========================
    for (const d of detail) {
      if (!Array.isArray(d.serialNo)) continue;

      const pkg = packageMap[d.packageId] || {};

      for (const serial of d.serialNo) {
        insertValues.push([
          head.referenceNo ?? null,
          serial ?? null,
          generatedReference,
          null,
          null,
          null,
          head.recipientCode ?? null,
          head.recipientName ?? null,
          head.tel1 ?? null,
          head.address ?? null,
          head.subdistrict ?? null,
          head.district ?? null,
          head.province ?? null,
          head.zipCode ?? null,
          warehouse.tambon_id ?? null,
          pkg.package_price ?? null,
          warehouse.warehouse_id ?? null,
          warehouse.warehouse_name ?? null,
          null,
          "API",
          1,
          "รับเข้าระบบ",
          pkg.group_id ?? null,
          pkg.group_name ?? null,

          head.deliveryStatus ?? null,
          head.shipperId ?? null,
          head.recipientType ?? null,
          head.tel1Ext ?? null,
          head.tel2 ?? null,
          head.tel2Ext ?? null,
          head.lineId ?? null,
          head.cod ?? 0,
          head.documentReturnId ?? null,
          head.documentReturnDescription ?? null,
          head.paymentId ?? null,
          head.qtyOfDetail ?? null,
          head.isPickupCustomer ?? null,
          sendId ?? null,

          d.packageId ?? null,
          pkg.package_name ?? null,
          d.packageDetailId ?? null,
          d.qtyOfSerial ?? null,
          d.costDifference ?? 0,
          d.height ?? null,
          d.width ?? null,
          d.length ?? null,
          d.weight ?? null,
          d.size_type ?? null,
          d.q ?? null,
          d.type_send ?? null,
        ]);
      }
    }

    if (insertValues.length === 0) {
      await connection.rollback();
      return res.status(400).json({
        message: "ไม่พบ serial สำหรับบันทึก",
      });
    }

    // =========================
    // 6️⃣ ตรวจ SERIAL ซ้ำ
    // =========================
    const allSerials = insertValues.map((v) => v[1]).filter(Boolean);

    if (allSerials.length > 0) {
      const [existingRows] = await connection.query(
        `
        SELECT SERIAL_NO
        FROM bills_data
        WHERE SERIAL_NO IN (?)
        `,
        [allSerials],
      );

      if (existingRows.length > 0) {
        const duplicateSerials = existingRows.map((r) => r.SERIAL_NO);

        await insertDuplicateFromBody(
          connection,
          head,
          detail,
          sendId,
          "DUP_SN",
        );

        await connection.commit();

        return res.status(400).json({
          message: "พบ SERIAL ซ้ำ",
          duplicates: duplicateSerials,
        });
      }
    }

    // =========================
    // 7️⃣ Insert ปกติ
    // =========================
    await connection.query(
      `
      INSERT INTO bills_data (
        NO_BILL, SERIAL_NO, REFERENCE, SEND_DATE, customer_id, CUSTOMER_NAME,
        RECIPIENT_CODE, RECIPIENT_NAME, RECIPIENT_TEL, RECIPIENT_ADDRESS,
        RECIPIENT_SUBDISTRICT, RECIPIENT_DISTRICT, RECIPIENT_PROVINCE,
        RECIPIENT_ZIPCODE, sub_district_id, PRICE, warehouse_id, warehouse_name,
        user_id, type, status_id, status_name, group_id, group_name,
        delivery_status, shipper_id, recipient_type, tel1_ext,
        tel2, tel2_ext, line_id, cod, document_return_id,
        document_return_description, payment_id, qty_of_detail,
        is_pickup_customer, send_id,
        package_id, package_name, package_detail_id, qty_of_serial,
        cost_difference, height, width, length, weight, size_type, q, type_send
      ) VALUES ?
      `,
      [insertValues],
    );

    await connection.commit();

    return res.status(201).json({
      message: "บันทึกข้อมูลสำเร็จ",
      rowsInserted: insertValues.length,
    });
  } catch (err) {
    if (connection) await connection.rollback();

    console.error("BACKEND ERROR:", err);

    return res.status(500).json({
      message: "เกิดข้อผิดพลาดในการบันทึก",
      error: err.message,
    });
  } finally {
    if (connection) connection.release();
  }
};

export const getDuplicateData = async (req, res) => {
  let connection;

  try {
    connection = await db.getConnection();

    const { page, pageSize, skip } = getPaginationParams(req);

    const [rows] = await connection.query(
      `
      SELECT
        NO_BILL,
        SERIAL_NO,
        REFERENCE,
        SEND_DATE,
        customer_id,
        CUSTOMER_NAME,
        RECIPIENT_CODE,
        RECIPIENT_NAME,
        RECIPIENT_TEL,
        RECIPIENT_ADDRESS,
        RECIPIENT_SUBDISTRICT,
        RECIPIENT_DISTRICT,
        RECIPIENT_PROVINCE,
        RECIPIENT_ZIPCODE,
        user_id,
        created_at,
        updated_at,
        delivery_status,
        shipper_id,
        recipient_type,
        tel1_ext,
        tel2,
        tel2_ext,
        line_id,
        cod,
        document_return_id,
        document_return_description,
        payment_id,
        qty_of_detail,
        is_pickup_customer,
        send_id,
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
        dup_status
      FROM duplicate_data
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
      `,
      [pageSize, skip],
    );

    const [countResult] = await connection.query(
      `SELECT COUNT(*) AS total FROM duplicate_data`,
    );

    const total = countResult[0].total;

    return res.status(200).json({
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      data: rows,
    });
  } catch (err) {
    console.error("GET DUPLICATE ERROR:", err);

    return res.status(500).json({
      message: "ดึงข้อมูล duplicate_data ไม่สำเร็จ",
      error: err.message,
    });
  } finally {
    if (connection) connection.release();
  }
};

export const getBillsAdv = async (req, res) => {
  let connection;

  try {
    connection = await db.getConnection();

    const { page, pageSize, skip } = getPaginationParams(req);

    const [rows] = await connection.query(
      `
      SELECT
        NO_BILL,
        SERIAL_NO,
        REFERENCE,
        SEND_DATE,
        customer_id,
        CUSTOMER_NAME,
        RECIPIENT_CODE,
        RECIPIENT_NAME,
        RECIPIENT_TEL,
        RECIPIENT_ADDRESS,
        RECIPIENT_SUBDISTRICT,
        RECIPIENT_DISTRICT,
        RECIPIENT_PROVINCE,
        RECIPIENT_ZIPCODE,
        sub_district_id,
        PRICE,
        warehouse_id,
        warehouse_name,
        user_id,
        type,
        status_id,
        status_name,
        group_id,
        group_name,
        customer_input,
        warehouse_accept,
        dc_accept,
        image,
        sign,
        created_at,
        updated_at,
        delivery_status,
        shipper_id,
        recipient_type,
        tel1_ext,
        tel2,
        tel2_ext,
        line_id,
        cod,
        document_return_id,
        document_return_description,
        payment_id,
        qty_of_detail,
        is_pickup_customer,
        send_id,
        package_id,
        package_name,
        package_detail_id,
        qty_of_serial,
        cost_difference,
        height,
        width,
        length,
        weight,
        size_type,
        q,
        type_send
      FROM bills_data
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
      `,
      [pageSize, skip],
    );

    const [countResult] = await connection.query(
      `SELECT COUNT(*) AS total FROM bills_data`,
    );

    const total = countResult[0].total;

    return res.status(200).json({
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      data: rows,
    });
  } catch (err) {
    console.error("GET BILLS ERROR:", err);

    return res.status(500).json({
      message: "ดึงข้อมูล bills_data ไม่สำเร็จ",
      error: err.message,
    });
  } finally {
    if (connection) connection.release();
  }
};

export const fixDuplicate = async (req, res) => {
  let connection;

  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    const { head, detail, sendId, originalRow } = req.body;

    // 1 insert bill
    await createBillAdvInternal(connection, head, detail, sendId);

    // 2 delete duplicate
    await connection.query(`DELETE FROM duplicate_data WHERE SERIAL_NO = ?`, [
      originalRow.SERIAL_NO,
    ]);

    // 3 insert log
    await connection.query(
      `
      INSERT INTO duplicate_fix_log
      (serial_no, reference_no, dup_status, old_data, new_data, fixed_by)
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        originalRow.SERIAL_NO,
        originalRow.REFERENCE,
        originalRow.dup_status,
        JSON.stringify(originalRow),
        JSON.stringify({ head, detail }),
        req.user?.username ?? "system",
      ],
    );

    await connection.commit();

    res.json({
      message: "Fix duplicate success",
    });
  } catch (err) {
    if (connection) await connection.rollback();

    res.status(500).json({
      message: "Fix duplicate error",
      error: err.message,
    });
  } finally {
    if (connection) connection.release();
  }
};
