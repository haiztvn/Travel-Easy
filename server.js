const express = require("express");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const multer = require("multer");
const multerS3 = require("multer-s3");
const db = require('./config/db');
const cron = require('node-cron');
const bodyParser = require("body-parser");
const jwt = require('jsonwebtoken');
const bcrypt = require("bcryptjs");
const cors = require("cors"); // Import middleware CORS
require('dotenv').config();
const authRoutes = require('./routes/auth');
const cartRoutes = require('./routes/orders');

const crypto = require('crypto');

const { OAuth2Client } = require("google-auth-library");
const client = new OAuth2Client(process.env.REACT_APP_GOOGLE_CLIENT_ID);
const secretKey = (process.env.REACT_APP_TOKEN);

// const authenticateJWT = require('./middlewares/authenticateJWT'); // Import middleware
const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(bodyParser.json());
// app.use(authenticateJWT); // Sử dụng middleware cho toàn bộ ứng dụng
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


// Sử dụng middleware CORS// Cấu hình CORS để cho phép yêu cầu từ một nguồn khác
app.use(cors());

app.use('/auth', authRoutes);
app.use('/orders', cartRoutes);

// Cron job chạy mỗi phút
// cron.schedule('* * * * *', () => {
//   const currentDate = new Date();

//   // Truy vấn SQL để cập nhật tất cả các tour đã hết hạn (TourTime nhỏ hơn hiện tại)
//   const query = `UPDATE tourdl SET TrangThai = 'off' WHERE TrangThai = 'on' AND TourTime < ? AND TourTime > 0`;

//   db.query(query, [currentDate], (err, result) => {
//     if (err) {
//       console.error('Lỗi khi cập nhật trạng thái tour:', err);
//     } else {
//       if (result.affectedRows > 0) {
//         console.log(`Đã cập nhật ${result.affectedRows} tour sang trạng thái "off"`);
//       } else {
//         console.log('Không có tour nào cần cập nhật.');
//       }
//     }
//   });
// });
// Route kiểm tra các tour còn trạng thái "on"
app.get("/api/tourdl", (req, res) => {
  const queryTour = "SELECT * FROM tourdl WHERE TrangThai = 'on'";

  db.query(queryTour, (err, tours) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }

    const enhancedTours = tours.map((tour) => {
      return new Promise((resolve, reject) => {
        const queries = {};

        // Tính toán ngày kết thúc dựa trên TourTime và TourDay
        let endDate = null;
        if (tour.TourTime && tour.TourDay) {
          const startDate = new Date(tour.TourTime);  // Chuyển TourTime thành đối tượng Date
          startDate.setDate(startDate.getDate() + tour.TourDay);  // Cộng số ngày tour vào ngày bắt đầu
          endDate = startDate.toISOString().split('T')[0];  // Chuyển ngày kết thúc về định dạng 'yyyy-mm-dd'
        }

        if (tour.TouTL) {
          queries.theloai = `SELECT TenTL FROM theloaidl WHERE IdTL = ${tour.TouTL}`;
        }

        if (tour.TouQG) {
          queries.quocgia = `SELECT TenQG FROM quocgia WHERE IdQG = ${tour.TouQG}`;
          queries.khuvuc = `
            SELECT TenKV 
            FROM khuvuc 
            WHERE IdKV = (
              SELECT KhuVucId 
              FROM quocgia 
              WHERE IdQG = ${tour.TouQG}
            )
          `;
        }

        // Kiểm tra và thực thi các truy vấn
        Promise.all([
          queries.theloai
            ? new Promise((res, rej) =>
              db.query(queries.theloai, (err, result) =>
                err ? rej(err) : res(result[0]?.TenTL || null)
              )
            )
            : Promise.resolve(null),
          queries.quocgia
            ? new Promise((res, rej) =>
              db.query(queries.quocgia, (err, result) =>
                err ? rej(err) : res(result[0]?.TenQG || null)
              )
            )
            : Promise.resolve(null),
          queries.khuvuc
            ? new Promise((res, rej) =>
              db.query(queries.khuvuc, (err, result) =>
                err ? rej(err) : res(result[0]?.TenKV || null)
              )
            )
            : Promise.resolve(null),
        ])
          .then(([TenTheLoai, TenQuocGia, TenKhuVuc]) => {
            resolve({
              ...tour,
              TenTheLoai,
              TenQuocGia,
              TenKhuVuc,
              EndDate: endDate,  // Thêm ngày kết thúc vào kết quả trả về
            });
          })
          .catch((err) => reject(err));
      });
    });

    Promise.all(enhancedTours)
      .then((result) => res.json(result))
      .catch((err) => res.status(500).json({ error: err.message }));
  });
});

// Route thêm tour mới
app.post('/api/tourdl', (req, res) => {
  const {
    TourName, TourImage, TourPrice, SoLuongVe, TourTime, TourDay,
    TourDetail, TourIntroduce, TourVideo, TouKV, TouQG, TouTL
  } = req.body;

  // Tạo danh sách các trường bắt buộc và giá trị tương ứng
  const requiredFields = {
    TourName: 'Tên Tour',
    TourImage: 'Hình ảnh Tour',
    TourPrice: 'Giá Tour',
    SoLuongVe: 'Số lượng vé',
    TourTime: 'Thời gian Tour',
    TourDay: 'Số ngày Tour',
  };

  // Kiểm tra các trường nào còn thiếu
  const missingFields = Object.entries(requiredFields)
    .filter(([key]) => !req.body[key])
    .map(([, value]) => value); // Lấy tên trường tiếng Việt

  // Nếu có trường còn thiếu, trả về thông báo lỗi
  if (missingFields.length > 0) {
    return res.status(400).json({
      error: `Vui lòng nhập đầy đủ thông tin: ${missingFields.join(', ')}`,
    });
  }

  // Thực hiện thêm dữ liệu vào cơ sở dữ liệu
  const insertTourQuery = `
    INSERT INTO tourdl (TourName, TourImage, TourPrice, SoLuongVe, TourTime, TourDay, TourDetail, TourIntroduce, TourVideo, TouKV, TouQG, TouTL)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  db.query(insertTourQuery, [
    TourName, TourImage, TourPrice, SoLuongVe, TourTime, TourDay,
    TourDetail, TourIntroduce, TourVideo, TouKV, TouQG, TouTL
  ], (err, result) => {
    if (err) {
      console.error('Lỗi khi thêm tour:', err);
      return res.status(500).json({ error: 'Lỗi cơ sở dữ liệu' });
    }

    const tourId = result.insertId;

    const insertVeQuery = `
      INSERT INTO vedl (TourId, GiaVe, SoLuongVe)
      VALUES (?, ?, ?)
    `;

    db.query(insertVeQuery, [
      tourId, TourPrice, SoLuongVe
    ], (err) => {
      if (err) {
        console.error('Lỗi khi thêm vé:', err);
        return res.status(500).json({ error: 'Lỗi cơ sở dữ liệu khi thêm vé' });
      }

      res.status(201).json({ message: 'Tour đã được thêm thành công và vé đã được tạo', id: tourId });
    });
  });
});
// API lấy dữ liệu phân bổ theo loại du lịch
app.get('/pie/tourdl', (req, res) => {
  const query = `
    SELECT tl.TenTL AS loai, COUNT(t.TourId) AS count
    FROM tourdl t
    JOIN theloaidl tl ON t.TouTL = tl.IdTL
    GROUP BY tl.TenTL
  `;
  db.query(query, (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Error retrieving data');
    }
    res.json(results);
  });
});
// API lấy dữ liệu phân bổ theo quốc gia
app.get('/pie/quocgia', (req, res) => {
  const query = `
    SELECT kv.TenKV AS khu_vuc, COUNT(t.TourId) AS count
    FROM tourdl t
    JOIN quocgia q ON t.TouQG = q.IdQG
    JOIN khuvuc kv ON q.KhuVucId = kv.IdKV
    GROUP BY kv.TenKV
  `;
  db.query(query, (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Error retrieving data');
    }
    res.json(results);
  });
});

// Route cập nhật trạng thái tour theo ID
app.put('/api/tourdl/:TourId', (req, res) => {
  const { TourId } = req.params;

  const query = 'UPDATE tourdl SET TrangThai = "off" WHERE TourId = ?';

  db.query(query, [TourId], (err, result) => {
    if (err) {
      console.error('Lỗi khi cập nhật trạng thái tour:', err);
      res.status(500).json({ error: 'Lỗi khi cập nhật trạng thái tour' });
    } else if (result.affectedRows === 0) {
      res.status(404).json({ error: 'Không tìm thấy tour với TourId này' });
    } else {
      res.json({ message: 'Cập nhật trạng thái tour thành công' });
    }
  });
});
///
app.get("/api/theloaidl", (req, res) => {
  // Thực hiện truy vấn tới cơ sở dữ liệu để lấy dữ liệu
  db.query("SELECT * FROM theloaidl", (err, result) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json(result);
    }
  });
});
///
app.get("/api/khuvuc", (req, res) => {
  // Thực hiện truy vấn tới cơ sở dữ liệu để lấy dữ liệu
  db.query("SELECT * FROM khuvuc", (err, result) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json(result);
    }
  });
});
app.post("/api/khuvuc", (req, res) => {
  const { TenKV } = req.body;
  if (!TenKV) {
    return res.status(400).json({ error: "Tên khu vực không được bỏ trống" });
  }

  // Chèn dữ liệu mới vào bảng khuvuc
  db.query("INSERT INTO khuvuc (TenKV) VALUES (?)", [TenKV], (err, result) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json({ message: "Thêm khu vực thành công!", id: result.insertId });
    }
  });
});

///
app.get("/api/quocgia", (req, res) => {
  // Thực hiện truy vấn tới cơ sở dữ liệu để lấy dữ liệu
  db.query("SELECT * FROM quocgia", (err, result) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json(result);
    }
  });
});
app.post("/api/quocgia", (req, res) => {
  const { TenQG, KhuVucId } = req.body;
  if (!TenQG || !KhuVucId) {
    return res.status(400).json({ error: "Tên quốc gia và khu vực không được bỏ trống" });
  }

  db.query("INSERT INTO quocgia (TenQG, KhuVucId) VALUES (?, ?)", [TenQG, KhuVucId], (err, result) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json({ message: "Thêm quốc gia thành công!", id: result.insertId });
    }
  });
});

///
app.get("/api/Khachhang", (req, res) => {
  // Thực hiện truy vấn tới cơ sở dữ liệu để lấy dữ liệu
  db.query("SELECT * FROM khachhang", (err, result) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json(result);
    }
  });
});
app.get("/api/Khachhang/login", authenticateJWT, (req, res) => {
  const userId = req.user.ID; // Lấy ID người dùng từ JWT token

  // Truy vấn chỉ lấy thông tin khách hàng đã đăng nhập
  const sql = "SELECT * FROM khachhang WHERE AccountID = ?";
  db.query(sql, [userId], (err, result) => {
    if (err) {
      console.error("Lỗi khi lấy thông tin khách hàng:", err);
      return res.status(500).json({ error: "Lỗi khi lấy thông tin khách hàng" });
    }

    if (result.length === 0) {
      return res.status(404).json({ error: "Không tìm thấy thông tin khách hàng" + req.user.ID });
    }

    res.status(200).json(result[0]); // Chỉ trả về thông tin khách hàng đăng nhập
  });
});

app.post('/api/khachhang', (req, res) => {
  const { TenKH, Email, SDT, DiaChi, NoiDung, AccountID } = req.body;

  if (!TenKH || !SDT) {
    return res.status(400).json({ error: 'Thiếu thông tin' });
  }

  // Truy vấn để kiểm tra xem AccountID đã tồn tại chưa
  const checkQuery = 'SELECT * FROM khachhang WHERE AccountID = ?';
  db.query(checkQuery, [AccountID], (err, results) => {
    if (err) {
      console.error('Lỗi khi kiểm tra AccountID:', err);
      return res.status(500).json({ error: 'Lỗi cơ sở dữ liệu' });
    }

    if (results.length > 0) {
      // Nếu AccountID đã tồn tại, trả về lỗi
      return res.status(400).json({ error: 'AccountID đã tồn tại' });
    }

    // Nếu AccountID không tồn tại, thực hiện chèn dữ liệu
    const insertQuery = 'INSERT INTO khachhang (TenKH, Email, SDT, DiaChi, NoiDung, AccountID) VALUES (?, ?, ?, ?, ?, ?)';
    db.query(insertQuery, [TenKH, Email, SDT, DiaChi, NoiDung, AccountID], (err, result) => {
      if (err) {
        console.error('Lỗi khi thêm khách hàng:', err);
        return res.status(500).json({ error: 'Lỗi cơ sở dữ liệu' });
      }

      res.status(201).json({ message: 'Khách hàng đã được thêm thành công', id: result.insertId });
    });
  });
});

app.put('/api/khachhang/:id', (req, res) => {
  const khachhangId = req.params.id;
  const { TenKH, SDT, DiaChi, NoiDung } = req.body;

  const updateQuery = `
    UPDATE khachhang 
    SET TenKH = ?, SDT = ?, DiaChi = ?, NoiDung = ? 
    WHERE AccountID = ?
  `;

  db.query(updateQuery, [TenKH, SDT, DiaChi, NoiDung, khachhangId], (err, result) => {
    if (err) {
      console.error('Lỗi khi cập nhật khách hàng:', err);
      return res.status(500).json({ error: 'Lỗi khi cập nhật khách hàng' });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Không tìm thấy khách hàng' });
    }

    // res.status(200).json({ message: 'Cập nhật khách hàng thành công' });
  });
});


app.put('/api/khachhang-social', authenticateJWT, (req, res) => {
  const userId = req.user.ID; // Lấy user ID từ JWT (khachhangId)

  const { Twitter, Facebook, LinkedIn, Instagram } = req.body;

  // Kiểm tra xem các thông tin mạng xã hội có tồn tại trong body hay không
  if (!Twitter && !Facebook && !LinkedIn && !Instagram) {
    return res.status(400).json({ error: 'Không có thông tin mạng xã hội nào để cập nhật' });
  }

  // Chỉ cập nhật các trường mạng xã hội nếu chúng có giá trị mới
  const updateFields = [];
  const updateValues = [];

  if (Twitter) {
    updateFields.push('Twitter = ?');
    updateValues.push(Twitter);
  }
  if (Facebook) {
    updateFields.push('Facebook = ?');
    updateValues.push(Facebook);
  }
  if (LinkedIn) {
    updateFields.push('LinkedIn = ?');
    updateValues.push(LinkedIn);
  }
  if (Instagram) {
    updateFields.push('Instagram = ?');
    updateValues.push(Instagram);
  }

  // Truy vấn SQL để cập nhật thông tin mạng xã hội của khách hàng
  const updateQuery = `
  UPDATE khachhang
  SET ${updateFields.join(', ')}
  WHERE AccountID = ?  -- Sử dụng AccountID thay vì ID
`;

  // Đẩy userId vào cuối mảng giá trị (ID khách hàng)
  updateValues.push(userId);

  db.query(updateQuery, updateValues, (err, result) => {
    if (err) {
      console.error('Lỗi khi cập nhật khách hàng:', err);
      return res.status(500).json({ error: 'Lỗi khi cập nhật thông tin khách hàng' });
    }

    // Kiểm tra xem có bản ghi nào được cập nhật không
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Không tìm thấy thông tin khách hàng để cập nhật' });
    }

    res.status(200).json({ message: 'Cập nhật thông tin mạng xã hội thành công' });
  });
});





app.get("/api/account", (req, res) => {
  // Thực hiện truy vấn tới cơ sở dữ liệu để lấy dữ liệu
  db.query("SELECT * FROM account", (err, result) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json(result);
    }
  });
});
app.get("/api/account/login", authenticateJWT, (req, res) => {
  const userId = req.user.ID; // Lấy ID người dùng từ JWT token

  db.query("SELECT * FROM account WHERE ID = ?", [userId], (err, result) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else if (result.length > 0) {
      res.json(result[0]);  // Trả về thông tin của tài khoản người dùng đã đăng nhập
    } else {
      res.status(404).json({ error: "Account not found" });
    }
  });
});
app.post("/api/account", (req, res) => {
  const { AccountName, AccountPassword, Mail, Role, ProfilePicture } = req.body;

  // Kiểm tra xem các trường có tồn tại không
  if (!AccountName || !AccountPassword || !Mail) {
    return res.status(400).json({ error: "Thiếu username, password hoặc mail" });
  }

  // Kiểm tra xem tài khoản đã tồn tại chưa
  const checkAccountSql = "SELECT * FROM account WHERE AccountName = ? OR Mail = ?";
  db.query(checkAccountSql, [AccountName, Mail], (err, result) => {
    if (err) {
      console.error("Lỗi khi kiểm tra tài khoản:", err);
      return res.status(500).json({ error: "Lỗi khi kiểm tra tài khoản" });
    }

    // Nếu tài khoản đã tồn tại
    if (result.length > 0) {
      return res.status(400).json({ error: "Tài khoản đã tồn tại" });
    }

    // Nếu tài khoản chưa tồn tại, tiến hành mã hóa mật khẩu và tạo tài khoản
    bcrypt.hash(AccountPassword, 10, (err, hashedPassword) => {
      if (err) {
        console.error("Lỗi khi mã hóa mật khẩu:", err);
        return res.status(500).json({ error: "Lỗi khi mã hóa mật khẩu" });
      }

      // Gán giá trị mặc định cho ProfilePicture nếu không có
      const profilePic = ProfilePicture || 'https://s240-ava-talk.zadn.vn/e/a/c/d/0/240/1494d01fa267785b75ac2778750deb4a.jpg';

      // Lưu người dùng vào database
      const insertAccountSql = "INSERT INTO account (AccountName, AccountPassword, Mail, ProfilePicture) VALUES (?, ?, ?, ?)";
      db.query(insertAccountSql, [AccountName, hashedPassword, Mail, profilePic], (err, result) => {
        if (err) {
          console.error("Lỗi khi lưu người dùng:", err);
          return res.status(500).json({ error: "Lỗi khi lưu người dùng" });
        }
        res.status(201).json({ message: "Đăng ký thành công" });
      });
    });
  });
});


app.post('/api/account/request-change-password', authenticateJWT, (req, res) => {
  const userId = req.user.ID;
  const userMail = req.user.Mail;
  // Tạo mã reset ngẫu nhiên (token)
  const token = crypto.randomBytes(3).toString('hex'); // Mã reset dài 6 ký tự
  const expirationTime = new Date().getTime() + 60 * 1000; // Thời gian hết hạn là 10 phút sau
  if (!userMail) return console.log('not');;
  // Lưu mã reset vào cơ sở dữ liệu
  db.query(
    'UPDATE account SET reset_token = ?, reset_token_expiration = ? WHERE ID = ?',
    [token, expirationTime, userId],
    (err, result) => {
      if (err) {
        console.error('Error updating token:', err);
        return res.status(500).json({ error: 'Error updating reset token' });
      }
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Trả mã reset về client để gửi email
      res.json({
        message: 'Reset code is generated. Please check your email.',
        token,
        userMail
      });
    }
  );
});

app.post("/api/account/change-password", authenticateJWT, (req, res) => {
  const userId = req.user.ID;
  const { token, newPassword } = req.body;

  // Check if the token and new password exist
  if (!token || !newPassword) {
    return res.status(400).json({ error: "Cần cung cấp mã xác nhận và mật khẩu mới" });
  }

  // Fetch user account information
  db.query("SELECT * FROM account WHERE ID = ?", [userId], (err, result) => {
    if (err) {
      return res.status(500).json({ error: "Lỗi khi lấy thông tin tài khoản" });
    }

    if (result.length === 0) {
      return res.status(404).json({ error: "Tài khoản không tồn tại" });
    }

    const { reset_token, reset_token_expiration, auth_provider } = result[0];

    // Check if the user is using Google login
    if (auth_provider === "google") {
      return res.status(400).json({ error: "Người dùng đăng nhập bằng Google không cần đổi mật khẩu" });
    }

    // Check if the token matches and has not expired
    if (reset_token !== token) {
      return res.status(400).json({ error: "Mã xác nhận không chính xác" });
    }

    if (new Date().getTime() > reset_token_expiration) {
      return res.status(400).json({ error: "Mã xác nhận đã hết hạn" });
    }

    // Hash the new password and update in the database
    bcrypt.hash(newPassword, 10, (err, hashedPassword) => {
      if (err) {
        return res.status(500).json({ error: "Lỗi khi mã hóa mật khẩu" });
      }

      db.query("UPDATE account SET AccountPassword = ? WHERE ID = ?", [hashedPassword, userId], (err, result) => {
        if (err) {
          return res.status(500).json({ error: "Lỗi khi cập nhật mật khẩu" });
        }

        res.json({ message: "Mật khẩu đã được thay đổi thành công" });
      });
    });
  });
});

// Endpoint tạo mật khẩu mới
app.post('/api/account/request-new-password', (req, res) => {
  const { email, accountName } = req.body;

  if (!email || !accountName) {
    return res.status(400).json({ error: 'Cần cung cấp Email và Tên tài khoản' });
  }

  // Kiểm tra xem account có tồn tại không
  const query = 'SELECT * FROM account WHERE Mail = ? AND AccountName = ?';
  db.query(query, [email, accountName], (err, results) => {
    if (err) {
      console.error('Lỗi truy vấn database:', err);
      return res.status(500).json({ error: 'Lỗi khi truy vấn cơ sở dữ liệu' });
    }

    if (results.length === 0) {
      return res.status(404).json({ error: 'Không tìm thấy tài khoản' });
    }

    // Tạo mật khẩu mới
    const newPassword = crypto.randomBytes(4).toString('hex'); // 8 ký tự ngẫu nhiên

    // Mã hóa mật khẩu mới
    bcrypt.hash(newPassword, 10, (err, hashedPassword) => {
      if (err) {
        console.error('Lỗi khi băm mật khẩu:', err);
        return res.status(500).json({ error: 'Lỗi khi băm mật khẩu' });
      }

      // Cập nhật mật khẩu đã mã hóa vào database
      const updateQuery = 'UPDATE account SET AccountPassword = ? WHERE Mail = ? AND AccountName = ?';
      db.query(updateQuery, [hashedPassword, email, accountName], (err) => {
        if (err) {
          console.error('Lỗi cập nhật mật khẩu:', err);
          return res.status(500).json({ error: 'Lỗi khi cập nhật mật khẩu' });
        }

        res.json({
          message: 'Mật khẩu mới đã được tạo thành công.',
          newPassword, // Trả mật khẩu mới cho frontend để gửi qua EmailJS
        });
      });
    });
  });
});

app.post('/api/account/upload-profile-picture', authenticateJWT, (req, res) => {
  const userId = req.user.ID;

  // Kiểm tra xem có file trong request không
  if (!req.body.image) {
    return res.status(400).json({ error: 'No image data provided' });
  }

  const base64Image = req.body.image;

  // Kiểm tra xem chuỗi Base64 có hợp lệ không
  const base64Pattern = /^data:image\/[a-z]+;base64,/;
  if (!base64Pattern.test(base64Image)) {
    return res.status(400).json({ error: 'Invalid Base64 image format' });
  }

  // Lưu chuỗi Base64 vào cơ sở dữ liệu
  db.query('UPDATE account SET ProfilePicture = ? WHERE ID = ?', [base64Image, userId], (err, result) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    res.json({ message: 'Profile picture updated successfully', base64Image });
  });
});

// app.post("/api/login", (req, res) => {
//   const { AccountName, AccountPassword, Role } = req.body;

//   if (!AccountName || !AccountPassword) {
//     return res.status(400).json({ error: "Thiếu username hoặc password" });
//   }

//   // Tìm người dùng trong database
//   const sql = "SELECT * FROM account WHERE AccountName = ?";
//   db.query(sql, [AccountName], (err, results) => {
//     if (err) {
//       console.error("Lỗi khi tìm người dùng:", err);
//       return res.status(500).json({ error: "Lỗi khi tìm người dùng" });
//     }

//     if (results.length === 0) {
//       return res.status(401).json({ error: "Thông tin đăng nhập không chính xác" });
//     }

//     const user = results[0];

//     // Kiểm tra mật khẩu
//     bcrypt.compare(AccountPassword, user.AccountPassword, (err, isMatch) => {
//       if (err) {
//         console.error("Lỗi khi so sánh mật khẩu:", err);
//         return res.status(500).json({ error: "Lỗi khi so sánh mật khẩu" });
//       }

//       if (!isMatch) {
//         return res.status(401).json({ error: "Thông tin đăng nhập không chính xác" });
//       }

//       // Trả về thông tin người dùng cùng với thông báo thành công
//       res.status(200).json({
//         message: "Đăng nhập thành công",
//         user: {
//           ID: user.ID,
//           AccountName: user.AccountName,
//           Mail: user.Mail // Thay đổi hoặc bổ sung các thông tin cần thiết
//         }
//       });
//     });
//   });
// });

app.post("/api/login", (req, res) => {
  const { AccountName, AccountPassword, Role, Mail } = req.body;

  if (!AccountName || !AccountPassword) {
    return res.status(400).json({ error: "Thiếu username hoặc password" });
  }

  // Tìm người dùng trong database
  const sql = "SELECT * FROM account WHERE AccountName = ?";
  db.query(sql, [AccountName], (err, results) => {
    if (err) {
      console.error("Lỗi khi tìm người dùng:", err);
      return res.status(500).json({ error: "Lỗi khi tìm người dùng" });
    }

    if (results.length === 0) {
      return res.status(401).json({ error: "Thông tin đăng nhập không chính xác" });
    }

    const user = results[0];

    // Kiểm tra mật khẩu
    bcrypt.compare(AccountPassword, user.AccountPassword, (err, isMatch) => {
      if (err) {
        console.error("Lỗi khi so sánh mật khẩu:", err);
        return res.status(500).json({ error: "Lỗi khi so sánh mật khẩu" });
      }

      if (!isMatch) {
        return res.status(401).json({ error: "Thông tin đăng nhập không chính xác" });
      }

      // Tạo JWT token sau khi xác thực thành công
      const payload = {
        ID: user.ID,
        AccountName: user.AccountName,
        Role: user.Role,
        Mail: user.Mail,  // Thêm quyền hạn nếu cần thiết
      };

      const token = jwt.sign(payload, secretKey, { expiresIn: '1h' }); // Tạo token với thời gian sống 1 giờ

      // Trả về thông tin người dùng và token
      res.status(200).json({
        message: "Đăng nhập thành công",
        user: {
          ID: user.ID,
          AccountName: user.AccountName,
          Mail: user.Mail,
        },
        token, // Gửi JWT token về client
      });
    });
  });
});
app.put("/api/account/:id/trangthai", (req, res) => {
  const accountId = req.params.id;
  const { TrangThai } = req.body;

  // Cập nhật TrangThai của tài khoản
  const sql = "UPDATE account SET TrangThai = ? WHERE ID = ?";
  db.query(sql, [TrangThai, accountId], (err, result) => {
    if (err) {
      console.error("Lỗi khi cập nhật trạng thái:", err);
      return res.status(500).json({ error: "Lỗi khi cập nhật trạng thái" });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Không tìm thấy tài khoản" });
    }

    res.status(200).json({ message: "Cập nhật trạng thái thành công" });
  });
});
app.post('/api/google-auth', async (req, res) => {
  const { token } = req.body;

  try {
    // Xác thực token với Google
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();

    // Lấy thông tin từ payload
    const { sub: googleId, email, name, picture } = payload; // "sub" là Google ID duy nhất

    // Kiểm tra tài khoản trong database
    const checkAccountSql = 'SELECT * FROM account WHERE Mail = ?';
    db.query(checkAccountSql, [email], (err, results) => {
      if (err) {
        console.error("Lỗi khi kiểm tra tài khoản:", err);
        return res.status(500).json({ error: 'Lỗi server' });
      }

      if (results.length > 0) {
        // Tài khoản đã tồn tại
        const user = results[0];

        // Kiểm tra xem `auth_provider` đã là `google` chưa
        if (user.auth_provider !== 'google') {
          const updateAuthProviderSql = 'UPDATE account SET auth_provider = ? WHERE ID = ?';
          db.query(updateAuthProviderSql, ['google', user.ID], (err) => {
            if (err) {
              console.error("Lỗi khi cập nhật auth_provider:", err);
              return res.status(500).json({ error: 'Lỗi server' });
            }
          });
        }

        // Tạo JWT token
        const jwtPayload = {
          ID: user.ID,
          AccountName: user.AccountName,
          Mail: user.Mail,
        };

        const jwtToken = jwt.sign(jwtPayload, secretKey, { expiresIn: '1h' });

        // Trả về JWT token và thông tin người dùng
        return res.status(200).json({
          message: "Đăng nhập Google thành công",
          user,
          token: jwtToken,
        });
      }

      // Tài khoản chưa tồn tại, tạo mới
      const insertAccountSql = `
        INSERT INTO account (AccountName, Mail, ProfilePicture, auth_provider)
        VALUES (?, ?, ?, ?)
      `;
      db.query(insertAccountSql, [name, email, picture, 'google'], (err, result) => {
        if (err) {
          console.error("Lỗi khi lưu tài khoản:", err);
          return res.status(500).json({ error: 'Lỗi server' });
        }

        const user = {
          ID: result.insertId,
          AccountName: name,
          Mail: email,
          ProfilePicture: picture,
        };

        // Tạo JWT token
        const jwtPayload = {
          ID: user.ID,
          AccountName: user.AccountName,
          Mail: user.Mail,
        };

        const jwtToken = jwt.sign(jwtPayload, secretKey, { expiresIn: '1h' });

        // Trả về JWT token và thông tin người dùng
        return res.status(200).json({
          message: "Đăng nhập Google thành công",
          user,
          token: jwtToken,
        });
      });
    });
  } catch (error) {
    console.error('Google Auth Error:', error);
    return res.status(400).json({ error: 'Xác thực không hợp lệ' });
  }
});


// Hàm thêm vé vào chi tiết giỏ hàng
app.post("/api/chitietgiohang", (req, res) => {
  const { TourId, KhachHangId, SoLuongKH } = req.body;

  if (!TourId || !KhachHangId || !SoLuongKH) {
    return res.status(400).json({ error: 'Thiếu thông tin bắt buộc' });
  }

  // Lấy giá vé từ bảng tourdl
  const getTourPriceQuery = 'SELECT TourPrice FROM tourdl WHERE TourId = ?';
  db.query(getTourPriceQuery, [TourId], (err, results) => {
    if (err) {
      console.error('Lỗi khi lấy giá tour:', err);
      return res.status(500).json({ error: 'Lỗi cơ sở dữ liệu khi lấy giá tour', details: err.message });
    }

    if (results.length === 0) {
      return res.status(404).json({ error: 'Không tìm thấy TourId' });
    }

    const GiaVe = results[0].TourPrice;
    const NgayDat = new Date().toISOString().split('T')[0]; // Lấy ngày hiện tại (YYYY-MM-DD)

    // Lấy VeId từ bảng vedl dựa trên TourId
    const getVeIdQuery = 'SELECT VeId FROM vedl WHERE TourId = ?';
    db.query(getVeIdQuery, [TourId], (err, veResults) => {
      if (err) {
        console.error('Lỗi khi lấy VeId:', err);
        return res.status(500).json({ error: 'Lỗi cơ sở dữ liệu khi lấy VeId', details: err.message });
      }

      if (veResults.length === 0) {
        return res.status(404).json({ error: 'Không tìm thấy vé cho TourId này' });
      }

      const VeId = veResults[0].VeId;

      // Tạo giỏ hàng nếu chưa tồn tại
      const createCartQuery = 'INSERT IGNORE INTO giohang (GioHangID, KhachHangId) VALUES (?, ?)';
      db.query(createCartQuery, [KhachHangId, KhachHangId], (err) => {
        if (err) {
          console.error('Lỗi khi tạo giỏ hàng:', err);
          return res.status(500).json({ error: 'Lỗi cơ sở dữ liệu khi tạo giỏ hàng', details: err.message });
        }

        // Kiểm tra vé đã tồn tại trong chitietgiohang chưa
        const checkCartQuery = 'SELECT SoLuongVe FROM chitietgiohang WHERE GioHangID = ? AND VeId = ?';
        db.query(checkCartQuery, [KhachHangId, VeId], (err, cartResults) => {
          if (err) {
            console.error('Lỗi khi kiểm tra giỏ hàng:', err);
            return res.status(500).json({ error: 'Lỗi cơ sở dữ liệu khi kiểm tra giỏ hàng', details: err.message });
          }

          if (cartResults.length > 0) {
            // Nếu vé đã có trong giỏ hàng, tăng số lượng
            const updateCartQuery = 'UPDATE chitietgiohang SET SoLuongVe = SoLuongVe + 1 WHERE GioHangID = ? AND VeId = ?';
            db.query(updateCartQuery, [KhachHangId, VeId], (err) => {
              if (err) {
                console.error('Lỗi khi cập nhật số lượng vé:', err);
                return res.status(500).json({ error: 'Lỗi cơ sở dữ liệu khi cập nhật số lượng vé', details: err.message });
              }

              res.status(200).json({ message: 'Số lượng vé đã được tăng thêm' });
            });
          } else {
            // Nếu vé chưa có trong giỏ hàng, thêm vé vào giỏ hàng
            const addToCartQuery = 'INSERT INTO chitietgiohang (GioHangID, VeId, SoLuongVe, NgayDat) VALUES (?, ?, ?, ?)';
            db.query(addToCartQuery, [KhachHangId, VeId, SoLuongKH, NgayDat], (err) => {
              if (err) {
                console.error('Lỗi khi thêm vé vào giỏ hàng:', err);
                return res.status(500).json({ error: 'Lỗi cơ sở dữ liệu khi thêm vé vào giỏ hàng', details: err.message });
              }

              res.status(201).json({ message: 'Vé đã được thêm vào giỏ hàng' });
            });
          }
        });
      });
    });
  });
});
app.get("/api/giohang/:gioHangId", (req, res) => {
  const gioHangId = req.params.gioHangId;

  // Câu truy vấn SQL để lấy chi tiết giỏ hàng với tourdl có trạng thái 'on'
  const getCartDetailsQuery = `
  SELECT ct.ChiTietGioHangID, ct.VeId, ct.SoLuongVe, v.TourId, v.GiaVe, t.TourName
  FROM chitietgiohang ct
  JOIN vedl v ON ct.VeId = v.VeId
  JOIN tourdl t ON v.TourId = t.TourId
  WHERE ct.GioHangID = ? AND t.TrangThai = 'on';
  `;

  // Thực hiện truy vấn tới cơ sở dữ liệu
  db.query(getCartDetailsQuery, [gioHangId], (err, results) => {
    if (err) {
      console.error('Lỗi khi lấy chi tiết giỏ hàng:', err);
      return res.status(500).json({ error: 'Lỗi cơ sở dữ liệu khi lấy chi tiết giỏ hàng', details: err.message });
    }

    if (results.length === 0) {
      return res.status(404).json({ error: 'Không tìm thấy tour có trạng thái on trong giỏ hàng.' });
    }

    res.status(200).json(results);
  });
});

// Tăng số lượng vé
app.put("/api/giohang/increase/:chiTietGioHangId", (req, res) => {
  const chiTietGioHangId = req.params.chiTietGioHangId; // Đổi chữ 'C' thành chữ thường

  const increaseQuery = `UPDATE chitietgiohang SET SoLuongVe = SoLuongVe + 1 WHERE ChiTietGioHangID = ? AND TrangThai = 'on'`;

  db.query(increaseQuery, [chiTietGioHangId], (err, result) => {
    if (err) {
      return res.status(500).json({ error: 'Lỗi khi tăng số lượng vé' });
    }
    res.json({ message: 'Tăng số lượng vé thành công' });
  });
});
// Giảm số lượng vé
app.put("/api/giohang/decrease/:chiTietGioHangId", (req, res) => {
  const chiTietGioHangId = req.params.chiTietGioHangId; // Đổi chữ 'C' thành chữ thường

  const decreaseQuery = `UPDATE chitietgiohang SET SoLuongVe = SoLuongVe - 1 WHERE ChiTietGioHangID = ? AND SoLuongVe > 1 AND TrangThai = 'on'`;

  db.query(decreaseQuery, [chiTietGioHangId], (err, result) => {
    if (err) {
      return res.status(500).json({ error: 'Lỗi khi giảm số lượng vé' });
    }
    res.json({ message: 'Giảm số lượng vé thành công' });
  });
});

// Xóa vé
app.delete("/api/giohang/delete/:chiTietGioHangId", (req, res) => {
  const chiTietGioHangId = req.params.chiTietGioHangId; // Đảm bảo dùng đúng tên tham số

  const deleteQuery = `DELETE FROM chitietgiohang WHERE ChiTietGioHangID = ?`;

  db.query(deleteQuery, [chiTietGioHangId], (err, result) => {
    if (err) {
      return res.status(500).json({ error: 'Lỗi khi xóa vé' });
    }
    res.json({ message: 'Xóa vé thành công' });
  });
});

app.get("/api/giohang", (req, res) => {
  // Thực hiện truy vấn tới cơ sở dữ liệu để lấy dữ liệu
  db.query("SELECT * FROM giohang", (err, result) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json(result);
    }
  });
});

app.post('/api/tao-don-hang', (req, res) => {
  const { KhachHangID, GioHangID } = req.body;

  if (!KhachHangID || !GioHangID) {
    return res.status(400).json({ error: 'Thiếu thông tin bắt buộc' });
  }

  // Kiểm tra giỏ hàng có tồn tại
  db.query('SELECT * FROM giohang WHERE GioHangID = ? AND KhachHangId = ?', [GioHangID, KhachHangID], (err, results) => {
    if (err) {
      return res.status(500).json({ error: 'Lỗi cơ sở dữ liệu khi kiểm tra giỏ hàng', details: err.message });
    }

    if (results.length === 0) {
      return res.status(404).json({ error: 'Giỏ hàng không tồn tại' });
    }

    // Thêm đơn hàng
    const donHangQuery = 'INSERT INTO donhang (KhachHangID, NgayDatHang, GioHangID, TrangThai) VALUES (?, NOW(), ?, "pending")';
    db.query(donHangQuery, [KhachHangID, GioHangID], (err, result) => {
      if (err) {
        return res.status(500).json({ error: 'Lỗi thêm đơn hàng', details: err.message });
      }

      const DonHangID = result.insertId; // Lấy ID đơn hàng vừa tạo
      res.status(200).json({ message: 'Đơn hàng đã được tạo thành công', DonHangID });
    });
  });
});
app.post('/api/them-chitiet-don-hang', (req, res) => {
  const { DonHangID, GioHangID, VeId, SoLuong, GiaVe } = req.body;

  if (!DonHangID || !GioHangID || !VeId || !SoLuong || !GiaVe) {
    return res.status(400).json({ error: 'Thiếu thông tin bắt buộc' });
  }

  // Thêm chi tiết đơn hàng
  db.query('INSERT INTO chitietdonhang (DonHangID, VeId, SoLuong, GiaVe) VALUES (?, ?, ?, ?)',
    [DonHangID, VeId, SoLuong, GiaVe],
    (err) => {
      if (err) {
        console.error('Lỗi khi thêm chi tiết đơn hàng:', err);
        return res.status(500).json({ error: 'Lỗi cơ sở dữ liệu khi thêm chi tiết đơn hàng', details: err.message });
      }

      // Nếu thêm thành công, xóa mục trong chitietgiohang
      db.query('DELETE FROM chitietgiohang WHERE GioHangID = ? AND VeId = ?',
        [GioHangID, VeId],
        (deleteErr) => {
          if (deleteErr) {
            console.error('Lỗi khi xóa chi tiết giỏ hàng:', deleteErr);
            return res.status(500).json({ error: 'Lỗi cơ sở dữ liệu khi xóa chi tiết giỏ hàng', details: deleteErr.message });
          }

          return res.status(200).json({ message: 'Chi tiết đơn hàng đã được thêm thành công và giỏ hàng đã được xóa' });
        });
    });
});

const s3 = new S3Client({
  region: "image-web-travel",  // Khu vực Tebi.io (có thể khác với AWS)
  endpoint: "https://s3.tebi.io",  // Endpoint Tebi.io, nếu có
  credentials: {
    accessKeyId: "AQO6DRPskVS1C4QA",  // Khóa truy cập Tebi.io
    secretAccessKey: "v96uojahUW5D6tFRlo8i5wFxlS9eXbJhYVKEMFO2",  // Khóa bí mật Tebi.io
  },
});
// Cấu hình Multer để tải ảnh lên S3
const upload = multer({
  storage: multerS3({
    s3: s3,
    bucket: "image-web-travel",  // Tên bucket S3
    acl: "public-read",  // Quyền truy cập công khai
    key: function (req, file, cb) {
      // cb(null, Date.now().toString() + "-" + file.originalname);  // Tên file mới
      cb(null, file.originalname);  // Tên file mới
    },
  }),
});
// API để tải ảnh lên
app.post('/upload', upload.array('images', 5), (req, res) => {
  if (req.files && req.files.length > 0) {
    console.log("Files uploaded: ", req.files);
    const fileUrls = req.files.map((file) => file.location); // Lấy URL từ các file
    res.json({ message: "Ảnh đã được tải lên Tebi.io thành công!", fileUrls });
  } else {
    console.log("Không có file trong yêu cầu");
    res.status(400).json({ message: "Không có ảnh được tải lên." });
  }
});


// API lấy tất cả bài viết
app.get('/get-posts', (req, res) => {
  const query = 'SELECT * FROM baiviet'; // Truy vấn lấy tất cả bài viết

  db.query(query, (err, result) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Lỗi khi lấy dữ liệu bài viết');
    }

    // Trả về tất cả bài viết dưới dạng JSON
    res.json(result);
  });
});
app.get('/get-post/:id', (req, res) => {
  const postId = req.params.id;

  // Truy vấn bài viết từ cơ sở dữ liệu
  const query = 'SELECT * FROM baiviet WHERE id = ?';

  db.query(query, [postId], (err, result) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Lỗi khi lấy dữ liệu bài viết');
    }

    if (result.length === 0) {
      return res.status(404).send('Bài viết không tồn tại');
    }

    // Trả về dữ liệu bài viết dưới dạng JSON
    res.json(result[0]);
  });
});
// Create post API
app.post('/api/posts', (req, res) => {
  const { title, content, datePosted, accountId, image_path } = req.body;

  console.log('Received data:', { title, content, datePosted, accountId, image_path });  // Log dữ liệu nhận được

  const query = 'INSERT INTO baiviet (tieude, noidung, ngaydang, AccountId, image_path ) VALUES (?, ?, ?, ?, ?)';
  db.query(query, [title, content, datePosted, accountId, image_path], (err, result) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ message: 'Failed to save post' });
    }
    res.status(200).json({ message: 'Post saved successfully', postId: result.insertId });
  });
});

app.get('/revenue/daily', (req, res) => {
  const query = `
    SELECT 
      DATE_FORMAT(tt.NgayTT, '%Y-%m-%d') AS payment_date,  -- Sử dụng định dạng ngày chuẩn ISO
      COALESCE(SUM(tt.Amount), 0) AS daily_revenue
    FROM (
      SELECT CURDATE() - INTERVAL n DAY AS payment_date
      FROM (
        SELECT 0 AS n UNION ALL
        SELECT 1 UNION ALL
        SELECT 2 UNION ALL
        SELECT 3 UNION ALL
        SELECT 4 UNION ALL
        SELECT 5 UNION ALL
        SELECT 6
      ) AS days
    ) AS dates
    LEFT JOIN thanhtoan tt ON DATE_FORMAT(tt.NgayTT, '%Y-%m-%d') = dates.payment_date AND tt.Status = 'Success'
    GROUP BY dates.payment_date
    ORDER BY dates.payment_date ASC;  -- Thay đổi từ DESC thành ASC
  `;

  db.query(query, (err, result) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      const revenueData = result || [];
      res.json({ revenue: revenueData });
    }
  });
});



app.get('/revenue/monthly', (req, res) => {
  const { year } = req.query; // Lấy năm từ query string
  // Nếu không có năm, mặc định lấy năm hiện tại
  const targetYear = year;

  const query = `
    SELECT 
      YEAR(tt.NgayTT) AS year,
      MONTH(tt.NgayTT) AS month,
      SUM(tt.Amount) AS monthly_revenue
    FROM thanhtoan tt
    WHERE tt.Status = 'Success' AND YEAR(tt.NgayTT) = ?
    GROUP BY YEAR(tt.NgayTT), MONTH(tt.NgayTT)
    ORDER BY year DESC, month DESC;
  `;

  db.query(query, [targetYear], (err, result) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      const revenueData = result || [];

      // Tạo một mảng các tháng từ tháng hiện tại đến tháng 6 tháng trước
      const allMonths = [];
      const currentDate = new Date();
      for (let i = 0; i < 13; i++) {
        const month = new Date(targetYear, currentDate.getMonth() - i, 1);
        const monthLabel = `${month.getFullYear()}-${(month.getMonth() + 1).toString().padStart(2, '0')}`; // yyyy-mm
        allMonths.push(monthLabel);
      }
      // Điền doanh thu cho các tháng không có dữ liệu
      const formattedRevenue = allMonths.map(month => {
        const dataForMonth = revenueData.find(item => `${item.year}-${String(item.month).padStart(2, '0')}` === month);
        return {
          month,
          monthly_revenue: dataForMonth ? dataForMonth.monthly_revenue : 0
        };
      });

      res.json({ revenue: formattedRevenue });
    }
  });
});

app.get('/revenue/year', (req, res) => {
  // Truy vấn để lấy danh sách các năm có dữ liệu doanh thu
  const query = `
    SELECT DISTINCT YEAR(tt.NgayTT) AS year
    FROM thanhtoan tt
    WHERE tt.Status = 'Success'
    ORDER BY year DESC;
  `;

  db.query(query, (err, result) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      const years = result.map(item => item.year);
      res.json({ years: years || [] });
    }
  });
});
// API lấy tổng doanh thu của năm
app.get('/revenue/year/total', (req, res) => {
  const { year } = req.query;  // Lấy năm từ query string
  const targetYear = year || new Date().getFullYear();  // Nếu không có năm, mặc định lấy năm hiện tại

  // Truy vấn tổng doanh thu của năm đó
  const query = `
    SELECT 
      SUM(tt.Amount) AS total_revenue
    FROM thanhtoan tt
    WHERE tt.Status = 'Success' 
      AND YEAR(tt.NgayTT) = ?
  `;

  db.query(query, [targetYear], (err, result) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      const totalRevenue = result[0]?.total_revenue || 0;
      res.json({ year: targetYear, total_revenue: totalRevenue });
    }
  });
});


// API để lấy thông tin vé
app.get('/api/tours/ticket-info', (req, res) => {
  const query = `
        SELECT 
          t.TourId,
          t.TourName,
          v.SoLuongVe - IFNULL(SUM(cd.SoLuong), 0) AS SoLuongVeConLai,
          IFNULL(SUM(cd.SoLuong), 0) AS SoLuongVeDaBan
        FROM 
          tourdl t
        JOIN 
          vedl v ON t.TourId = v.TourId
        LEFT JOIN 
          chitietdonhang cd ON cd.VeId = v.VeId
        LEFT JOIN 
          donhang dh ON cd.DonHangID = dh.DonHangID
        WHERE 
          t.TrangThai = 'on' -- Chỉ tính các tour có trạng thái "on"
          AND dh.TrangThai = 'paid' -- Chỉ tính các đơn hàng đã thanh toán
        GROUP BY 
          t.TourId, t.TourName, v.SoLuongVe;
    `;

  db.query(query, (err, results) => {
    if (err) {
      console.error('Error executing query:', err.stack);
      return res.status(500).json({ error: 'Database query failed' });
    }
    res.json(results);
  });
});


// API để lấy danh sách đơn hàng
app.get('/api/orders', (req, res) => {
  const query = `
    SELECT donhang.DonHangID, donhang.NgayDatHang, donhang.TrangThai AS DonHangTrangThai, 
           khachhang.TenKH, khachhang.Email, chitietdonhang.SoLuong, chitietdonhang.GiaVe, 
           tourdl.TourName,donhang.KhachHangID
    FROM donhang
    JOIN khachhang ON donhang.KhachHangID = khachhang.IdKH
    JOIN chitietdonhang ON donhang.DonHangID = chitietdonhang.DonHangID
    JOIN vedl ON chitietdonhang.VeId = vedl.VeId
    JOIN tourdl ON vedl.TourId = tourdl.TourId;
  `;

  db.query(query, (err, results) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json(results);
    }
  });
});

app.put('/api/orders/cancel/:orderId', authenticateJWT, (req, res) => {
  const { orderId } = req.params;
  const userRole = req.user.Role; // Lấy quyền người dùng từ token

  console.log('userRole:', userRole); // Kiểm tra quyền người dùng

  // Truy vấn trạng thái đơn hàng
  const query = `
    SELECT TrangThai FROM donhang WHERE DonHangID = ?
  `;
  db.query(query, [orderId], (err, results) => {
    if (err) {
      console.error('Lỗi khi truy vấn trạng thái đơn hàng:', err);
      return res.status(500).json({ error: err.message });
    }

    if (results.length === 0) {
      console.log('Không tìm thấy đơn hàng với ID:', orderId);
      return res.status(404).json({ error: 'Đơn hàng không tồn tại' });
    }

    const orderStatus = results[0].DonHangTrangThai;
    console.log('Trạng thái đơn hàng:', orderStatus); // Kiểm tra trạng thái đơn hàng

    // Nếu người dùng không phải admin, kiểm tra trạng thái đơn hàng
    if (userRole !== 'admin' && (orderStatus !== 'pending' && orderStatus !== 'processing')) {
      console.log('Không thể hủy đơn hàng trong trạng thái này:', orderStatus);
      return res.status(400).json({ error: 'Không thể hủy đơn hàng trong trạng thái này' });
    }

    // Nếu là admin hoặc trạng thái hợp lệ với user, thực hiện cập nhật
    const updateQuery = `
      UPDATE donhang
      SET TrangThai = 'cancelled'
      WHERE DonHangID = ?
    `;
    db.query(updateQuery, [orderId], (err, updateResults) => {
      if (err) {
        console.error('Lỗi khi cập nhật trạng thái đơn hàng:', err);
        return res.status(500).json({ error: err.message });
      }

      // Trả về thông báo thành công
      console.log('Đơn hàng đã được hủy:', orderId);
      res.json({ message: 'Đơn hàng đã được hủy' });
    });
  });
});


app.get('/api/carsfull', (req, res) => {
  const query = 'SELECT * FROM car';
  db.query(query, (err, results) => {
    if (err) {
      console.error('Lỗi khi lấy dữ liệu:', err);
      return res.status(500).json({ error: 'Không thể lấy dữ liệu từ database' });
    }
    res.json(results);
  });
});
app.get("/api/cars", (req, res) => {
  const query = "SELECT * FROM car WHERE CarStatus = 'available'"; // Lấy xe có trạng thái available
  db.query(query, (err, results) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(results);
  });
});

// Đặt xe
app.post("/api/book-car", (req, res) => {
  const { carId, customerName, customerPhone, customerEmail, rentalDate, returnDate, totalPrice } = req.body;

  // Cập nhật trạng thái xe là "rented" khi khách hàng đặt xe
  const updateCarStatus = "UPDATE car SET CarStatus = 'rented' WHERE CarId = ?";
  db.query(updateCarStatus, [carId], (err, result) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    // Thêm thông tin thuê xe vào bảng car_rentals
    const query = "INSERT INTO car_rentals (CarId, CustomerName, CustomerPhone, CustomerEmail, RentalDate, ReturnDate, TotalPrice) VALUES (?, ?, ?, ?, ?, ?, ?)";
    db.query(query, [carId, customerName, customerPhone, customerEmail, rentalDate, returnDate, totalPrice], (err, result) => {
      if (err) {
        console.log(err); // Log lỗi
        return res.status(500).json({ error: err.message });
      }
      // console.log(result); // Log kết quả
      res.status(201).json({ message: "Đặt xe thành công!" });
    });
  });
});




// Khởi động server
app.listen(port, () => {
  console.log(`Server đang chạy trên cổng ${port}`);
});
