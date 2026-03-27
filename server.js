import fs from "fs";
import https from "https";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

import authRoute from "./routes/authRoute.js";
import billRoute from "./routes/billRoute.js";
import billsDataRoute from "./routes/billsDataRoute.js";
import filterRoute from "./routes/filterRoute.js";
import labelRoute from "./routes/labelRoute.js";
import shipmentRoute from "./routes/shipmentRoute.js";
import assignVehicleRoute from "./routes/assignVehicleRoute.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/labels", express.static(path.join(__dirname, "labels")));

app.use("/", authRoute);
app.use("/", billRoute);
app.use("/", billsDataRoute);
app.use("/", filterRoute);
app.use("/", labelRoute);
app.use("/", shipmentRoute);
app.use("/", assignVehicleRoute);

app.get("/testsubdomain", (req, res) => {
  res.send("Backend is working!");
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", service: "tmg-backend" });
});

// const sslOptions = {
//   key: fs.readFileSync(
//     "/home/xsendwork/conf/web/tmg.xsendwork.com/ssl/tmg.xsendwork.com.key"
//   ),
//   cert: fs.readFileSync(
//     "/home/xsendwork/conf/web/tmg.xsendwork.com/ssl/tmg.xsendwork.com.crt"
//   ),
//   ca: fs.readFileSync(
//     "/home/xsendwork/conf/web/tmg.xsendwork.com/ssl/tmg.xsendwork.com.ca"
//   ),
// };

const PORT = process.env.PORT || 8010;
// https.createServer(app).listen(PORT, () => {
//   console.log(`🚀 Server running on https://localhost:${PORT}`);
// });

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
