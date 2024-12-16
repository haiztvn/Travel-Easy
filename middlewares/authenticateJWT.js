// authMiddleware.js
const jwt = require('jsonwebtoken');
const secretKey = (process.env.REACT_APP_TOKEN);

const authenticateJWT = (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1]; // Lấy token từ header

    if (!token) {
        return res.status(403).json({ error: 'Không có token, truy cập bị từ chối' });
    }

    jwt.verify(token, secretKey, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Token không hợp lệ' });
        }

        req.user = user; // Lưu thông tin user vào request object
        next(); // Tiến hành xử lý API
    });
};

module.exports = authenticateJWT;
