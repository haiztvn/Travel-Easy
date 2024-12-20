const mysql = require('mysql2');

// Tạo một Connection Pool
const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'doanchuyennghanh',
    waitForConnections: true,
    connectionLimit: 10, // Giới hạn số kết nối tối đa
    queueLimit: 0
});

// Hàm thực hiện truy vấn
const performQuery = (query, params, callback) => {
    pool.execute(query, params, (err, results) => {
        if (err) {
            console.error("Lỗi khi thực hiện truy vấn:", err);
            callback(err, null);
        } else {
            console.log("Kết quả truy vấn:", results);
            callback(null, results);
        }
    });
};

// Xuất các hàm cần thiết
module.exports = {
    performQuery
};
