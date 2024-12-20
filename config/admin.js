const { performQuery } = require('./db'); 
const createAdmin = (username, passwordHash, role) => {
    return new Promise((resolve, reject) => {
        performQuery(
            "INSERT INTO admin (Username, PasswordHash, Role) VALUES (?, ?, ?)",
            [username, passwordHash, role],
            (err, result) => {
                if (err) reject(err);
                resolve(result);
            }
        );
    });
};

const getAdminByUsername = (username) => {
    return new Promise((resolve, reject) => {
        db.query(
            "SELECT * FROM admin WHERE Username = ?",
            [username],
            (err, rows) => {
                if (err) reject(err);
                resolve(rows[0]);
            }
        );
    });
};

module.exports = { createAdmin, getAdminByUsername };
