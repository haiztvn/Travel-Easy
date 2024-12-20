const mysql = require('mysql2');

// Tạo một Connection Pool
const pool = mysql.createPool({
    host: "gamehay.id.vn",
    user: "ndbdxcjw_doanchuyennganh",
    password: "YcuDSH8P5nWaxGuzYebR",
    database: "ndbdxcjw_doanchuyennganh",
    waitForConnections: true,
    connectionLimit: 10,  // Giới hạn số kết nối tối đa trong pool
    queueLimit: 0
});

// Hàm thực hiện truy vấn
const performQuery = (query, params, callback) => {
    pool.execute(query, params, (err, results) => {
        if (err) {
            callback(err, null);
        } else {
            callback(null, results);
        }
    });
};

// Xuất các hàm cần thiết
module.exports = {
    performQuery
};
