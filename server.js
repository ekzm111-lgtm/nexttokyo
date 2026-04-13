const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
let serverStarted = false;

// Database Setup
const DATA_DIR = process.env.DATA_DIR || __dirname;
const dbPath = path.join(DATA_DIR, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
        process.exit(1);
    } else {
        console.log('Connected to the SQLite database at:', dbPath);
        initializeDatabase();
        startServer();
    }
});

// Logger middleware
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// Ensure upload directory exists
const uploadDir = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(uploadDir)){
    fs.mkdirSync(uploadDir);
}

// Storage config for Multer
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/')
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname))
    }
});
const upload = multer({ storage: storage });

function normalizeFileUrls(inputFileUrls, fallbackFileUrl) {
    let arr = [];
    if (Array.isArray(inputFileUrls)) {
        arr = inputFileUrls.filter(Boolean);
    } else if (typeof inputFileUrls === 'string' && inputFileUrls.trim()) {
        try {
            const parsed = JSON.parse(inputFileUrls);
            if (Array.isArray(parsed)) arr = parsed.filter(Boolean);
        } catch (e) {
            arr = [inputFileUrls.trim()];
        }
    }
    if (arr.length === 0 && fallbackFileUrl) {
        arr = [fallbackFileUrl];
    }
    return arr;
}

function parseNewsBody(body) {
    let src = body;
    if (typeof src === "string") {
        try {
            src = JSON.parse(src);
        } catch (e) {
            src = {};
        }
    }
    src = src || {};
    const fileUrlsInput = src.file_urls ?? src.fileUrls ?? src.files ?? [];
    return {
        title: src.title || "",
        date: src.date || "",
        content: src.content || "",
        thumbnail_url: src.thumbnail_url || "",
        file_url: src.file_url || "",
        file_urls: fileUrlsInput,
        youtube_url: src.youtube_url || src.youtubeUrl || ""
    };
}

function ensureNewsColumns() {
    db.all("PRAGMA table_info(news)", (err, cols) => {
        if (err || !cols) return;
        const colNames = new Set(cols.map(c => c.name));
        if (!colNames.has("file_urls")) {
            db.run("ALTER TABLE news ADD COLUMN file_urls TEXT DEFAULT '[]'");
        }
        if (!colNames.has("youtube_url")) {
            db.run("ALTER TABLE news ADD COLUMN youtube_url TEXT DEFAULT ''");
        }
    });
}

function ensureContactColumns() {
    db.all("PRAGMA table_info(contacts)", (err, cols) => {
        if (err || !cols) return;
        const colNames = new Set(cols.map(c => c.name));
        if (!colNames.has("phone")) {
            db.run("ALTER TABLE contacts ADD COLUMN phone TEXT DEFAULT ''");
        }
    });
}

// Middleware
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(bodyParser.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// All db related initialization moved up (See above)

function initializeDatabase() {
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS news (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            content TEXT,
            date TEXT NOT NULL,
            thumbnail_url TEXT,
            file_url TEXT,
            file_urls TEXT DEFAULT '[]',
            youtube_url TEXT DEFAULT ''
        )`);
        ensureNewsColumns();

        db.run(`CREATE TABLE IF NOT EXISTS gallery (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            image_url TEXT NOT NULL,
            category TEXT,
            date TEXT NOT NULL
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS contacts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            company TEXT,
            phone TEXT,
            email TEXT NOT NULL,
            type TEXT,
            message TEXT,
            date TEXT NOT NULL
        )`);
        ensureContactColumns();

        db.run(`CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )`);

        db.get("SELECT COUNT(*) as count FROM settings", (err, row) => {
            if (err) {
                console.error("Failed to read settings count:", err.message);
                return;
            }
            if (row && row.count === 0) {
                const setStmt = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)");
                setStmt.run("site_title", "Next plus tokyo");
                setStmt.run("contact_email", "info@nextplus-tokyo.com");
                setStmt.run("main_color", "#002D59");
                setStmt.run("tel", "044-833-0022");
                setStmt.run("address", "3-16-15");
                setStmt.run("established", "2025");
                setStmt.finalize();
            }
        });
    });
}

// API Endpoints
app.get('/api/health', (req, res) => {
    res.json({ ok: true, dbPath });
});

app.get('/api/news', (req, res) => {
    db.all("SELECT * FROM news ORDER BY date DESC, id DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const normalized = (rows || []).map((r) => {
            const files = normalizeFileUrls(r.file_urls, r.file_url);
            return {
                ...r,
                file_urls: JSON.stringify(files),
                file_url: r.file_url || files[0] || "",
                youtube_url: r.youtube_url || ""
            };
        });
        res.json(normalized);
    });
});

app.post('/api/admin/news', (req, res) => {
    const { title, date, content, thumbnail_url, file_url, file_urls, youtube_url } = parseNewsBody(req.body);
    const normalizedFiles = normalizeFileUrls(file_urls, file_url);
    db.run("INSERT INTO news (title, date, content, thumbnail_url, file_url, file_urls, youtube_url) VALUES (?, ?, ?, ?, ?, ?, ?)", 
        [title, date, content || "", thumbnail_url || "", normalizedFiles[0] || "", JSON.stringify(normalizedFiles), youtube_url || ""], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID });
    });
});

app.put('/api/admin/news/:id', (req, res) => {
    const { id } = req.params;
    const { title, date, content, thumbnail_url, file_url, file_urls, youtube_url } = parseNewsBody(req.body);
    const normalizedFiles = normalizeFileUrls(file_urls, file_url);
    db.run("UPDATE news SET title = ?, date = ?, content = ?, thumbnail_url = ?, file_url = ?, file_urls = ?, youtube_url = ? WHERE id = ?", 
        [title, date, content || "", thumbnail_url || "", normalizedFiles[0] || "", JSON.stringify(normalizedFiles), youtube_url || "", id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Updated successfully" });
    });
});

app.delete('/api/admin/news/:id', (req, res) => {
    const { id } = req.params;
    db.run("DELETE FROM news WHERE id = ?", [id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Deleted successfully" });
    });
});

app.get('/api/gallery', (req, res) => {
    db.all("SELECT * FROM gallery ORDER BY date DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows || []);
    });
});

app.post('/api/admin/gallery', (req, res) => {
    const { title, image_url, category, date } = req.body;
    db.run("INSERT INTO gallery (title, image_url, category, date) VALUES (?, ?, ?, ?)", [title, image_url, category, date], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID });
    });
});

app.put('/api/admin/gallery/:id', (req, res) => {
    const { id } = req.params;
    const { title, image_url, category, date } = req.body;
    db.run("UPDATE gallery SET title = ?, image_url = ?, category = ?, date = ? WHERE id = ?", [title, image_url, category, date, id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Updated successfully" });
    });
});

app.delete('/api/admin/gallery/:id', (req, res) => {
    const { id } = req.params;
    db.run("DELETE FROM gallery WHERE id = ?", [id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Deleted successfully" });
    });
});

app.post('/api/contacts', (req, res) => {
    const { name, company, phone, email, type, message } = req.body;
    const date = new Date().toISOString().split('T')[0].replace(/-/g, '.'); 
    db.run("INSERT INTO contacts (name, company, phone, email, type, message, date) VALUES (?, ?, ?, ?, ?, ?, ?)", [name, company, phone || "", email, type, message, date], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID, message: "Inquiry received successfully" });
    });
});

app.get('/api/admin/contacts', (req, res) => {
    db.all("SELECT * FROM contacts ORDER BY date DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows || []);
    });
});

app.delete('/api/admin/contacts/:id', (req, res) => {
    const { id } = req.params;
    db.run("DELETE FROM contacts WHERE id = ?", [id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Deleted successfully" });
    });
});

app.get('/api/settings', (req, res) => {
    db.all("SELECT * FROM settings", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const settings = {};
        if (rows) rows.forEach(r => settings[r.key] = r.value);
        res.json(settings);
    });
});

app.post('/api/admin/settings', (req, res) => {
    const settings = req.body;
    db.serialize(() => {
        const stmt = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
        for (const [key, value] of Object.entries(settings)) {
            stmt.run(key, value);
        }
        stmt.finalize((err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: "Settings updated successfully" });
        });
    });
});

app.post('/api/admin/upload', (req, res) => {
    upload.single('image')(req, res, function (err) {
        if (err instanceof multer.MulterError) {
            console.error('Multer Error:', err);
            return res.status(500).json({ error: 'Multer upload error: ' + err.message });
        } else if (err) {
            console.error('Unknown Upload Error:', err);
            return res.status(500).json({ error: 'Unknown upload error: ' + err.message });
        }
        
        if (!req.file) {
            console.warn('Upload attempt with no file');
            return res.status(400).json({ error: 'No file uploaded' });
        }
        
        console.log('File uploaded successfully:', req.file.filename);
        res.json({ url: `/uploads/${req.file.filename}` });
    });
});

// Static files (After APIs)
app.use(express.static(path.join(__dirname, '.'), {
    setHeaders: (res, filePath) => {
        if (filePath && filePath.toLowerCase().endsWith('.html')) {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
        }
    }
}));

// All db related initialization moved up

function startServer() {
    if (serverStarted) return;
    const server = app.listen(PORT, () => {
        serverStarted = true;
        console.log(`Server is running on http://localhost:${PORT}`);
    });
    server.on('error', (err) => {
        if (err && err.code === 'EADDRINUSE') {
            console.error(`Port ${PORT} is already in use. Stop the other server or set a different PORT.`);
            return;
        }
        console.error('Failed to start server:', err.message);
    });
}

// Keep process alive explicitly
setInterval(() => {
    // Keep-alive
}, 60000);

