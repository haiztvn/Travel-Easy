const mysql = require('mysql');

// Tạo pool kết nối
const pool = mysql.createPool({
    host: "gamehay.id.vn",
    user: "ndbdxcjw_doanchuyennganh",
    password: "YcuDSH8P5nWaxGuzYebR",
    database: "ndbdxcjw_doanchuyennganh",
    connectionLimit: 10,  // Giới hạn số kết nối tối đa trong pool
    waitForConnections: true, // Cho phép chờ kết nối
    queueLimit: 0 // Không giới hạn hàng đợi
});

// Hàm thực hiện truy vấn
const performQuery = (query, params, callback) => {
    pool.getConnection((err, connection) => {
        if (err) {
            console.error("Lỗi khi kết nối tới cơ sở dữ liệu:", err);
            callback(err, null);
            return;
        }

        // Thực hiện truy vấn
        connection.query(query, params, (err, results) => {
            // Giải phóng kết nối sau khi hoàn thành truy vấn
            connection.release();  // Đảm bảo giải phóng kết nối về pool

            if (err) {
                console.error("Lỗi khi thực hiện truy vấn:", err);
                callback(err, null);
            } else {
                console.log("Kết quả truy vấn:", results);
                callback(null, results);
            }
        });
    });
};

// Xuất các hàm cần thiết
module.exports = {
    performQuery
};
