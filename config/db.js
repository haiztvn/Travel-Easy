const mysql = require('mysql');

// Hàm để tạo kết nối mới
const createConnection = () => {
    const db = mysql.createConnection({
        host: "gamehay.id.vn",
        user: "ndbdxcjw_doanchuyennganh",
        password: "YcuDSH8P5nWaxGuzYebR",
        database: "ndbdxcjw_doanchuyennganh",
    });

    // Xử lý kết nối
    db.connect((err) => {
        if (err) {
            console.error("Lỗi kết nối đến cơ sở dữ liệu:", err);
            setTimeout(createConnection, 2000); // Thử kết nối lại sau 2 giây nếu lỗi
        } else {
            console.log("MySQL đã được kết nối...");
        }
    });

    // Lắng nghe sự kiện lỗi
    db.on('error', (err) => {
        console.error("Lỗi MySQL:", err);
        if (err.code === 'PROTOCOL_CONNECTION_LOST') {
            console.log("Kết nối MySQL bị mất. Đang tái kết nối...");
            createConnection(); // Tạo lại kết nối nếu bị mất
        } else {
            throw err;
        }
    });

    return db;
};

// Tạo kết nối ban đầu
const db = createConnection();

// Xuất kết nối
module.exports = db;
