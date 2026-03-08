import db from "../config/db.js";
import { getPaginationParams } from "../utils/pagination.js";

const excelDateToMySQL = (input) => {
  if (input === null || input === undefined || input === "") return null;
  if (typeof input === "string" && input.includes("-")) return input;
  const serial =
    typeof input === "number" ? input : parseFloat(String(input).trim());
  if (!serial || isNaN(serial)) return null;
  const jsDate = new Date((serial - 25569) * 86400 * 1000);
  const iso = jsDate.toISOString().split("T")[0];
  return iso;
};

export const getBillsReport = async (req, res) => {
  let connection;

  try {
    connection = await db.getConnection();

    const { SERIAL_NO, REFERENCE, warehouse_id } = req.query;

    const { page, pageSize, skip } = getPaginationParams(req, 100);

    let baseSql = `
      FROM bills_data bd
      LEFT JOIN bills b 
        ON b.REFERENCE = bd.REFERENCE
      LEFT JOIN bill_images bi 
        ON bi.bill_id = b.id
      WHERE 1=1
    `;

    const params = [];

    if (SERIAL_NO?.trim()) {
      baseSql += ` AND bd.SERIAL_NO LIKE ?`;
      params.push(`%${SERIAL_NO.trim()}%`);
    }

    if (REFERENCE?.trim()) {
      baseSql += ` AND bd.REFERENCE LIKE ?`;
      params.push(`%${REFERENCE.trim()}%`);
    }

    if (warehouse_id) {
      baseSql += ` AND bd.warehouse_id = ?`;
      params.push(Number(warehouse_id));
    }

    const countSql = `
  SELECT COUNT(*) AS total
  FROM (
    SELECT bd.id AS bd_id, b.id AS bill_id
    ${baseSql}
    GROUP BY bd.id, b.id
  ) x
`;

    const [[countRow]] = await connection.query(countSql, params);
    const total = countRow?.total || 0;

    const dataSql = `
      SELECT
        bd.*,
        b.id AS bill_id,
        b.user_id AS bill_user_id,
        b.name AS bill_name,
        b.surname AS bill_surname,
        b.license_plate AS bill_license_plate,
        b.dc_id AS bill_dc_id,
        b.sign AS bill_sign,
        b.remark AS bill_remark,
        b.created_at AS bill_created_at,
        GROUP_CONCAT(bi.image_url ORDER BY bi.id) AS bill_image_urls
      ${baseSql}
      GROUP BY bd.id, b.id
      ORDER BY bd.id DESC
      LIMIT ? OFFSET ?
    `;

    const dataParams = [...params, pageSize, skip];
    const [rows] = await connection.query(dataSql, dataParams);

    const data = rows.map((row) => ({
      ...row,
      bill_image_urls: row.bill_image_urls
        ? row.bill_image_urls.split(",")
        : [],
    }));

    res.status(200).json({
      success: true,
      data,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (err) {
    console.error("Error getBillsReport:", err);
    res.status(500).json({
      success: false,
      message: "ไม่สามารถดึงข้อมูล report bills ได้",
      error: err.message,
    });
  } finally {
    if (connection) connection.release();
  }
};

export const getBillsDataBySerial = async (req, res) => {
  let connection;
  try {
    const serial = (req.query.serial || "").toString().trim();

    if (!serial) {
      return res.status(400).json({
        success: false,
        message: "กรุณาระบุ SERIAL_NO",
      });
    }

    connection = await db.getConnection();

    const [[row]] = await connection.query(
      `
      SELECT REFERENCE
      FROM bills_data
      WHERE SERIAL_NO = ?
      LIMIT 1
      `,
      [serial],
    );

    if (!row) {
      return res.status(404).json({
        success: false,
        message: "ไม่พบ SERIAL_NO นี้",
      });
    }

    const reference = row.REFERENCE;

    const [rows] = await connection.query(
      `
      SELECT id, SERIAL_NO, REFERENCE, warehouse_accept, dc_accept
      FROM bills_data
      WHERE REFERENCE = ?
      ORDER BY id ASC
      `,
      [reference],
    );

    return res.json({
      success: true,
      reference,
      rows,
      count: rows.length,
    });
  } catch (err) {
    console.error("getBillsDataBySerial ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "backend error",
      error: err.message,
    });
  } finally {
    if (connection) connection.release();
  }
};

export const importBillsData = async (req, res) => {
  let connection;

  try {
    const { rows, user_id, type } = req.body;

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({
        message: "ไม่มีข้อมูลสำหรับนำเข้า",
      });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    const [warehouseRows] = await connection.query(
      "SELECT warehouse_id, warehouse_name, zip_code FROM master_warehouses",
    );

    const warehouseMap = {};
    warehouseRows.forEach((w) => {
      warehouseMap[w.zip_code] = {
        warehouse_id: w.warehouse_id,
        warehouse_name: w.warehouse_name,
      };
    });

    const insertValues = rows.map((r) => {
      const w = warehouseMap[r.RECIPIENT_ZIPCODE] || {};

      return [
        r.NO_BILL || null,
        r.REFERENCE || null,
        excelDateToMySQL(r.SEND_DATE) || null,
        r.CUSTOMER_NAME || null,
        r.RECIPIENT_CODE || null,
        r.RECIPIENT_NAME || null,
        r.RECIPIENT_TEL || null,
        r.RECIPIENT_ADDRESS || null,
        r.RECIPIENT_SUBDISTRICT || null,
        r.RECIPIENT_DISTRICT || null,
        r.RECIPIENT_PROVINCE || null,
        r.RECIPIENT_ZIPCODE || null,
        r.SERIAL_NO || null,
        r.PRICE || null,
        user_id || null,
        w.warehouse_name || null,
        w.warehouse_id || null,
        type || "IMPORT",
      ];
    });

    await connection.query(
      `
      INSERT INTO bills_data 
      (
        NO_BILL, REFERENCE, SEND_DATE, CUSTOMER_NAME, RECIPIENT_CODE,
        RECIPIENT_NAME, RECIPIENT_TEL, RECIPIENT_ADDRESS,
        RECIPIENT_SUBDISTRICT, RECIPIENT_DISTRICT, RECIPIENT_PROVINCE,
        RECIPIENT_ZIPCODE, SERIAL_NO, PRICE, user_id,
        warehouse_name, warehouse_id,
        type
      )
      VALUES ?
      `,
      [insertValues],
    );

    await connection.commit();

    res.status(200).json({
      success: true,
      message: `นำเข้าข้อมูลสำเร็จ จำนวน ${rows.length} แถว`,
    });
  } catch (err) {
    if (connection) await connection.rollback();
    console.error("Error while importing bills_data:", err);

    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดระหว่างนำเข้าข้อมูล",
      error: err.message,
    });
  } finally {
    if (connection) connection.release();
  }
};

export const importBillsADV = async (req, res) => {
  let connection;

  try {
    const { rows, user_id, type } = req.body;

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({
        message: "ไม่มีข้อมูลสำหรับนำเข้า",
      });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    const [warehouseRows] = await connection.query(
      "SELECT warehouse_id, warehouse_name, zip_code FROM master_warehouses",
    );

    const warehouseMap = {};
    warehouseRows.forEach((w) => {
      warehouseMap[w.zip_code] = {
        warehouse_id: w.warehouse_id,
        warehouse_name: w.warehouse_name,
      };
    });

    const insertValues = rows.map((r) => {
      const w = warehouseMap[r.RECIPIENT_ZIPCODE] || {};

      return [
        r.NO_BILL || null,
        r.REFERENCE || null,
        excelDateToMySQL(r.SEND_DATE) || null,
        r.CUSTOMER_NAME || null,
        r.RECIPIENT_CODE || null,
        r.RECIPIENT_NAME || null,
        r.RECIPIENT_TEL || null,
        r.RECIPIENT_ADDRESS || null,
        r.RECIPIENT_SUBDISTRICT || null,
        r.RECIPIENT_DISTRICT || null,
        r.RECIPIENT_PROVINCE || null,
        r.RECIPIENT_ZIPCODE || null,
        r.SERIAL_NO || null,
        r.PRICE || null,
        user_id || null,
        w.warehouse_name || null,
        w.warehouse_id || null,
        type || "IMPORT",
      ];
    });

    await connection.query(
      `
      INSERT INTO bills_data 
      (
        NO_BILL, REFERENCE, SEND_DATE, CUSTOMER_NAME, RECIPIENT_CODE,
        RECIPIENT_NAME, RECIPIENT_TEL, RECIPIENT_ADDRESS,
        RECIPIENT_SUBDISTRICT, RECIPIENT_DISTRICT, RECIPIENT_PROVINCE,
        RECIPIENT_ZIPCODE, SERIAL_NO, PRICE, user_id,
        warehouse_name, warehouse_id,
        type
      )
      VALUES ?
      `,
      [insertValues],
    );

    await connection.commit();

    res.status(200).json({
      success: true,
      message: `นำเข้าข้อมูลสำเร็จ จำนวน ${rows.length} แถว`,
    });
  } catch (err) {
    if (connection) await connection.rollback();
    console.error("Error while importing bills_data:", err);

    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดระหว่างนำเข้าข้อมูล",
      error: err.message,
    });
  } finally {
    if (connection) connection.release();
  }
};

export const importBillsVGT = async (req, res) => {
  let connection;

  try {
    const { rows, user_id, type } = req.body;

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "ไม่มีข้อมูลสำหรับนำเข้า",
      });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    const [warehouseRows] = await connection.query(
      "SELECT warehouse_id, warehouse_name, dc_code FROM mm_warehouses",
    );

    const warehouseMapByCode = {};
    warehouseRows.forEach((w) => {
      if (!w.dc_code) return;
      warehouseMapByCode[String(w.dc_code).trim()] = {
        warehouse_id: w.warehouse_id,
        warehouse_name: w.warehouse_name,
      };
    });

    const parseDcCode = (toDcRaw) => {
      if (!toDcRaw) return "";
      const s = String(toDcRaw).trim();

      const firstToken = s.split(/\s+/)[0];
      return firstToken;
    };

    const insertValues = rows.map((r) => {
      const dcCode = parseDcCode(r.TO_DC);
      const w = warehouseMapByCode[dcCode] || {};

      return [
        r.NO_BILL || null,
        r.REFERENCE || null,
        excelDateToMySQL(r.SEND_DATE) || null,
        r.CUSTOMER_NAME || null,
        r.RECIPIENT_CODE || null,
        r.RECIPIENT_NAME || null,
        r.RECIPIENT_TEL || null,
        r.RECIPIENT_ADDRESS || null,
        r.RECIPIENT_SUBDISTRICT || null,
        r.RECIPIENT_DISTRICT || null,
        r.RECIPIENT_PROVINCE || null,
        r.RECIPIENT_ZIPCODE || null,
        r.SERIAL_NO || null,
        r.PRICE || null,
        user_id || null,
        w.warehouse_name || null,
        w.warehouse_id || null,
        type || "IMPORT",
      ];
    });

    await connection.query(
      `
      INSERT INTO bills_data 
      (
        NO_BILL, REFERENCE, SEND_DATE, CUSTOMER_NAME, RECIPIENT_CODE,
        RECIPIENT_NAME, RECIPIENT_TEL, RECIPIENT_ADDRESS,
        RECIPIENT_SUBDISTRICT, RECIPIENT_DISTRICT, RECIPIENT_PROVINCE,
        RECIPIENT_ZIPCODE, SERIAL_NO, PRICE, user_id,
        warehouse_name, warehouse_id,
        type
      )
      VALUES ?
      `,
      [insertValues],
    );

    await connection.commit();

    res.status(200).json({
      success: true,
      message: `นำเข้าข้อมูล VGT สำเร็จ จำนวน ${rows.length} แถว`,
    });
  } catch (err) {
    if (connection) await connection.rollback();
    console.error("Error while importing bills_data VGT:", err);

    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดระหว่างนำเข้าข้อมูล VGT",
      error: err.message,
    });
  } finally {
    if (connection) connection.release();
  }
};

export const getBillsWarehouse = async (req, res) => {
  let connection;

  try {
    const { warehouse_accept = "N" } = req.query;

    connection = await db.getConnection();

    const [rows] = await connection.query(
      `
      SELECT
        id,
        NO_BILL,
        SERIAL_NO,
        CUSTOMER_NAME,
        warehouse_name
      FROM bills_data
      WHERE warehouse_accept = ?
      ORDER BY id ASC
      `,
      [warehouse_accept],
    );

    res.status(200).json({
      success: true,
      data: rows,
    });
  } catch (err) {
    console.error("Error getBillsWarehouse:", err);
    res.status(500).json({
      success: false,
      message: "ไม่สามารถดึงข้อมูล bills_data สำหรับ Warehouse ได้",
      error: err.message,
    });
  } finally {
    if (connection) connection.release();
  }
};

export const updateBillsWarehouseAccept = async (req, res) => {
  let connection;

  try {
    const { serials, accept_flag = "Y" } = req.body;

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
      SET warehouse_accept = ?
      WHERE SERIAL_NO IN (?)
      `,
      [accept_flag, serials],
    );

    await connection.commit();

    res.status(200).json({
      success: true,
      message: `อัปเดตสถานะ warehouse_accept = '${accept_flag}' ให้ ${serials.length} รายการเรียบร้อย`,
    });
  } catch (err) {
    if (connection) await connection.rollback();
    console.error("Error updateBillsWarehouseAccept:", err);
    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการอัปเดต warehouse_accept",
      error: err.message,
    });
  } finally {
    if (connection) connection.release();
  }
};

export const getBillsDC = async (req, res) => {
  let connection;

  try {
    const { warehouse_accept = "Y", dc_accept = "N" } = req.query;

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
        b.NO_BILL,
        b.SERIAL_NO,
        b.CUSTOMER_NAME,
        b.warehouse_name
      FROM bills_data b
      JOIN mm_user_dc d
        ON d.warehouse_id = b.warehouse_id   
      JOIN um_users u
        ON u.dc_id = d.id                    
      WHERE u.user_id = ?   
        AND u.role_id = 4
        AND b.dc_accept = ?
        AND b.warehouse_accept = ?
      ORDER BY b.id ASC
      `,
      [currentUserId, dc_accept, warehouse_accept],
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

export const updateBillsDCAccept = async (req, res) => {
  let connection;

  try {
    const { serials, accept_flag = "Y" } = req.body;

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
      SET dc_accept = ?
      WHERE SERIAL_NO IN (?)
      `,
      [accept_flag, serials],
    );

    await connection.commit();

    res.status(200).json({
      success: true,
      message: `อัปเดตสถานะ dc_accept = '${accept_flag}' ให้ ${serials.length} รายการเรียบร้อย`,
    });
  } catch (err) {
    if (connection) await connection.rollback();
    console.error("Error updateBillsDCAccept:", err);
    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการอัปเดต dc_accept",
      error: err.message,
    });
  } finally {
    if (connection) connection.release();
  }
};

// const insertDuplicateFromBody = async (
//   connection,
//   head,
//   detail,
//   sendId,
//   status,
// ) => {
//   const values = [];

//   for (const d of detail) {
//     if (!Array.isArray(d.serialNo)) continue;

//     for (const sn of d.serialNo) {
//       values.push([
//         head.referenceNo ?? null,
//         sn ?? null,
//         head.reference ?? null,

//         head.recipientCode ?? null,
//         head.recipientName ?? null,
//         head.tel1 ?? null,
//         head.address ?? null,
//         head.subdistrict ?? null,
//         head.district ?? null,
//         head.province ?? null,
//         head.zipCode ?? null,

//         status,

//         head.deliveryStatus ?? null,
//         head.shipperId ?? null,
//         head.recipientType ?? null,
//         head.tel1Ext ?? null,
//         head.tel2 ?? null,
//         head.tel2Ext ?? null,
//         head.lineId ?? null,
//         head.documentReturnId ?? null,
//         head.documentReturnDescription ?? null,
//         head.paymentId ?? null,
//         head.qtyOfDetail ?? null,
//         head.isPickupCustomer ?? null,

//         sendId ?? null,

//         d.packageId ?? null,
//         d.packageDetailId ?? null,
//         d.qtyOfSerial ?? null,
//         d.height ?? null,
//         d.width ?? null,
//         d.length ?? null,
//         d.weight ?? null,
//         d.size_type ?? null,
//         d.q ?? null,
//         d.type_send ?? null,
//       ]);
//     }
//   }

//   if (values.length > 0) {
//     await connection.query(
//       `
//       INSERT INTO duplicate_data (
//         NO_BILL,
//         SERIAL_NO,
//         REFERENCE,

//         RECIPIENT_CODE,
//         RECIPIENT_NAME,
//         RECIPIENT_TEL,
//         RECIPIENT_ADDRESS,
//         RECIPIENT_SUBDISTRICT,
//         RECIPIENT_DISTRICT,
//         RECIPIENT_PROVINCE,
//         RECIPIENT_ZIPCODE,

//         dup_status,

//         delivery_status,
//         shipper_id,
//         recipient_type,
//         tel1_ext,
//         tel2,
//         tel2_ext,
//         line_id,
//         document_return_id,
//         document_return_description,
//         payment_id,
//         qty_of_detail,
//         is_pickup_customer,

//         send_id,

//         package_id,
//         package_detail_id,
//         qty_of_serial,
//         height,
//         width,
//         length,
//         weight,
//         size_type,
//         q,
//         type_send
//       )
//       VALUES ?
//       `,
//       [values],
//     );
//   }
// };

// export const createBillAdv = async (req, res) => {
//   let connection;

//   try {
//     connection = await db.getConnection();
//     await connection.beginTransaction();

//     const { head, detail, sendId } = req.body;

//     if (!head || !Array.isArray(detail)) {
//       await connection.rollback();
//       return res.status(400).json({
//         message: "รูปแบบข้อมูลไม่ถูกต้อง",
//       });
//     }

//     // =========================
//     // 1️⃣ ดึง packageId
//     // =========================
//     const packageIds = [
//       ...new Set(detail.map((d) => d.packageId).filter(Boolean)),
//     ];

//     if (packageIds.length === 0) {
//       await connection.rollback();
//       return res.status(400).json({
//         message: "ไม่พบ packageId",
//       });
//     }

//     // =========================
//     // 2️⃣ Query quotation_adv
//     // =========================
//     const [packages] = await connection.query(
//       `
//       SELECT 
//         package_id,
//         package_name,
//         group_id,
//         group_bill AS group_name,
//         package_price
//       FROM quotation_adv
//       WHERE package_id IN (?)
//       `,
//       [packageIds],
//     );

//     if (packages.length !== packageIds.length) {
//       await connection.rollback();
//       return res.status(400).json({
//         message: "มี packageId บางรายการไม่พบใน quotation_adv",
//       });
//     }

//     const packageMap = {};
//     for (const p of packages) {
//       packageMap[p.package_id] = p;
//     }

//     // =========================
//     // 3️⃣ หา warehouse
//     // =========================
//     const [warehouses] = await connection.query(
//       `
//       SELECT tambon_id, warehouse_id, warehouse_name
//       FROM master_warehouses
//       WHERE tambon_name_th = ?
//       AND ampur_name_th = ?
//       AND province_name_th = ?
//       LIMIT 1
//       `,
//       [head.subdistrict ?? null, head.district ?? null, head.province ?? null],
//     );

//     if (warehouses.length === 0) {
//       await insertDuplicateFromBody(
//         connection,
//         head,
//         detail,
//         sendId,
//         "INVALID_ADDRESS",
//       );

//       await connection.commit();

//       return res.status(400).json({
//         message: "ที่อยู่ผิด",
//       });
//     }

//     const warehouse = warehouses[0];

//     // =========================
//     // 4️⃣ Generate REFERENCE
//     // =========================
//     const now = new Date();
//     const year2 = now.getFullYear().toString().slice(-2);
//     const month = String(now.getMonth() + 1).padStart(2, "0");
//     const day = String(now.getDate()).padStart(2, "0");
//     const datePart = `${year2}${month}${day}`;

//     const [countResult] = await connection.query(
//       `
//       SELECT COUNT(*) as total
//       FROM bills_data
//       WHERE REFERENCE LIKE ?
//       `,
//       [`ADV0001-${datePart}-%`],
//     );

//     const running = String((countResult[0].total || 0) + 1).padStart(6, "0");
//     const generatedReference = `ADV0001-${datePart}-${running}`;

//     const insertValues = [];

//     // =========================
//     // 5️⃣ Build insertValues
//     // =========================
//     for (const d of detail) {
//       if (!Array.isArray(d.serialNo)) continue;

//       const pkg = packageMap[d.packageId] || {};

//       for (const serial of d.serialNo) {
//         insertValues.push([
//           head.referenceNo ?? null,
//           serial ?? null,
//           generatedReference,
//           null,
//           null,
//           null,
//           head.recipientCode ?? null,
//           head.recipientName ?? null,
//           head.tel1 ?? null,
//           head.address ?? null,
//           head.subdistrict ?? null,
//           head.district ?? null,
//           head.province ?? null,
//           head.zipCode ?? null,
//           warehouse.tambon_id ?? null,
//           pkg.package_price ?? null,
//           warehouse.warehouse_id ?? null,
//           warehouse.warehouse_name ?? null,
//           null,
//           "API",
//           1,
//           "รับเข้าระบบ",
//           pkg.group_id ?? null,
//           pkg.group_name ?? null,

//           head.deliveryStatus ?? null,
//           head.shipperId ?? null,
//           head.recipientType ?? null,
//           head.tel1Ext ?? null,
//           head.tel2 ?? null,
//           head.tel2Ext ?? null,
//           head.lineId ?? null,
//           head.cod ?? 0,
//           head.documentReturnId ?? null,
//           head.documentReturnDescription ?? null,
//           head.paymentId ?? null,
//           head.qtyOfDetail ?? null,
//           head.isPickupCustomer ?? null,
//           sendId ?? null,

//           d.packageId ?? null,
//           pkg.package_name ?? null,
//           d.packageDetailId ?? null,
//           d.qtyOfSerial ?? null,
//           d.costDifference ?? 0,
//           d.height ?? null,
//           d.width ?? null,
//           d.length ?? null,
//           d.weight ?? null,
//           d.size_type ?? null,
//           d.q ?? null,
//           d.type_send ?? null,
//         ]);
//       }
//     }

//     if (insertValues.length === 0) {
//       await connection.rollback();
//       return res.status(400).json({
//         message: "ไม่พบ serial สำหรับบันทึก",
//       });
//     }

//     // =========================
//     // 6️⃣ ตรวจ SERIAL ซ้ำ
//     // =========================
//     const allSerials = insertValues.map((v) => v[1]).filter(Boolean);

//     if (allSerials.length > 0) {
//       const [existingRows] = await connection.query(
//         `
//         SELECT SERIAL_NO
//         FROM bills_data
//         WHERE SERIAL_NO IN (?)
//         `,
//         [allSerials],
//       );

//       if (existingRows.length > 0) {
//         const duplicateSerials = existingRows.map((r) => r.SERIAL_NO);

//         await insertDuplicateFromBody(
//           connection,
//           head,
//           detail,
//           sendId,
//           "DUP_SN",
//         );

//         await connection.commit();

//         return res.status(400).json({
//           message: "พบ SERIAL ซ้ำ",
//           duplicates: duplicateSerials,
//         });
//       }
//     }

//     // =========================
//     // 7️⃣ Insert ปกติ
//     // =========================
//     await connection.query(
//       `
//       INSERT INTO bills_data (
//         NO_BILL, SERIAL_NO, REFERENCE, SEND_DATE, customer_id, CUSTOMER_NAME,
//         RECIPIENT_CODE, RECIPIENT_NAME, RECIPIENT_TEL, RECIPIENT_ADDRESS,
//         RECIPIENT_SUBDISTRICT, RECIPIENT_DISTRICT, RECIPIENT_PROVINCE,
//         RECIPIENT_ZIPCODE, sub_district_id, PRICE, warehouse_id, warehouse_name,
//         user_id, type, status_id, status_name, group_id, group_name,
//         delivery_status, shipper_id, recipient_type, tel1_ext,
//         tel2, tel2_ext, line_id, cod, document_return_id,
//         document_return_description, payment_id, qty_of_detail,
//         is_pickup_customer, send_id,
//         package_id, package_name, package_detail_id, qty_of_serial,
//         cost_difference, height, width, length, weight, size_type, q, type_send
//       ) VALUES ?
//       `,
//       [insertValues],
//     );

//     await connection.commit();

//     return res.status(201).json({
//       message: "บันทึกข้อมูลสำเร็จ",
//       rowsInserted: insertValues.length,
//     });
//   } catch (err) {
//     if (connection) await connection.rollback();

//     console.error("BACKEND ERROR:", err);

//     return res.status(500).json({
//       message: "เกิดข้อผิดพลาดในการบันทึก",
//       error: err.message,
//     });
//   } finally {
//     if (connection) connection.release();
//   }
// };
