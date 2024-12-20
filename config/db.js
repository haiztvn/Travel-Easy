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
const performQuery = (query, params) => {
    console.log("Đang lấy kết nối từ pool...");

    // Lấy kết nối từ pool một lần duy nhất
    pool.getConnection((err, connection) => {
        if (err) {
            console.error("Lỗi khi kết nối tới cơ sở dữ liệu:", err);
         
            return;
        }

        console.log("Kết nối thành công từ pool!");

        // Thực hiện truy vấn
        connection.query(query, params, (err, results) => {
            connection.release();  // Giải phóng kết nối sau khi thực hiện truy vấn

            if (err) {
                console.error("Lỗi khi thực hiện truy vấn:", err);
                
            } else {
                console.log("Kết quả truy vấn:", results);
                
            }
        });
    });
};


// Xuất các hàm cần thiết
module.exports = {
    performQuery
};
