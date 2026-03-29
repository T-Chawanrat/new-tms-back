// export const getDuplicateData = async (req, res) => {
//   let connection;

//   try {
//     connection = await db.getConnection();

//     const [rows] = await connection.query(`
//       SELECT
//         id,
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
//         type_send,
//         created_at
//       FROM duplicate_data
//       ORDER BY id DESC
//     `);

//     return res.status(200).json({
//       total: rows.length,
//       data: rows,
//     });

//   } catch (err) {

//     console.error(err);

//     return res.status(500).json({
//       message: "ดึงข้อมูล duplicate ไม่สำเร็จ",
//       error: err.message,
//     });

//   } finally {
//     if (connection) connection.release();
//   }
// };