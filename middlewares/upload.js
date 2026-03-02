
import multer from "multer";
import path from "path";
import fs from "fs";

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = "uploads";
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    if (file.fieldname === "signature") {
      cb(null, "signature_" + Date.now() + path.extname(file.originalname));
    } else {
      cb(null, "image_" + Date.now() + path.extname(file.originalname));
    }
  },
});

export const upload = multer({
  storage,
  limits: { files: 9 }
});


