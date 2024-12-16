const express = require('express');
const app = express.Router();
const db = require('../config/db');


// Lấy danh sách đơn hàng kèm thông tin khách hàng
app.get('/all/orders', (req, res) => {
    const query = `
        SELECT 
            donhang.DonHangID,
            donhang.NgayDatHang,
            donhang.TrangThai,
            khachhang.TenKH,
            khachhang.SDT,
            khachhang.Email
        FROM donhang
        JOIN khachhang ON donhang.KhachHangID = khachhang.IdKH
    `;
    db.query(query, (err, results) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(results);
    });
});

// Cập nhật trạng thái đơn hàng
app.put('/all/orders/:id', (req, res) => {
    const { id } = req.params;
    const { TrangThai } = req.body; // Trạng thái mới

    const query = 'UPDATE donhang SET TrangThai = ? WHERE DonHangID = ?';
    db.query(query, [TrangThai, id], (err, result) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ message: 'Trạng thái đơn hàng đã được cập nhật' });
    });
});
module.exports = app;
