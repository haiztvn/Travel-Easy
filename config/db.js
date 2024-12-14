const mysql = require('mysql'); // Sử dụng phiên bản promise

const db = mysql.createConnection({
    host: "gamehay.id.vn",//s103d190-u2.interdata.vn
    user: "ndbdxcjw_doanchuyennganh",
    password: "YcuDSH8P5nWaxGuzYebR", // Thay bằng biến môi trường
    database: "ndbdxcjw_doanchuyennganh",
});
// Kết nối tới MySQL
db.connect((err) => {
    if (err) {
        console.error("Lỗi kết nối đến cơ sở dữ liệu:", err);
        return;
    }
    console.log("MySQL đã được kết nối...");
});
module.exports = db;
