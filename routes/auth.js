const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createAdmin, getAdminByUsername } = require('../config/admin');
const router = express.Router();

const JWT_SECRET = 'sdgsd87g87gsdgsd87g7sdg'; // Replace with a strong key

// Create Admin
router.post('/register', async (req, res) => {
    const { username, password, role } = req.body;

    if (!username || !password || !role) {
        return res.status(400).json({ error: "All fields are required!" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    try {
        await createAdmin(username, passwordHash, role);
        res.status(201).json({ message: "Admin created successfully" });
    } catch (err) {
        res.status(500).json({ error: "Database error" });
    }
});

// Login
router.post('/login/admin', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: "All fields are required!" });
    }

    try {
        const admin = await getAdminByUsername(username);
        if (!admin) {
            return res.status(401).json({ error: "Invalid username or password" });
        }

        const isMatch = await bcrypt.compare(password, admin.PasswordHash);
        if (!isMatch) {
            return res.status(401).json({ error: "Invalid username or password" });
        }

        const token = jwt.sign({ adminId: admin.AdminID, role: admin.Role }, JWT_SECRET, { expiresIn: '1h' });
        res.status(200).json({ token, role: admin.Role });
    } catch (err) {
        res.status(500).json({ error: "Database error" });
    }
});

module.exports = router;
