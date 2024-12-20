const mysql = require('mysql');

// Hàm để tạo kết nối mới
const createConnection = () => {
    const db = mysql.createConnection({
        host: "gamehay.id.vn",
        user: "ndbdxcjw_doanchuyennganh",
        password: "YcuDSH8P5nWaxGuzYebR",
        database: "ndbdxcjw_doanchuyennganh",
        waitForConnections: true,
        connectionLimit: 10,  // Giới hạn số kết nối tối đa trong pool
        queueLimit: 0
    });

    db.connect((err) => {
        if (err) {
            console.error("Lỗi kết nối đến cơ sở dữ liệu:", err);
            setTimeout(() => createConnection(), 2000); // Thử kết nối lại sau 2 giây nếu lỗi
        } else {
            console.log("MySQL đã được kết nối...");
        }
    });

    db.on('error', (err) => {
        console.error("Lỗi MySQL:", err);
        if (err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR') {
            console.log("Kết nối MySQL bị mất hoặc lỗi fatal. Đang tái kết nối...");
            db.destroy(); // Đóng kết nối hiện tại
            db = createConnection(); // Tạo lại kết nối mới
        } else {
            throw err;
        }
    });

    return db;
};

// Tạo kết nối ban đầu
let db = createConnection();

// Hàm thực hiện truy vấn
// Hàm thực hiện truy vấn
const performQuery = (query, params, callback) => {
    if (db.state !== 'connected') {
        console.log("Kết nối MySQL không hợp lệ, tái kết nối...");
        db = createConnection(); // Tạo lại kết nối nếu không hợp lệ
    }

    db.query(query, params, (err, results) => {
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
