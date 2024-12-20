const mysql = require('mysql');

// Tạo pool kết nối
const pool = mysql.createPool({
    host: "gamehay.id.vn",
    user: "ndbdxcjw_doanchuyennganh",
    password: "YcuDSH8P5nWaxGuzYebR",
    database: "ndbdxcjw_doanchuyennganh",
    connectionLimit: 50, // Giới hạn số kết nối tối đa
    waitForConnections: true, // Chờ kết nối nếu tất cả kết nối đang bận
    queueLimit: 0 // Không giới hạn hàng đợi
});

// Hàm thực hiện truy vấn
const performQuery = (query, params) => {
    return new Promise((resolve, reject) => {
        pool.getConnection((err, connection) => {
            if (err) {
                console.error("Lỗi khi lấy kết nối từ pool:", err);
                reject(err);
                return;
            }

            connection.query(query, params, (queryErr, results) => {
                connection.release(); // Giải phóng kết nối trở lại pool

                if (queryErr) {
                    console.error("Lỗi khi thực hiện truy vấn:", queryErr);
                    reject(queryErr);
                } else {
                    resolve(results);
                }
            });
        });
    });
};

// Ví dụ sử dụng
performQuery('SELECT * FROM users')
    .then(results => console.log("Kết quả truy vấn:", results))
    .catch(err => console.error("Lỗi truy vấn:", err));

module.exports = { performQuery };
